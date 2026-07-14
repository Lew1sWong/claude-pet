// OpenAI Codex CLI usage — read locally, no network. Codex writes a
// rate-limit snapshot into every session rollout (token_count events under
// ~/.codex/sessions/**/rollout-*.jsonl); we tail the newest rollouts and
// surface the last snapshot: primary (~5h) + secondary (weekly) windows.
const fs = require("fs");
const os = require("os");
const path = require("path");

const SESS_DIR = () => path.join(os.homedir(), ".codex", "sessions");
const TAIL_BYTES = 128 * 1024;

function detect() {
  try { return fs.existsSync(path.join(os.homedir(), ".codex")); }
  catch { return false; }
}

// newest-first bounded walk (sessions are nested year/month/day)
function newestRollouts(limit) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 4) walk(p, depth + 1);
      } else if (e.name.endsWith(".jsonl")) {
        try { out.push({ p, mtime: fs.statSync(p).mtimeMs }); } catch { /* skip */ }
      }
      if (out.length > 400) return; // runaway guard
    }
  };
  walk(SESS_DIR(), 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit).map((x) => x.p);
}

function tailLines(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8").split("\n");
  } finally {
    fs.closeSync(fd);
  }
}

function findRateLimits(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.rate_limits && typeof obj.rate_limits === "object") return obj.rate_limits;
  if (obj.payload) return findRateLimits(obj.payload);
  if (obj.msg) return findRateLimits(obj.msg);
  if (obj.info) return findRateLimits(obj.info);
  return null;
}

function toWindow(rl, fallbackLabel, tsMs) {
  if (!rl || typeof rl !== "object") return null;
  const pct = rl.used_percent ?? rl.usedPercent ?? rl.percent;
  if (typeof pct !== "number" || !isFinite(pct)) return null;
  const mins = rl.window_minutes ?? rl.windowMinutes;
  const resets = rl.resets_in_seconds ?? rl.resetsInSeconds;
  let label = fallbackLabel;
  if (typeof mins === "number" && isFinite(mins) && mins > 0) {
    label = mins >= 24 * 60 ? Math.round(mins / (24 * 60)) + "d" : Math.round(mins / 60) + "h";
  }
  const resetsAt = typeof resets === "number" && isFinite(resets) && tsMs
    ? new Date(tsMs + resets * 1000).toISOString() : null;
  return { label, pct: Math.max(0, Math.min(100, pct)), resetsAt };
}

/** @returns {Promise<{id:string,label:string,windows:Array}|null>} */
async function fetchProvider() {
  if (!detect()) return null;
  for (const file of newestRollouts(3)) {
    let lines;
    try { lines = tailLines(file); } catch { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes("rate_limits")) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const rl = findRateLimits(obj);
      if (!rl) continue;
      let tsMs = Date.parse(obj.timestamp || obj.ts || "");
      if (!isFinite(tsMs)) { try { tsMs = fs.statSync(file).mtimeMs; } catch { tsMs = Date.now(); } }
      const windows = [
        toWindow(rl.primary, "5h", tsMs),
        toWindow(rl.secondary, "wk", tsMs),
      ].filter(Boolean);
      if (windows.length) return { id: "codex", label: "Codex", windows };
    }
  }
  return null;
}

module.exports = { id: "codex", label: "Codex", detect, fetchProvider };
