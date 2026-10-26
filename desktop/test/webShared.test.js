// web/shared/*.js must be exactly what scripts/sync-web.js generates from the
// desktop sources, and each wrapped module must evaluate in a browser-like
// scope and expose its global.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { generate, OUT } = require("../scripts/sync-web");

test("web/shared is in sync with the desktop sources (run `npm run sync-web`)", () => {
  for (const { out, content } of generate()) {
    const onDisk = fs.readFileSync(path.join(OUT, out), "utf8");
    assert.equal(onDisk, content, `web/shared/${out} is stale — run \`npm run sync-web\``);
  }
});

test("wrapped modules evaluate in a browser-like scope and expose their globals", () => {
  const win = { __lang: "zh" };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const f of ["strings.js", "usageClient.js", "history.js", "garden.js", "report.js", "season.js", "gardensprites.js", "seasonsprites.js", "sfx.js"]) {
    vm.runInContext(fs.readFileSync(path.join(OUT, f), "utf8"), ctx, { filename: f });
  }
  assert.equal(typeof win.PetUsage.normalize, "function");
  assert.equal(typeof win.PetHistory.trendOf, "function");
  assert.equal(typeof win.PetGarden.tick, "function");
  assert.equal(typeof win.PetReport.computeReport, "function");
  assert.equal(typeof win.PetSeason.currentSeason, "function");
  assert.ok(win.SEASON_SPRITES.hats.witch.length === 16);
  assert.ok(win.GARDEN_SPRITES.crops.pumpkin.length === 4);
  assert.equal(win.PetStrings.zh["app.name"], "Claude Pet");
  assert.ok(win.GARDEN_SPRITES.crops.carrot.length === 4);
  assert.equal(typeof win.SFX.play, "function");
  // the web normalizer IS the desktop normalizer now
  const live = require("./fixtures/usage-2026-10.json");
  assert.deepEqual(JSON.parse(JSON.stringify(win.PetUsage.normalize(live).scoped)), require("../lib/usageClient").normalize(live).scoped);
});
