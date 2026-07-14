// OpenClaw (龙虾 🦞) usage — best-effort. OpenClaw typically runs on a Claude
// subscription via an Anthropic OAuth token stored somewhere under its state
// dir; we find that token (read-only, never refresh) and query the same usage
// endpoint the Claude provider uses. If OpenClaw runs on another backend,
// point the "custom JSON" source at your own exporter instead.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fetchUsage } = require("../usageClient");

const ROOTS = () => [
  path.join(os.homedir(), ".openclaw"),
  path.join(os.homedir(), ".clawdbot"), // legacy name
];

function detect() {
  return ROOTS().some((r) => { try { return fs.existsSync(r); } catch { return false; } });
}

// deep-search a parsed JSON value for a plausible Anthropic OAuth access token
function findToken(v, hint) {
  if (!v || typeof v !== "object") return null;
  const o = v.claudeAiOauth || v.oauth || v;
  if (typeof o.accessToken === "string" && o.accessToken.length > 10) {
    const prov = String(o.provider || o.type || hint || "");
    if (!prov || /anthropic|claude/i.test(prov) || o === v.claudeAiOauth) return o.accessToken;
  }
  if (typeof o.access_token === "string" && o.access_token.length > 10) {
    // snake_case is used by many vendors — only take it when the provider /
    // surrounding keys clearly say Anthropic, so a foreign credential (e.g.
    // an OpenAI token in the same dir) is never sent to Anthropic's endpoint
    const prov = String(o.provider || o.type || hint || "");
    if (/anthropic|claude/i.test(prov)) return o.access_token;
  }
  for (const k of Object.keys(v)) {
    const t = findToken(v[k], /anthropic|claude/i.test(k) ? k : hint);
    if (t) return t;
  }
  return null;
}

function findCredsFile() {
  for (const root of ROOTS()) {
    const stack = [{ dir: root, depth: 0 }];
    let seen = 0;
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        if (++seen > 400) return null; // bounded walk
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 3 && e.name !== "node_modules" && !e.name.startsWith(".git")) {
            stack.push({ dir: p, depth: depth + 1 });
          }
        } else if (/\.(json)$/i.test(e.name) && /auth|credential|oauth|token|profile/i.test(e.name)) {
          try {
            if (fs.statSync(p).size > 256 * 1024) continue;
            const token = findToken(JSON.parse(fs.readFileSync(p, "utf8")));
            if (token) return token;
          } catch { /* next */ }
        }
      }
    }
  }
  return null;
}

/** @returns {Promise<{id:string,label:string,windows:Array}|null>} */
async function fetchProvider() {
  if (!detect()) return null;
  const token = findCredsFile();
  if (!token) return null;
  const u = await fetchUsage(token);
  const windows = [];
  if (u.fiveHour) windows.push({ label: "5h", pct: u.fiveHour.pct, resetsAt: u.fiveHour.resetsAt });
  if (u.week) windows.push({ label: "wk", pct: u.week.pct, resetsAt: u.week.resetsAt });
  if (u.fable) windows.push({ label: "F✦", pct: u.fable.pct, resetsAt: u.fable.resetsAt });
  return windows.length ? { id: "openclaw", label: "OpenClaw 🦞", windows } : null;
}

module.exports = { id: "openclaw", label: "OpenClaw 🦞", detect, fetchProvider };
