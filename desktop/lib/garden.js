// 🌱 Pixel garden (pure, no Electron). Three plots that grow at a pace set
// by the pet's mood: a happy, well-rationed Claude means a thriving garden;
// burning through the quota stalls growth and wilts the plants. Quota resets
// water the garden. Ripe crops are harvested to feed the pet.
const CROPS = ["carrot", "tomato", "sunflower"];
const PLOTS = 3;
const STAGES = 4;                                   // 0 seed · 1 sprout · 2 growing · 3 ripe
const GROW_MS = { carrot: 5 * 3600e3, tomato: 9 * 3600e3, sunflower: 14 * 3600e3 };  // at full pace
const MAX_TICK_MS = 6 * 3600e3;                     // cap one catch-up tick (laptop was asleep)
const WILT_MS = 10 * 3600e3;                        // depleted for this long → fully wilted
const WATER_BOOST = 0.15;

// mood → growth multiplier (also used while wilted plants recover)
const RATE = { happy: 1, calm: 0.8, sleepy: 0.45, anxious: 0.15, overage: 0.15, depleted: 0, lost: 0.3, unknown: 0.5 };

function newGarden() {
  return { plots: Array.from({ length: PLOTS }, () => null), harvested: 0, lastTick: null };
}

function sanitize(g) {
  const out = newGarden();
  if (!g || typeof g !== "object") return out;
  if (Array.isArray(g.plots)) {
    for (let i = 0; i < PLOTS; i++) {
      const p = g.plots[i];
      if (p && typeof p === "object" && CROPS.includes(p.crop)) {
        out.plots[i] = {
          crop: p.crop,
          progress: Math.max(0, Math.min(1, Number(p.progress) || 0)),
          wilt: Math.max(0, Math.min(1, Number(p.wilt) || 0)),
          plantedAt: Number(p.plantedAt) || null,
        };
      }
    }
  }
  out.harvested = Math.max(0, Math.floor(Number(g.harvested) || 0));
  out.lastTick = Number.isFinite(g.lastTick) ? g.lastTick : null;
  return out;
}

function stageOf(plot) {
  if (!plot) return -1;
  if (plot.progress >= 1) return STAGES - 1;
  return Math.min(STAGES - 2, Math.floor(plot.progress * (STAGES - 1)));
}

// advance the garden by the wall-clock elapsed since the last tick
function tick(g, mood, now) {
  const dt = Number.isFinite(g.lastTick) ? Math.max(0, Math.min(MAX_TICK_MS, now - g.lastTick)) : 0;
  g.lastTick = now;
  if (!dt) return g;
  const rate = RATE[mood] != null ? RATE[mood] : RATE.unknown;
  for (const p of g.plots) {
    if (!p) continue;
    if (p.progress < 1) p.progress = Math.min(1, p.progress + (dt / GROW_MS[p.crop]) * rate);
    // no growth → thirsty; any growth → recovers twice as fast
    if (rate === 0) p.wilt = Math.min(1, p.wilt + dt / WILT_MS);
    else p.wilt = Math.max(0, p.wilt - (2 * dt) / WILT_MS);
  }
  return g;
}

// a quota reset waters everything (growth burst + un-wilt)
function water(g) {
  for (const p of g.plots) {
    if (!p) continue;
    if (p.progress < 1) p.progress = Math.min(1, p.progress + WATER_BOOST);
    p.wilt = 0;
  }
  return g;
}

function plant(g, i, crop, now) {
  if (i < 0 || i >= PLOTS || g.plots[i]) return false;
  const c = CROPS.includes(crop) ? crop : CROPS[(g.harvested + i) % CROPS.length];
  g.plots[i] = { crop: c, progress: 0, wilt: 0, plantedAt: now };
  return true;
}

function harvest(g, i) {
  const p = g.plots[i];
  if (!p || p.progress < 1) return null;
  g.plots[i] = null;
  g.harvested += 1;
  return p.crop;
}

module.exports = { CROPS, PLOTS, STAGES, GROW_MS, RATE, newGarden, sanitize, stageOf, tick, water, plant, harvest };
