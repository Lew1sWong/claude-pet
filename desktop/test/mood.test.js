// renderer/petcore.js mood logic vs lib/usageClient.js helpers — both must agree
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

global.window = {};
global.SPRITES = { frames: {}, palettes: {}, eyes: {}, names: {} };
require("../renderer/petcore.js");
const PetCore = global.window.PetCore;
const lib = require("../lib/usageClient");

const live = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "usage-2026-10.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const withLimits = (session, weekly, scopedPct, extra) => {
  const raw = clone(live);
  raw.limits[0].percent = session; raw.five_hour.utilization = session;
  raw.limits[1].percent = weekly; raw.seven_day.utilization = weekly;
  raw.limits[2].percent = scopedPct;
  if (extra) raw.extra_usage = { ...raw.extra_usage, ...extra };
  return lib.normalize(raw);
};

test("live fixture → calm (weekly 53% is the worst window)", () => {
  assert.equal(PetCore.computeMode(lib.normalize(live), null), "calm");
});

test("thresholds: happy / calm / sleepy / anxious / depleted", () => {
  assert.equal(PetCore.computeMode(withLimits(10, 20, 0), null), "happy");
  assert.equal(PetCore.computeMode(withLimits(45, 20, 0), null), "calm");
  assert.equal(PetCore.computeMode(withLimits(10, 75, 0), null), "sleepy");
  assert.equal(PetCore.computeMode(withLimits(10, 20, 92), null), "anxious");   // Fable ✦ counts
  assert.equal(PetCore.computeMode(withLimits(10, 20, 100), null), "anxious");  // scoped alone never = depleted
  assert.equal(PetCore.computeMode(withLimits(100, 20, 0), null), "depleted");
  assert.equal(PetCore.computeMode(withLimits(10, 100, 0), null), "depleted");
});

test("overage: plan dry + credits enabled → overage; capped credits → depleted", () => {
  assert.equal(PetCore.computeMode(withLimits(100, 20, 0, { is_enabled: true, utilization: 30 }), null), "overage");
  assert.equal(PetCore.computeMode(withLimits(100, 20, 0, { is_enabled: true, spend_limit_reached: true }), null), "depleted");
  assert.equal(PetCore.computeMode(withLimits(100, 20, 0, { is_enabled: true, utilization: 100 }), null), "depleted");
  assert.equal(PetCore.computeMode(withLimits(50, 20, 0, { is_enabled: true, utilization: 30 }), null), "calm"); // credits idle
});

test("locked window → depleted with a reason, never overage", () => {
  const raw = clone(live);
  raw.limits[1].locked_reason = "org_policy";
  raw.extra_usage.is_enabled = true;
  const u = lib.normalize(raw);
  assert.equal(PetCore.computeMode(u, null), "depleted");
  assert.equal(PetCore.lockedReason(u), "org_policy");
  assert.equal(PetCore.blockingWindow(u), u.week);
});

test("blockingWindow picks the later reset when both windows are dry", () => {
  const u = withLimits(100, 100, 0);
  assert.equal(PetCore.blockingWindow(u), u.week);   // weekly resets later
});

test("errors + others fallback", () => {
  assert.equal(PetCore.computeMode(null, "no-credentials"), "lost");
  assert.equal(PetCore.computeMode(null, "auth"), "lost");
  assert.equal(PetCore.computeMode(null, null), "unknown");
  assert.equal(PetCore.computeMode({ fiveHour: null, week: null, scoped: [], others: [] }, null), "unknown");
  assert.equal(PetCore.computeMode({ fiveHour: null, week: null, scoped: [], others: [{ windows: [{ pct: 95 }] }] }, null), "anxious");
  // cached payload from <0.2.0 (no `scoped`, only `fable`) still works
  assert.equal(PetCore.computeMode({ fiveHour: { pct: 10 }, week: { pct: 10 }, fable: { pct: 80 } }, null), "sleepy");
});

test("petcore and lib agree on planExhausted / isOverage across a grid", () => {
  let n = 0;
  for (const s of [0, 50, 99, 99.5, 100]) for (const w of [0, 99, 100]) for (const ex of [null, { is_enabled: true, utilization: 10 }, { is_enabled: true, utilization: 100 }, { is_enabled: true, spend_limit_reached: true }, { is_enabled: false }]) {
    const u = withLimits(s, w, 0, ex);
    assert.equal(PetCore.planExhausted(u), lib.planExhausted(u), `planExhausted s=${s} w=${w}`);
    assert.equal(PetCore.isOverage(u), lib.isOverage(u), `isOverage s=${s} w=${w} ex=${JSON.stringify(ex)}`);
    n++;
  }
  assert.ok(n > 50);
});

test("extraSummary / fmtMoney", () => {
  const u = withLimits(100, 0, 0, { is_enabled: true, utilization: 24.68, monthly_limit: 5000, used_credits: 1234 });
  const s = PetCore.extraSummary(u);
  assert.match(s, /25%/);
  assert.match(s, /12\.34/);
  assert.match(s, /50/);
  assert.equal(PetCore.fmtMoney(null), null);
  assert.equal(PetCore.extraSummary({ extra: null }), "");
});
