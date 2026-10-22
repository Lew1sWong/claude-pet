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
