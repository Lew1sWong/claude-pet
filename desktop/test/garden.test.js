const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../lib/garden");

const H1 = 3600e3;

test("plant / grow / harvest at full pace", () => {
  const g = G.newGarden();
  assert.equal(G.plant(g, 0, "carrot", 0), true);
  assert.equal(G.plant(g, 0, "carrot", 0), false);          // occupied
  assert.equal(G.plant(g, 9, "carrot", 0), false);          // no such plot
  G.tick(g, "happy", 0);                                    // first tick only stamps lastTick
  assert.equal(g.plots[0].progress, 0);
  G.tick(g, "happy", 2.5 * H1);
  assert.ok(Math.abs(g.plots[0].progress - 0.5) < 1e-9);
  assert.equal(G.stageOf(g.plots[0]), 1);
  assert.equal(G.harvest(g, 0), null);                      // not ripe yet
  G.tick(g, "happy", 5 * H1);
  assert.equal(g.plots[0].progress, 1);
  assert.equal(G.stageOf(g.plots[0]), 3);
  assert.equal(G.harvest(g, 0), "carrot");
  assert.equal(g.plots[0], null);
  assert.equal(g.harvested, 1);
});

test("mood sets the pace; depleted wilts, happier moods recover; reset waters", () => {
  const g = G.newGarden();
  G.plant(g, 1, "tomato", 0);
  G.tick(g, "anxious", 0);
  G.tick(g, "anxious", 2 * H1);                             // 0.15 × 2/9
  assert.ok(Math.abs(g.plots[1].progress - (0.15 * 2) / 9) < 1e-9);
  G.tick(g, "depleted", 7 * H1);                            // 5 h with no growth → wilt 0.5
  assert.ok(Math.abs(g.plots[1].wilt - 0.5) < 1e-9);
  const before = g.plots[1].progress;
  G.tick(g, "calm", 8 * H1);                                // grows again, wilt drops 2×
  assert.ok(g.plots[1].progress > before);
  assert.ok(Math.abs(g.plots[1].wilt - 0.3) < 1e-9);
  G.water(g);
  assert.equal(g.plots[1].wilt, 0);
  assert.ok(g.plots[1].progress >= before + 0.15);
});

test("catch-up tick is capped (laptop slept for a day)", () => {
  const g = G.newGarden();
  G.plant(g, 2, "carrot", 0);
  G.tick(g, "happy", 0);
  G.tick(g, "happy", 24 * H1);
  assert.equal(g.plots[2].progress, 1);                    // capped at 6 h ≥ 5 h grow time → ripe, not over
  const g2 = G.newGarden();
  G.plant(g2, 0, "sunflower", 0);
  G.tick(g2, "happy", 0);
  G.tick(g2, "happy", 24 * H1);
  assert.ok(Math.abs(g2.plots[0].progress - 6 / 14) < 1e-9);
});

test("sanitize repairs persisted garbage", () => {
  const g = G.sanitize({ plots: [{ crop: "weed", progress: 2 }, { crop: "tomato", progress: "0.5", wilt: -3 }, "x", {}], harvested: "7", lastTick: "nope" });
  assert.equal(g.plots.length, 3);
  assert.equal(g.plots[0], null);
  assert.equal(g.plots[1].progress, 0.5);
  assert.equal(g.plots[1].wilt, 0);
  assert.equal(g.plots[2], null);
  assert.equal(g.harvested, 7);
  assert.equal(g.lastTick, null);
  assert.deepEqual(G.sanitize(null).plots, [null, null, null]);
});

// tick like the running app does (every few minutes)
function run(g, mood, from, to, step = 5 * 60e3) {
  for (let t = from; t <= to; t += step) G.tick(g, mood, t);
}

test("🐦‍⬛ crow: shows up on a ripe crop after 8 h, eats it 4 h later unless shooed", () => {
  const g = G.newGarden();
  G.plant(g, 0, "carrot", 0);
  run(g, "happy", 0, 5 * H1);                       // ripe at t=5h
  assert.equal(g.plots[0].ripeAt, 5 * H1);
  run(g, "happy", 5 * H1, 12 * H1);                 // 7 h ripe → no crow yet
  assert.equal(g.plots[0].crow, null);
  run(g, "happy", 12 * H1, 13.5 * H1);              // 8.5 h → crow lands
  assert.ok(g.plots[0].crow);
  assert.equal(G.crowAt(g), 0);
  assert.equal(G.shoo(g, 0, 13.5 * H1), true);      // shooed: timer restarts
  assert.equal(g.plots[0].crow, null);
  assert.equal(g.shooed, 1);
  assert.equal(G.shoo(g, 0, 13.5 * H1), false);
  run(g, "happy", 13.5 * H1, 19 * H1);              // 5.5 h since shoo → no crow (needs 8 h)
  assert.equal(g.plots[0].crow, null);
  run(g, "happy", 19 * H1, 22 * H1);                // 8.5 h → crow again
  assert.ok(g.plots[0].crow);
  run(g, "happy", 22 * H1, 25 * H1);                // ignored ~3 h → still there
  assert.ok(g.plots[0]);
  run(g, "happy", 25 * H1, 27 * H1);                // > 4 h → gone
  assert.equal(g.plots[0], null);
  assert.equal(g.lost, 1);
  assert.equal(g.lastLoss.crop, "carrot");
  assert.equal(G.crowAt(g), -1);
});

