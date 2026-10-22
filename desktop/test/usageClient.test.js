// Run with: npm test  (node --test)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalize, pickClaude, planExhausted, extraActive, isOverage } = require("../lib/usageClient");

const live = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "usage-2026-10.json"), "utf8"));

test("2026-10 payload: limits[] drives session / weekly / Fable scoped", () => {
  const u = normalize(live);
  assert.equal(u.fiveHour.pct, 33);
  assert.equal(u.fiveHour.resetsAt, "2026-10-22T11:20:00.768932+00:00");
  assert.equal(u.fiveHour.severity, "normal");
  assert.equal(u.fiveHour.isActive, false);
  assert.equal(u.week.pct, 53);
  assert.equal(u.week.isActive, true);
  assert.equal(u.scoped.length, 1);
  assert.equal(u.scoped[0].label, "Fable");
  assert.equal(u.scoped[0].key, "fable");
  assert.equal(u.scoped[0].pct, 9);
  assert.equal(u.scoped[0].sharePct, 50);
  assert.equal(u.scoped[0].usedOfWeeklyPct, 5);
  assert.equal(u.fable, u.scoped[0]);
  assert.equal(u.weekOpus, null);
});

test("2026-10 payload: extra usage + breakdown are surfaced", () => {
  const u = normalize(live);
  assert.equal(u.extra.enabled, false);
  assert.equal(u.extra.disabledReason, "out_of_credits");
  assert.equal(u.extra.currency, "SGD");
  assert.equal(u.extra.used, 0);
  assert.equal(u.extra.limit, null);
  assert.equal(u.extra.pct, 0);            // spend.percent fallback
  assert.equal(u.extra.spendLimitReached, false);
  assert.deepEqual(u.breakdown.rows.map((r) => [r.key, r.pct]), [
    ["claude_code", 79], ["chat", 2], ["cowork", 19], ["other", 0],
  ]);
  assert.equal(u.breakdown.asOf, "2026-10-22T10:17:05.800239+00:00");
});

test("microsecond ISO timestamps from the API parse to a real Date", () => {
  const u = normalize(live);
  assert.ok(!isNaN(new Date(u.fiveHour.resetsAt).getTime()));
  assert.ok(!isNaN(new Date(u.scoped[0].resetsAt).getTime()));
});

test("legacy payload (pre-limits[]) still normalizes, incl. opus + fable keys", () => {
  const u = normalize({
    five_hour: { utilization: 0.42, resets_at: 1760000000 },
    seven_day: { utilization: 18, resets_at: "2026-06-09T00:00:00Z" },
    seven_day_opus: { utilization: 70, resets_at: "2026-06-09T00:00:00Z" },
    seven_day_fable: { utilization: 88, resets_at: "2026-06-09T00:00:00Z" },
  });
  assert.equal(u.fiveHour.pct, 42);
  assert.equal(u.fiveHour.resetsAt, new Date(1760000000 * 1000).toISOString());
  assert.equal(u.week.pct, 18);
  assert.equal(u.weekOpus.pct, 70);
  assert.equal(u.fable.pct, 88);
  assert.equal(u.scoped.length, 2);
  assert.equal(u.extra, null);
  assert.equal(u.breakdown, null);
});

test("limits[] wins over legacy keys when both exist (no double rows)", () => {
  const raw = { ...live, five_hour: { utilization: 1 }, seven_day_opus: { utilization: 5 }, seven_day_fable: { utilization: 7 } };
  const u = normalize(raw);
  assert.equal(u.fiveHour.pct, 33);
  assert.equal(u.scoped.map((s) => s.label).join(","), "Fable,Opus");
  assert.equal(u.fable.pct, 9);
});

test("extra usage enabled with a cap → money in major units, overage detection", () => {
  const raw = JSON.parse(JSON.stringify(live));
  raw.limits[0].percent = 100;
  raw.five_hour.utilization = 100;
  raw.extra_usage = { ...raw.extra_usage, is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68, disabled_reason: null };
  raw.spend = { ...raw.spend, enabled: true, percent: 24.68, used: { amount_minor: 1234, currency: "SGD", exponent: 2 } };
  const u = normalize(raw);
  assert.equal(u.extra.enabled, true);
  assert.equal(u.extra.used, 12.34);
  assert.equal(u.extra.limit, 50);
  assert.equal(u.extra.pct, 24.68);
  assert.equal(planExhausted(u), true);
  assert.equal(extraActive(u), true);
  assert.equal(isOverage(u), true);
  // cap reached → back to plain depleted
  raw.extra_usage.spend_limit_reached = true;
  const v = normalize(raw);
  assert.equal(isOverage(v), false);
  assert.equal(planExhausted(v), true);
});

test("a locked window counts as exhausted and is never 'overage'", () => {
  const raw = JSON.parse(JSON.stringify(live));
  raw.limits[1].locked_reason = "org_policy";
  raw.extra_usage.is_enabled = true;
  const u = normalize(raw);
  assert.equal(u.week.lockedReason, "org_policy");
  assert.equal(planExhausted(u), true);
  assert.equal(isOverage(u), false);
});

test("dollar-denominated windows derive a percent", () => {
  const u = normalize({ five_hour: { limit_dollars: 250, used_dollars: 62.5, resets_at: "2026-11-05T07:59:00+00:00" } });
  assert.equal(u.fiveHour.pct, 25);
});

test("garbage input is harmless", () => {
  for (const bad of [null, undefined, 42, "x", [], {}, { limits: "nope" }, { limits: [null, {}, { kind: "session" }] }]) {
    const u = normalize(bad);
    assert.equal(u.fiveHour, null);
    assert.equal(u.week, null);
    assert.deepEqual(u.scoped, []);
    assert.equal(u.fable, null);
    assert.equal(isOverage(u), false);
  }
});

test("pickClaude drops raw and keeps the renderer contract", () => {
  const c = pickClaude(normalize(live));
  assert.deepEqual(Object.keys(c).sort(), ["breakdown", "extra", "fable", "fiveHour", "scoped", "week", "weekOpus"]);
  assert.equal("raw" in c, false);
});

test("pickClaude upgrades a pre-0.2.0 cache (bare fable/weekOpus, no scoped)", () => {
  const c = pickClaude({ fiveHour: { pct: 10 }, week: { pct: 20 }, weekOpus: { pct: 30 }, fable: { pct: 40, resetsAt: "2026-10-24T00:00:00Z" }, raw: { x: 1 } });
  assert.equal(c.scoped.length, 2);
  assert.equal(c.fable.label, "Fable");
  assert.equal(c.fable.key, "fable");
  assert.equal(c.fable.pct, 40);
  assert.equal(c.weekOpus.label, "Opus");
  assert.equal("raw" in c, false);
  // already-normalized input is passed through untouched
  const live = require("./fixtures/usage-2026-10.json");
  const n = normalize(live);
  assert.deepEqual(pickClaude(n).scoped, n.scoped);
  assert.deepEqual(pickClaude(null).scoped, []);
});
