const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../lib/alerts");
const { isOverage } = require("../lib/usageClient");

const H1 = 3600e3;
const u = (o) => ({ fiveHour: o.f != null ? { pct: o.f, resetsAt: o.fr || "2026-10-26T10:00:00Z" } : null,
  week: o.w != null ? { pct: o.w, resetsAt: o.wr || "2026-10-30T00:00:00Z" } : null,
  fable: o.fb != null ? { pct: o.fb } : null,
  extra: o.ex || null, scoped: [] });
const types = (r) => r.events.map((e) => e.type + (e.window ? ":" + e.window : "") + (e.level ? ":" + e.level : "") + (e.key ? ":" + e.key : ""));
const opts = { isOverage };

test("first reading never alerts, but seeds the state", () => {
  const r = A.evaluate(A.initialState(), u({ f: 95, w: 60, fb: 90 }), null, opts);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.fiveHour, 95); assert.equal(r.state.week, 60); assert.equal(r.state.fable, 90);
});

test("5h reset: high → ≥50-point drop; small drops don't count", () => {
  let s = A.evaluate(A.initialState(), u({ f: 90, w: 10 }), null, opts).state;
  assert.deepEqual(types(A.evaluate(s, u({ f: 55, w: 10 }), null, opts)), []);
  assert.deepEqual(types(A.evaluate(s, u({ f: 5, w: 10 }), null, opts)), ["reset:five"]);
  s = A.evaluate(A.initialState(), u({ f: 60, w: 10 }), null, opts).state;   // not "high" enough
  assert.deepEqual(types(A.evaluate(s, u({ f: 2, w: 10 }), null, opts)), []);
});

test("weekly: newWeek on a 15-point drop or a resets_at jump; party only on a big drop", () => {
  let s = A.evaluate(A.initialState(), u({ f: 10, w: 45, wr: "2026-10-30T00:00:00Z" }), null, opts).state;
  // light week ended: graded, no party
  let r = A.evaluate(s, u({ f: 10, w: 3, wr: "2026-11-06T00:00:00Z" }), null, opts);
  assert.deepEqual(types(r), ["newWeek"]);
  // slept through the reset: % already climbed back, only the reset time tells
  s = A.evaluate(A.initialState(), u({ f: 10, w: 60, wr: "2026-10-30T00:00:00Z" }), null, opts).state;
  r = A.evaluate(s, u({ f: 10, w: 55, wr: "2026-11-06T00:00:00Z" }), null, opts);
  assert.deepEqual(types(r), ["newWeek"]);
  // big drop: graded AND a party (flagged as graded so the plain toast is skipped)
  s = A.evaluate(A.initialState(), u({ f: 10, w: 80, wr: "2026-10-30T00:00:00Z" }), null, opts).state;
  r = A.evaluate(s, u({ f: 10, w: 5, wr: "2026-11-06T00:00:00Z" }), null, opts);
  assert.deepEqual(types(r), ["newWeek", "reset:week"]);
  assert.equal(r.events[1].graded, true);
  // normal climb within the week: nothing
  assert.deepEqual(types(A.evaluate(s, u({ f: 10, w: 82, wr: "2026-10-30T00:00:00Z" }), null, opts)), []);
});

test("Fable reminders at 80 / 95 (highest crossed, once) and its reset", () => {
  let s = A.evaluate(A.initialState(), u({ f: 10, w: 10, fb: 70 }), null, opts).state;
  let r = A.evaluate(s, u({ f: 10, w: 10, fb: 85 }), null, opts);
  assert.deepEqual(types(r), ["fable:80"]); assert.equal(r.events[0].pct, 85);
  s = r.state;
  r = A.evaluate(s, u({ f: 10, w: 10, fb: 96 }), null, opts);
  assert.deepEqual(types(r), ["fable:95"]);
  s = r.state;
  assert.deepEqual(types(A.evaluate(s, u({ f: 10, w: 10, fb: 97 }), null, opts)), []);   // no re-toast
  assert.deepEqual(types(A.evaluate(s, u({ f: 10, w: 10, fb: 4 }), null, opts)), ["reset:fable"]);
  // jumping straight past both thresholds → one toast, the 95 one
  s = A.evaluate(A.initialState(), u({ f: 10, w: 10, fb: 10 }), null, opts).state;
  assert.deepEqual(types(A.evaluate(s, u({ f: 10, w: 10, fb: 99 }), null, opts)), ["fable:95"]);
});

