// web/app.js carries its own copy of the usage normalizer (the PWA has no
// module loader). Extract it and make sure it agrees with lib/usageClient.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const lib = require("../lib/usageClient");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "web", "app.js"), "utf8");
const start = src.indexOf("  function pctOf(v) {");
const end = src.indexOf("  async function fetchUsage(token, proxy) {");
assert.ok(start > 0 && end > start, "could not locate the normalizer block in web/app.js");
const code = "const FABLE_RE = /fable|mythos/i;\n" + src.slice(start, end) + "\nnormalize";
const webNormalize = vm.runInNewContext(code, {});

const live = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "usage-2026-10.json"), "utf8"));
const pickScoped = (s) => ({ key: s.key, label: s.label, pct: s.pct, resetsAt: s.resetsAt, sharePct: s.sharePct });
const pickExtra = (e) => e && ({ enabled: e.enabled, pct: e.pct, used: e.used, limit: e.limit, currency: e.currency, disabledReason: e.disabledReason, spendLimitReached: e.spendLimitReached });
const view = (u) => ({
  fiveHour: u.fiveHour, week: u.week,
  fable: u.fable && pickScoped(u.fable),
  scoped: (u.scoped || []).map(pickScoped),
  extra: pickExtra(u.extra),
  breakdown: u.breakdown && u.breakdown.rows,
});

const cases = {
  live,
  legacy: {
    five_hour: { utilization: 0.42, resets_at: 1760000000 },
    seven_day: { utilization: 18, resets_at: "2026-06-09T00:00:00Z" },
    seven_day_opus: { utilization: 70, resets_at: "2026-06-09T00:00:00Z" },
    seven_day_fable: { utilization: 88, resets_at: "2026-06-09T00:00:00Z" },
  },
  overage: (() => {
    const raw = JSON.parse(JSON.stringify(live));
    raw.limits[0].percent = 100;
    raw.extra_usage = { ...raw.extra_usage, is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68 };
    raw.limits[1].locked_reason = "org_policy";
    return raw;
  })(),
  dollars: { five_hour: { limit_dollars: 250, used_dollars: 62.5, resets_at: "2026-11-05T07:59:00+00:00" } },
  garbage: { limits: [null, {}, { kind: "session" }], extra_usage: "x", seven_day_breakdown: { rows: [null, { key: 1 }] } },
};

for (const [name, raw] of Object.entries(cases)) {
  test(`web normalizer matches desktop on "${name}"`, () => {
    // JSON round-trip: the vm realm has its own Object prototype
    const j = (v) => JSON.parse(JSON.stringify(v));
    assert.deepEqual(j(view(webNormalize(raw))), j(view(lib.normalize(raw))));
  });
}
