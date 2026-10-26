/* GENERATED from desktop/lib/garden.js by desktop/scripts/sync-web.js — do not edit; run `npm run sync-web` in desktop/ */
(function () {
  "use strict";
  const module = { exports: {} };
  const exports = module.exports;
  // 🌱 Pixel garden (pure, no Electron). Three plots that grow at a pace set
  // by the pet's mood: a happy, well-rationed Claude means a thriving garden;
  // burning through the quota stalls growth and wilts the plants. Quota resets
  // water the garden. Ripe crops are harvested to feed the pet.
  const CROPS = ["carrot", "tomato", "sunflower"];
  const SEASONAL_CROPS = ["pumpkin"];                 // only plantable while their season is on
  const ALL_CROPS = CROPS.concat(SEASONAL_CROPS);
  const PLOTS = 3;
  const STAGES = 4;                                   // 0 seed · 1 sprout · 2 growing · 3 ripe
  const GROW_MS = { carrot: 5 * 3600e3, tomato: 9 * 3600e3, sunflower: 14 * 3600e3, pumpkin: 7 * 3600e3 };  // at full pace
  const MAX_TICK_MS = 6 * 3600e3;                     // cap one catch-up tick (laptop was asleep)
  const WILT_MS = 10 * 3600e3;                        // depleted for this long → fully wilted
  const WATER_BOOST = 0.15;
  // 🐦‍⬛ leave a ripe crop unharvested and a crow shows up; ignore the crow and
  // it flies off with your crop
  const CROW_AFTER_MS = 8 * 3600e3;
  const CROW_EATS_MS = 4 * 3600e3;
  // the crow is a "you're here" mechanic: its clocks only run while the app is
  // ticking (every minute). A gap longer than this means the laptop slept or
  // the app was closed — that time doesn't count toward the crow.
  const CROW_MAX_TICK_MS = 10 * 60e3;
  
  // mood → growth multiplier (also used while wilted plants recover)
  const RATE = { happy: 1, calm: 0.8, sleepy: 0.45, anxious: 0.15, overage: 0.15, depleted: 0, lost: 0.3, unknown: 0.5 };
  
  function newGarden() {
    return { plots: Array.from({ length: PLOTS }, () => null), harvested: 0, lost: 0, shooed: 0, lastTick: null, lastLoss: null };
  }
  
  function sanitize(g) {
    const out = newGarden();
    if (!g || typeof g !== "object") return out;
    if (Array.isArray(g.plots)) {
      for (let i = 0; i < PLOTS; i++) {
        const p = g.plots[i];
        if (p && typeof p === "object" && ALL_CROPS.includes(p.crop)) {
          out.plots[i] = {
            crop: p.crop,
            progress: Math.max(0, Math.min(1, Number(p.progress) || 0)),
            wilt: Math.max(0, Math.min(1, Number(p.wilt) || 0)),
            plantedAt: Number(p.plantedAt) || null,
            ripeAt: Number.isFinite(p.ripeAt) ? p.ripeAt : null,
            crow: p.crow && Number.isFinite(p.crow.since) ? { since: p.crow.since } : null,
          };
        }
      }
    }
    out.harvested = Math.max(0, Math.floor(Number(g.harvested) || 0));
    out.lost = Math.max(0, Math.floor(Number(g.lost) || 0));
    out.shooed = Math.max(0, Math.floor(Number(g.shooed) || 0));
    out.lastTick = Number.isFinite(g.lastTick) ? g.lastTick : null;
    out.lastLoss = g.lastLoss && ALL_CROPS.includes(g.lastLoss.crop) && Number.isFinite(g.lastLoss.at) ? { crop: g.lastLoss.crop, at: g.lastLoss.at } : null;
    return out;
  }
  
  function stageOf(plot) {
    if (!plot) return -1;
    if (plot.progress >= 1) return STAGES - 1;
    return Math.min(STAGES - 2, Math.floor(plot.progress * (STAGES - 1)));
  }
  
  // advance the garden by the wall-clock elapsed since the last tick
  function tick(g, mood, now) {
    const elapsed = Number.isFinite(g.lastTick) ? Math.max(0, now - g.lastTick) : 0;
    const dt = Math.min(MAX_TICK_MS, elapsed);          // growth catches up (capped)
    // the crow doesn't: shift its clocks by the time you weren't around, so it
    // can't land on — or eat — a crop while you couldn't shoo it
    const skipped = elapsed - Math.min(CROW_MAX_TICK_MS, elapsed);
    g.lastTick = now;
    if (!dt) return g;
    const rate = RATE[mood] != null ? RATE[mood] : RATE.unknown;
    g.plots.forEach((p, i) => {
      if (!p) return;
      if (skipped > 0) {
        if (p.crow) p.crow.since += skipped;
        else if (Number.isFinite(p.ripeAt)) p.ripeAt += skipped;
      }
      if (p.progress < 1) {
        p.progress = Math.min(1, p.progress + (dt / GROW_MS[p.crop]) * rate);
        if (p.progress >= 1) p.ripeAt = now;
      } else if (!Number.isFinite(p.ripeAt)) {
        p.ripeAt = now;   // ripe before 0.4.0 — start the crow clock now
      }
      // no growth → thirsty; any growth → recovers twice as fast
      if (rate === 0) p.wilt = Math.min(1, p.wilt + dt / WILT_MS);
      else p.wilt = Math.max(0, p.wilt - (2 * dt) / WILT_MS);
      // 🐦‍⬛ the crow
      if (p.progress >= 1) {
        if (!p.crow && now - p.ripeAt >= CROW_AFTER_MS) p.crow = { since: now };
        else if (p.crow && now - p.crow.since >= CROW_EATS_MS) {
          g.plots[i] = null;
          g.lost += 1;
          g.lastLoss = { crop: p.crop, at: now };
        }
      }
    });
    return g;
  }
  
  // click the crow: it flies off and the ripe crop is safe for another while
  function shoo(g, i, now) {
    const p = g.plots[i];
    if (!p || !p.crow) return false;
    p.crow = null;
    p.ripeAt = now;
    g.shooed += 1;
    return true;
  }
  // index of a plot currently visited by a crow (or -1)
  function crowAt(g) {
    return g && Array.isArray(g.plots) ? g.plots.findIndex((p) => p && p.crow) : -1;
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
  
  // seasonCrop (e.g. "pumpkin" during Halloween) joins the rotation; an explicit
  // seasonal crop is only accepted while its season is on
  function plant(g, i, crop, now, seasonCrop) {
    if (i < 0 || i >= PLOTS || g.plots[i]) return false;
    const pool = seasonCrop && SEASONAL_CROPS.includes(seasonCrop) ? CROPS.concat([seasonCrop]) : CROPS;
    const c = pool.includes(crop) ? crop : pool[(g.harvested + i) % pool.length];
    g.plots[i] = { crop: c, progress: 0, wilt: 0, plantedAt: now, ripeAt: null, crow: null };
    return true;
  }
  
  function harvest(g, i) {
    const p = g.plots[i];
    if (!p || p.progress < 1) return null;
    g.plots[i] = null;
    g.harvested += 1;
    return p.crop;
  }
  
  module.exports = {
    CROPS, SEASONAL_CROPS, ALL_CROPS, PLOTS, STAGES, GROW_MS, RATE, CROW_AFTER_MS, CROW_EATS_MS, CROW_MAX_TICK_MS,
    newGarden, sanitize, stageOf, tick, water, plant, harvest, shoo, crowAt,
  };

  window.PetGarden = module.exports;
})();
