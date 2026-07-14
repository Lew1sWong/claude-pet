// Provider registry — pulls usage from every enabled non-Claude source in
// parallel. Each provider is fully sandboxed: a hang is cut by a timeout, a
// throw becomes a "no data" row, so one broken agent can never take down the
// pet's main Claude polling.
const codex = require("./codex");
const openclaw = require("./openclaw");
const custom = require("./custom");

const TIMEOUT_MS = 8000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
  ]);
}

// a visible "--%" row so an enabled-but-silent source gives feedback
function emptyRow(p) {
  return { id: p.id, label: p.label, windows: [{ label: "", pct: null, resetsAt: null }] };
}

/**
 * @param {{codex:boolean, openclaw:boolean, custom:boolean, customPath:string}} flags
 * @returns {Promise<Array<{id:string,label:string,windows:Array}>>}
 */
async function collectOthers(flags) {
  const jobs = [];
  if (flags.codex) {
    jobs.push(withTimeout(codex.fetchProvider()).then((r) => r || emptyRow(codex)).catch(() => emptyRow(codex)));
  }
  if (flags.openclaw) {
    jobs.push(withTimeout(openclaw.fetchProvider()).then((r) => r || emptyRow(openclaw)).catch(() => emptyRow(openclaw)));
  }
  if (flags.custom && flags.customPath) {
    jobs.push(
      withTimeout(custom.fetchProvider(flags.customPath))
        .then((r) => (r && r.length ? r : [emptyRow(custom)]))
        .catch(() => [emptyRow(custom)])
    );
  }
  const res = await Promise.all(jobs);
  return res.flat().filter(Boolean);
}

module.exports = { collectOthers };
