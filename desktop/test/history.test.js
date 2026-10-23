const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../lib/history");

const H1 = 3600e3;
const series = (start, stepMin, values, key) => values.map((v, i) => ({ t: start + i * stepMin * 60e3, [key]: v }));

test("pushSample appends, replaces same-tick, trims by age and size", () => {
  const now = 10 * H1 * 24;
  let s = H.pushSample([], { t: now - 8 * 24 * H1, f: 1, w: 1 }, now);   // older than 7 d → dropped
  assert.equal(s.length, 0);
  s = H.pushSample(s, { t: now - H1, f: 10, w: 20 }, now);
  s = H.pushSample(s, { t: now - H1, f: 11, w: 21 }, now);              // same t → replaced
  assert.equal(s.length, 1); assert.equal(s[0].f, 11);
  s = H.pushSample(s, { t: now, f: null, w: null }, now);              // nothing to record
  assert.equal(s.length, 1);
  let big = [];
  for (let i = 0; i < H.MAX_SAMPLES + 50; i++) big = H.pushSample(big, { t: now - (H.MAX_SAMPLES + 50 - i) * 1000, f: 1, w: 1 }, now);
  assert.equal(big.length, H.MAX_SAMPLES);
});

test("forecast: steady 10 %/h climb → eta to 100 %", () => {
  const now = 50 * H1;
  const pts = series(now - H1, 5, Array.from({ length: 13 }, (_, i) => 30 + (i * 10) / 12), "f");   // 30→40 over 1 h
  const fc = H.forecast(pts, "f", now);
  assert.ok(Math.abs(fc.rate - 10) < 0.5, "rate ~10/h, got " + fc.rate);
  assert.ok(Math.abs(fc.etaMs - 6 * H1) < 0.3 * H1, "eta ~6 h, got " + fc.etaMs / H1);
});

test("forecast: too little data → null; flat usage → idle (eta null)", () => {
  const now = 50 * H1;
  assert.equal(H.forecast(series(now - 5 * 60e3, 2, [10, 10, 10], "f"), "f", now).rate, null);
  const flat = H.forecast(series(now - H1, 5, Array(13).fill(42), "f"), "f", now);
  assert.equal(flat.rate, 0); assert.equal(flat.etaMs, null);
});

test("forecast ignores samples before a reset drop", () => {
  const now = 50 * H1;
  const pts = series(now - H1, 5, [90, 92, 94, 96, 98, 99, 2, 4, 6, 8, 10, 12, 14], "f");
  const fc = H.forecast(pts, "f", now);
  assert.equal(fc.samples, 7);
  assert.ok(fc.rate > 20 && fc.rate < 30, "post-reset slope ~24/h, got " + fc.rate);
});

test("outlook weather buckets", () => {
  const now = 0;
  const reset = (h) => new Date(now + h * H1).toISOString();
  const fc = (etaH, pct = 50) => ({ rate: 10, etaMs: etaH === null ? null : etaH * H1, pct, samples: 10 });
  assert.equal(H.outlook(fc(null), reset(3), now).weather, "sunny");
  assert.equal(H.outlook(fc(6), reset(3), now).weather, "sunny");      // eta ≥ 1.5× reset
  assert.equal(H.outlook(fc(3.5), reset(3), now).weather, "cloudy");
  const rain = H.outlook(fc(2), reset(3), now);
  assert.equal(rain.weather, "rain"); assert.equal(rain.exhaustsBeforeReset, true);
  assert.equal(H.outlook(fc(1), reset(3), now).weather, "storm");
  assert.equal(H.outlook(fc(2, 100), reset(3), now).weather, "storm");
  assert.equal(H.outlook({ rate: null, etaMs: null, pct: null, samples: 0 }, reset(3), now).weather, "unknown");
});

test("trendOf picks the worse window and thins the weekly series", () => {
  const now = 100 * H1;
  let s = [];
  // weekly climbs 7.5 %/h for the last 8 h (60→100 would land before the 24 h reset)
  for (let i = 0; i < 2000; i++) s = H.pushSample(s, { t: now - (2000 - i) * 5 * 60e3, f: 20, w: Math.min(90, 30 + Math.max(0, i - 1904) * 0.625) }, now);
  const usage = { fiveHour: { pct: 20, resetsAt: new Date(now + 4 * H1).toISOString() }, week: { pct: 90, resetsAt: new Date(now + 24 * H1).toISOString() } };
  const t = H.trendOf(s, usage, now);
  assert.equal(t.five.weather, "sunny");
  assert.ok(t.week.weather === "rain" || t.week.weather === "storm", "weekly should be at risk, got " + t.week.weather);
  assert.equal(t.worst, "w");
  assert.ok(t.seriesW.length <= 241 && t.seriesW.length > 100);
  assert.ok(t.seriesF.length <= 73);
});
