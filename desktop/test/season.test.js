const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/season");

const at = (y, m, d) => new Date(y, m - 1, d, 12);

test("fixed-date seasons incl. boundaries and the year wrap", () => {
  assert.equal(S.currentSeason(at(2026, 10, 19)), null);
  assert.equal(S.currentSeason(at(2026, 10, 20)).id, "halloween");
  assert.equal(S.currentSeason(at(2026, 10, 26)).hat, "witch");
  assert.equal(S.currentSeason(at(2026, 10, 26)).crop, "pumpkin");
  assert.equal(S.currentSeason(at(2026, 11, 2)).id, "halloween");
  assert.equal(S.currentSeason(at(2026, 11, 3)), null);
  assert.equal(S.currentSeason(at(2026, 12, 18)).id, "christmas");
  assert.equal(S.currentSeason(at(2026, 12, 27)).hat, "santa");
  assert.equal(S.currentSeason(at(2026, 12, 28)), null);
  assert.equal(S.currentSeason(at(2026, 12, 31)).id, "newyear");
  assert.equal(S.currentSeason(at(2027, 1, 1)).id, "newyear");
  assert.equal(S.currentSeason(at(2027, 1, 2)).hat, "party");
  assert.equal(S.currentSeason(at(2027, 1, 3)), null);
  assert.equal(S.currentSeason(at(2026, 7, 1)), null);
});

test("lunar new year: 除夕 through 初六 per year", () => {
  assert.equal(S.currentSeason(at(2027, 2, 4)), null);
  assert.equal(S.currentSeason(at(2027, 2, 5)).id, "lunar");     // 除夕
  assert.equal(S.currentSeason(at(2027, 2, 6)).id, "lunar");     // 初一
  assert.equal(S.currentSeason(at(2027, 2, 12)).id, "lunar");    // 初六
  assert.equal(S.currentSeason(at(2027, 2, 13)), null);
  assert.equal(S.currentSeason(at(2028, 1, 25)).id, "lunar");    // 2028 除夕 (初一 = Jan 26)
  assert.equal(S.currentSeason(at(2026, 2, 16)).id, "lunar");
});

test("seasonKey is stable within a season and distinct across years", () => {
  assert.equal(S.seasonKey(S.currentSeason(at(2026, 10, 26))), "halloween-2026");
  assert.equal(S.seasonKey(S.currentSeason(at(2026, 12, 31))), "newyear-2026");
  assert.equal(S.seasonKey(S.currentSeason(at(2027, 1, 1))), "newyear-2027");
  assert.equal(S.seasonKey(null), null);
});