test("usage credits: overageOn only on a false→true transition; 80 / 95 of the cap", () => {
  const credits = (pct) => ({ enabled: true, pct, spendLimitReached: false });
  // app starts already in overage → no toast (prev.overage null)
  let r = A.evaluate(A.initialState(), u({ f: 100, w: 10, ex: credits(10) }), null, opts);
  assert.deepEqual(types(r), []);
  let s = A.evaluate(A.initialState(), u({ f: 50, w: 10, ex: credits(10) }), null, opts).state;
  r = A.evaluate(s, u({ f: 100, w: 10, ex: credits(12) }), null, opts);
  assert.deepEqual(types(r), ["overageOn"]); assert.equal(r.events[0].pct, 12);
  s = r.state;
  r = A.evaluate(s, u({ f: 100, w: 10, ex: credits(83) }), null, opts);
  assert.deepEqual(types(r), ["extra:80"]);
  s = r.state;
  assert.deepEqual(types(A.evaluate(s, u({ f: 100, w: 10, ex: credits(97) }), null, opts)), ["extra:95"]);
  // restored state from a cached payload keeps the overage flag so no spurious toast
  const restored = A.stateFromUsage(u({ f: 100, w: 10, ex: credits(20) }), { f: "x" }, isOverage);
  assert.equal(restored.overage, true); assert.deepEqual(restored.pace, { f: "x" });
  assert.deepEqual(types(A.evaluate(restored, u({ f: 100, w: 10, ex: credits(21) }), null, opts)), []);
});

test("pace alarms: once per window instance, real ETA only, weekly only when underway", () => {
  const trend = (fw, ww, etaF = 2 * H1, etaW = 20 * H1) => ({
    five: { weather: fw, etaMs: etaF, resetMs: 3 * H1 }, week: { weather: ww, etaMs: etaW, resetMs: 100 * H1 }, worst: "f",
  });
  let s = A.initialState();
  let r = A.evaluate(s, u({ f: 40, w: 10 }), trend("storm", "rain"), opts);
  assert.deepEqual(types(r), ["pace:f"]);                 // weekly at 10 % → not underway
  assert.equal(r.events[0].etaMs, 2 * H1);
  s = r.state;
  assert.deepEqual(types(A.evaluate(s, u({ f: 45, w: 10 }), trend("storm", "rain"), opts)), []);   // same window → no repeat
  r = A.evaluate(s, u({ f: 45, w: 35 }), trend("storm", "rain"), opts);
  assert.deepEqual(types(r), ["pace:w"]);                 // weekly now underway
  s = r.state;
  // new 5h window (different resets_at) → may alarm again
  r = A.evaluate(s, u({ f: 50, w: 36, fr: "2026-10-26T15:00:00Z" }), trend("storm", "storm"), opts);
  assert.deepEqual(types(r), ["pace:f"]);
  s = r.state;
  // 5h at "rain" never alarms; an already-dry window (eta null) never alarms
  assert.deepEqual(types(A.evaluate(s, u({ f: 50, w: 36, fr: "2026-10-26T20:00:00Z" }), trend("rain", "sunny"), opts)), []);
  assert.deepEqual(types(A.evaluate(s, u({ f: 100, w: 36, fr: "2026-10-26T20:00:00Z" }), trend("storm", "sunny", null), opts)), []);
  assert.deepEqual(s.pace, { f: "2026-10-26T15:00:00Z", w: "2026-10-30T00:00:00Z" });
});

test("null usage / no trend are harmless", () => {
  const r = A.evaluate(A.initialState(), null, null, opts);
  assert.deepEqual(r.events, []);
  assert.deepEqual(A.stateFromUsage(null, null, isOverage), A.initialState());
});
