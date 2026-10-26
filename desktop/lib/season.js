// 🎃🎄🎆🧧 Seasons (pure, no Electron). A season is a date range that adds a
// hat to the pet, a greeting, its own quips and celebration emoji — and for
// Halloween a seasonal crop (pumpkin) to the garden rotation.
// Lunar New Year moves every year, so it's a per-year table.
const SEASONS = [
  { id: "halloween", from: [10, 20], to: [11, 2], hat: "witch", crop: "pumpkin", fx: ["🎃", "🦇", "👻"] },
  { id: "christmas", from: [12, 18], to: [12, 27], hat: "santa", crop: null, fx: ["🎄", "❄️", "🎁"] },
  { id: "newyear", from: [12, 31], to: [1, 2], hat: "party", crop: null, fx: ["🎆", "🎉", "✨"] },
];
// Lunar New Year: [month, day] of 正月初一 per year; the season runs 除夕 → 初六
const LUNAR = { 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3] };
const LUNAR_SEASON = { id: "lunar", hat: null, crop: null, fx: ["🧧", "🏮", "🐉"] };

const dayOf = (y, m, d) => Date.UTC(y, m - 1, d);

function inRange(date, from, to) {
  // compare on local calendar days; a range whose end month < start month wraps the year
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const t = dayOf(2000, m, d);                 // leap-safe pseudo-year
  const a = dayOf(2000, from[0], from[1]);
  const b = dayOf(2000, to[0], to[1]);
  return a <= b ? t >= a && t <= b : t >= a || t <= b;
}

function currentSeason(date) {
  const now = date instanceof Date ? date : new Date(date || Date.now());
  for (const s of SEASONS) if (inRange(now, s.from, s.to)) return { ...s, year: now.getFullYear() };
  const y = now.getFullYear();
  for (const yr of [y, y + 1]) {
    const cny = LUNAR[yr];
    if (!cny) continue;
    const start = new Date(yr, cny[0] - 1, cny[1] - 1);       // 除夕
    const end = new Date(yr, cny[0] - 1, cny[1] + 6, 23, 59, 59, 999);
    if (now >= start && now <= end) return { ...LUNAR_SEASON, year: yr };
  }
  return null;
}

// stable key for "greeted this season already": id + the year it belongs to
function seasonKey(s) {
  return s ? `${s.id}-${s.year}` : null;
}

module.exports = { SEASONS, LUNAR, currentSeason, seasonKey };
