/* GENERATED from desktop/lib/alerts.js by desktop/scripts/sync-web.js — do not edit; run `npm run sync-web` in desktop/ */
(function () {
  "use strict";
  const module = { exports: {} };
  const exports = module.exports;
  // Alert logic (pure, no Electron): given the previous reading and a fresh
  // usage + trend, decide which notifications / celebrations are due and
  // return the state to remember for the next reading. The main process and
  // the web app only perform the side effects (toasts, sounds, watering,
  // grading) — the decisions live here so they can be unit-tested.
  const FABLE_THRESHOLDS = [80, 95];
  const EXTRA_THRESHOLDS = [80, 95];
  
  function initialState() {
    return { fiveHour: null, week: null, weekReset: null, fable: null, extra: null, overage: null, pace: {} };
  }
  
  // restore the state from a cached usage payload (app restart)
  function stateFromUsage(u, pace, isOverage) {
    const s = initialState();
    if (u) {
      s.fiveHour = u.fiveHour ? u.fiveHour.pct : null;
      s.week = u.week ? u.week.pct : null;
      s.weekReset = u.week ? u.week.resetsAt || null : null;
      s.fable = u.fable ? u.fable.pct : null;
      s.extra = u.extra && u.extra.enabled && typeof u.extra.pct === "number" ? u.extra.pct : null;
      s.overage = typeof isOverage === "function" ? isOverage(u) : null;
    }
    if (pace && typeof pace === "object") s.pace = { ...pace };
    return s;
  }
  
  // highest threshold crossed upward between two readings (or null)
  function crossed(prev, cur, thresholds) {
    if (prev === null || cur === null) return null;
    for (const th of thresholds.slice().reverse()) if (prev < th && cur >= th) return th;
    return null;
  }
  
  /**
   * @param {object} prev   state from the previous reading (initialState() on first run)
   * @param {object} u      fresh normalized usage
   * @param {object} trend  trendOf() result (may be null)
   * @param {object} opts   { isOverage(u) }
   * @returns {{events: Array<object>, state: object}}
   *   event types: reset(window: five|week|fable) · newWeek · fable(level,pct) ·
   *   overageOn(pct) · extra(level,pct) · pace(key,etaMs,resetMs)
   */
  function evaluate(prev, u, trend, opts) {
    const p = prev || initialState();
    const over = opts && typeof opts.isOverage === "function" ? opts.isOverage(u) : false;
    const events = [];
    const state = { ...p, pace: { ...(p.pace || {}) } };
    if (!u) return { events, state };
  
    // 5h reset: from a high reading down by ≥ 50 points
    const pct = u.fiveHour ? u.fiveHour.pct : null;
    if (p.fiveHour !== null && pct !== null && p.fiveHour >= 80 && pct <= p.fiveHour - 50) events.push({ type: "reset", window: "five" });
    if (pct !== null) state.fiveHour = pct;
  
    // weekly: a new window (15-point drop, as report.js detects it, or the
    // reset time jumping by more than a day — resets the app slept through)
    const wk = u.week ? u.week.pct : null;
    const wkReset = u.week ? u.week.resetsAt || null : null;
    const newWeek = (p.week !== null && wk !== null && wk < p.week - 15) ||
      !!(p.weekReset && wkReset && Date.parse(wkReset) - Date.parse(p.weekReset) > 24 * 3600e3);
    if (newWeek) events.push({ type: "newWeek" });
    // …and a big drop is worth a party
    if (p.week !== null && wk !== null && p.week >= 50 && wk <= p.week - 40) events.push({ type: "reset", window: "week", graded: newWeek });
    if (wk !== null) state.week = wk;
    if (wkReset) state.weekReset = wkReset;
  
    // Fable: 80 / 95 reminders (highest crossed, once per reading) + reset
    const f = u.fable ? u.fable.pct : null;
    if (f !== null && p.fable !== null) {
      const th = crossed(p.fable, f, FABLE_THRESHOLDS);
      if (th !== null) events.push({ type: "fable", level: th, pct: f });
      if (p.fable >= 80 && f <= p.fable - 50) events.push({ type: "reset", window: "fable" });
    }
    if (f !== null) state.fable = f;
  
    // usage credits: once when they start carrying the load, then 80 / 95 of the cap
    if (p.overage === false && over) events.push({ type: "overageOn", pct: u.extra && typeof u.extra.pct === "number" ? u.extra.pct : null });
    state.overage = over;
    const ex = u.extra && u.extra.enabled && typeof u.extra.pct === "number" ? u.extra.pct : null;
    if (ex !== null && p.extra !== null) {
      const th = crossed(p.extra, ex, EXTRA_THRESHOLDS);
      if (th !== null) events.push({ type: "extra", level: th, pct: ex });
    }
    state.extra = ex;
  
    // pace alarms: once per window instance (keyed by its resets_at) when the
    // forecast says it runs dry before the reset. 5h: storm only; weekly: rain
    // or storm, and only once the window is ≥ 30 % used. Needs a real ETA (an
    // already-dry window has none — the depleted/overage moods cover that).
    if (trend) {
      for (const key of ["f", "w"]) {
        const o = key === "f" ? trend.five : trend.week;
        const win = key === "f" ? u.fiveHour : u.week;
        const id = win && win.resetsAt ? String(win.resetsAt) : null;
        if (!o || !id) continue;
        const bad = key === "f" ? o.weather === "storm" : (o.weather === "storm" || o.weather === "rain");
        const underway = key === "f" || win.pct >= 30;
        if (bad && underway && typeof o.etaMs === "number" && state.pace[key] !== id) {
          state.pace[key] = id;
          events.push({ type: "pace", key, etaMs: o.etaMs, resetMs: o.resetMs });
        }
      }
    }
    return { events, state };
  }
  
  module.exports = { FABLE_THRESHOLDS, EXTRA_THRESHOLDS, initialState, stateFromUsage, crossed, evaluate };

  window.PetAlerts = module.exports;
})();
