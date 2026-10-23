const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../lib/report");

const H1 = 3600e3;
// Monday 2026-10-19 00:00 UTC as "local" midnight; parts derived in UTC
const MON = Date.UTC(2026, 9, 19);
const parts = (t) => { const d = new Date(t); return { day: d.getUTCDay(), hour: d.getUTCHours() }; };

// one sample per 10 min; f(t) and w(t) callbacks produce the series
function series(from, hours, fFn, wFn) {
  const out = [];
  for (let i = 0; i <= hours * 6; i++) { const t = from + i * 10 * 60e3; const h = i / 6; out.push({ t, f: fFn(h), w: wFn(h) }); }
  return out;
}

test("too little data → empty card", () => {
  const r = R.computeReport([{ t: MON, f: 1, w: 1 }], {}, MON + H1);
  assert.equal(r.grade, null); assert.equal(r.samples, 1);
});

test("steady, even week with no depletion → S grade, pace master", () => {
  // every day 09:00-17:00 the 5h window climbs 0→60 then resets; weekly climbs evenly
  const f = (h) => { const hod = h % 24; return hod >= 9 && hod < 17 ? ((hod - 9) / 8) * 60 : 0; };
  const w = (h) => Math.min(100, (h / (7 * 24)) * 70);
  const s = series(MON, 6.9 * 24, f, w);
  const r = R.computeReport(s, { localParts: parts }, MON + 6.9 * 24 * H1);
  assert.equal(r.depletions, 0); assert.equal(r.nearMisses, 0);
  assert.ok(r.evenness > 0.8, "evenness " + r.evenness);
  assert.equal(r.grade, "S"); assert.equal(r.title, "pace");
  assert.ok(r.usedPct > 60);
});

test("three depletions → furnace, grade C-ish, depleted tip", () => {
  const f = (h) => { const hod = h % 24; return hod >= 8 && hod < 13 ? Math.min(100, ((hod - 8) / 4) * 100) : 0; };  // hits 100 daily
  const w = (h) => Math.min(100, (h / (7 * 24)) * 100);
  const s = series(MON, 3 * 24, f, w);
  const r = R.computeReport(s, { localParts: parts }, MON + 3 * 24 * H1);
  assert.equal(r.depletions, 3);
  assert.equal(r.title, "furnace");
  assert.ok(r.score <= 64, "score " + r.score);
  assert.ok(r.tips.includes("depleted"));
});

test("late-night burning → owl title and an owl tip", () => {
  const f = (h) => { const hod = h % 24; return hod < 4 ? (hod / 4) * 80 : 0; };   // 00:00-04:00 only
  const w = (h) => Math.min(100, (h / (7 * 24)) * 50);
  const s = series(MON, 4 * 24, f, w);
  const r = R.computeReport(s, { localParts: parts }, MON + 4 * 24 * H1);
  assert.ok(r.lateNightShare > 0.9, "late " + r.lateNightShare);
  assert.equal(r.title, "owl");
  assert.ok(r.tips.includes("owl"));
});

test("weekend warrior, peak day, and the weekly reset cuts the window", () => {
  // two weeks of data; the weekly % resets at the start of week 2 → only week 2 counts
  const SAT = MON + 5 * 24 * H1;
  const f = (h) => { const d = Math.floor(h / 24) % 7; const hod = h % 24; return (d === 5 || d === 6) && hod >= 10 && hod < 15 ? ((hod - 10) / 5) * 70 : 0; };
  const w = (h) => (h < 7 * 24 ? 90 : Math.min(100, ((h - 7 * 24) / (7 * 24)) * 60));
  const s = series(MON, 13.9 * 24, f, w);
  const now = MON + 13.9 * 24 * H1;
  const r = R.computeReport(s, { localParts: parts, harvested: 4 }, now);
  assert.ok(r.since >= MON + 7 * 24 * H1 - 11 * 60e3, "window starts at the reset");
  assert.ok(r.weekendShare > 0.95);
  assert.equal(r.title, "weekend");
  assert.ok([0, 6].includes(r.peakDay));
  void SAT;
});

test("crow losses cost points and add a tip; farmer title when harvesting a lot", () => {
  const f = (h) => { const hod = h % 24; return hod >= 9 && hod < 17 ? ((hod - 9) / 8) * 50 : 0; };
  const w = (h) => Math.min(100, (h / (7 * 24)) * 60);
  const s = series(MON, 5 * 24, f, w);
  const base = R.computeReport(s, { localParts: parts }, MON + 5 * 24 * H1);
  const lossy = R.computeReport(s, { localParts: parts, lost: 2 }, MON + 5 * 24 * H1);
  assert.ok(base.score > lossy.score, `${base.score} vs ${lossy.score}`);   // base sits at the 100 cap
  assert.equal(R.computeReport(s, { localParts: parts, lost: 2 }, MON + 5 * 24 * H1).score, 99);
  assert.ok(lossy.tips.includes("crow"));
  // make it uneven so "pace" doesn't win, then farmer should
  const f2 = (h) => (Math.floor(h / 24) === 1 ? f(h) : 0);
  const r = R.computeReport(series(MON, 5 * 24, f2, w), { localParts: parts, harvested: 3 }, MON + 5 * 24 * H1);
  assert.equal(r.title, "farmer");
});
