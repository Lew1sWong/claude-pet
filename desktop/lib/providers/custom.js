// Custom JSON usage source — the universal adapter so ANY agent/tool can feed
// the pet. Point it at a local file or an http(s) URL that returns:
//   { "label": "My Agent", "windows": [ { "label": "day", "pct": 42,
//     "resetsAt": "2026-07-15T02:00:00Z" } ] }
// …or an array of such objects for several agents at once. pct is 0–100
// (fractions 0–1 are tolerated), resetsAt is optional ISO-8601.
const fs = require("fs");

function normPct(v) {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const pct = v > 0 && v < 1 ? v * 100 : v;
  return Math.max(0, Math.min(100, pct));
}

function normProvider(entry, idx) {
  if (!entry || typeof entry !== "object") return null;
  const windows = (Array.isArray(entry.windows) ? entry.windows : [])
    .slice(0, 4)
    .map((w) => {
      if (!w || typeof w !== "object") return null;
      const pct = normPct(w.pct ?? w.percent ?? w.utilization);
      if (pct === null) return null;
      return {
        label: String(w.label || "").slice(0, 8),
        pct,
        resetsAt: typeof w.resetsAt === "string" ? w.resetsAt : (typeof w.resets_at === "string" ? w.resets_at : null),
      };
    })
    .filter(Boolean);
  if (!windows.length) return null;
  return { id: "custom-" + idx, label: String(entry.label || "Custom").slice(0, 24), windows };
}

async function readSource(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`custom source HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(src, "utf8"));
}

/** @returns {Promise<Array<{id:string,label:string,windows:Array}>>} */
async function fetchProvider(src) {
  if (!src) return [];
  const raw = await readSource(src);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.slice(0, 6).map(normProvider).filter(Boolean);
}

module.exports = { id: "custom", label: "Custom", fetchProvider };