test("harvesting a crop with a crow on it still works; sanitize keeps crow fields", () => {
  const g = G.newGarden();
  g.plots[1] = { crop: "tomato", progress: 1, wilt: 0, plantedAt: 0, ripeAt: 0, crow: { since: 1 } };
  assert.equal(G.harvest(g, 1), "tomato");
  const s = G.sanitize({ plots: [null, null, { crop: "sunflower", progress: 1, ripeAt: 5, crow: { since: 9 } }], lost: 2, shooed: "3", lastLoss: { crop: "carrot", at: 7 } });
  assert.deepEqual(s.plots[2].crow, { since: 9 });
  assert.equal(s.plots[2].ripeAt, 5);
  assert.equal(s.lost, 2); assert.equal(s.shooed, 3); assert.deepEqual(s.lastLoss, { crop: "carrot", at: 7 });
});

test("🐦‍⬛ sleep doesn't count toward the crow (clocks shift by time beyond the catch-up cap)", () => {
  // crow landed at 23:00, lid closed 23:05, opened 07:00 → the crow is still there, not fed
  const g = G.newGarden();
  g.plots[0] = { crop: "carrot", progress: 1, wilt: 0, plantedAt: 0, ripeAt: 0, crow: { since: 23 * H1 } };
  G.tick(g, "happy", 23 * H1);
  G.tick(g, "happy", 23 * H1 + 5 * 60e3);
  G.tick(g, "happy", 31 * H1);                   // 7 h 55 m later; cap is 6 h
  assert.ok(g.plots[0], "crop survives the night");
  assert.ok(g.plots[0].crow, "crow still waiting");
  assert.ok(31 * H1 - g.plots[0].crow.since <= 20 * 60e3, "only the awake minutes counted");
  // a ripe crop without a crow: its ripe clock shifts too
  const h = G.newGarden();
  h.plots[1] = { crop: "tomato", progress: 1, wilt: 0, plantedAt: 0, ripeAt: 0, crow: null };
  G.tick(h, "happy", 1 * H1);
  G.tick(h, "happy", 30 * H1);                   // 29 h away, cap 6 h → counts as 7 h ripe
  assert.equal(h.plots[1].crow, null);
});

test("🎃 seasonal crop joins the rotation only while its season is on", () => {
  const g = G.newGarden();
  // rotation with the pumpkin: harvested 0 → plot i picks pool[i % 4]
  assert.equal(G.plant(g, 3 - 3, null, 0, "pumpkin"), true);  // plot 0 → carrot
  assert.equal(g.plots[0].crop, "carrot");
  g.harvested = 2;
  assert.equal(G.plant(g, 1, null, 0, "pumpkin"), true);      // (2 + 1) % 4 → pumpkin
  assert.equal(g.plots[1].crop, "pumpkin");
  // explicit pumpkin outside the season is refused → rotation over the base crops
  const h = G.newGarden();
  G.plant(h, 0, "pumpkin", 0, null);
  assert.equal(h.plots[0].crop, "carrot");
  // but an existing pumpkin survives sanitize after the season
  const s = G.sanitize({ plots: [{ crop: "pumpkin", progress: 0.5 }, null, null] });
  assert.equal(s.plots[0].crop, "pumpkin");
  assert.equal(G.GROW_MS.pumpkin, 7 * 3600e3);
});

test("📋 an S / A week boosts growth for the next 7 days; C doesn't; the boost expires", () => {
  const g = G.newGarden();
  assert.equal(G.applyGradeBoost(g, "C", 0), null);
  assert.equal(g.boost, null);
  assert.deepEqual(G.applyGradeBoost(g, "S", 0), { factor: 1.3, until: 7 * 24 * H1, grade: "S" });
  G.plant(g, 0, "carrot", 0);
  G.tick(g, "happy", 0);
  G.tick(g, "happy", 1 * H1);                                   // 1 h at 1.3× → 1.3/5
  assert.ok(Math.abs(g.plots[0].progress - 1.3 / 5) < 1e-9, "boosted: " + g.plots[0].progress);
  assert.ok(G.activeBoost(g, 6 * 24 * H1));
  assert.equal(G.activeBoost(g, 8 * 24 * H1), null);
  G.tick(g, "happy", 8 * 24 * H1);                              // past `until` → boost dropped
  assert.equal(g.boost, null);
  // A → 1.15; sanitize keeps a valid boost and drops garbage
  G.applyGradeBoost(g, "A", 0);
  assert.equal(g.boost.factor, 1.15);
  const s = G.sanitize({ plots: [], boost: { factor: 9, until: 5, grade: "S" } });
  assert.equal(s.boost.factor, 2);                               // capped
  assert.equal(G.sanitize({ plots: [], boost: { factor: 1, until: 5 } }).boost, null);
  assert.equal(G.sanitize({ plots: [], boost: "x" }).boost, null);
});
