// Usage history + burn-rate forecast (pure, no Electron).
//
// Every fresh poll appends {t, f, w} (epoch ms, 5h %, weekly %). From the
// recent samples we fit a line (pct per hour) and project when the window
// would hit 100% — then compare that with the window's reset time to get a
// "quota weather": will you make it to the reset at this pace?
const MAX_SAMPLES = 2200;              // ~7.5 days at 5-min polls
const MAX_AGE_MS = 7 * 24 * 3600e3;
const LOOKBACK = { f: 75 * 60e3, w: 8 * 3600e3 };   // regression window per series
const MIN_SPAN_MS = 10 * 60e3;         // need ≥10 min of data for a slope
const RESET_DROP = 15;                 // a drop this big between samples = the window reset

function pushSample(samples, s, now) {
  const list = Array.isArray(samples) ? samples.slice() : [];
  const t = s && Number.isFinite(s.t) ? s.t : now;
  const f = typeof s.f === "number" && isFinite(s.f) ? s.f : null;
  const w = typeof s.w === "number" && isFinite(s.w) ? s.w : null;
  if (f === null && w === null) return list;
  if (list.length && list[list.length - 1].t === t) list.pop();   // same tick → replace
  list.push({ t, f, w });
  const cutoff = (now || t) - MAX_AGE_MS;
  const out = list.filter((x) => x && Number.isFinite(x.t) && x.t >= cutoff).sort((a, b) => a.t - b.t);
  return out.length > MAX_SAMPLES ? out.slice(out.length - MAX_SAMPLES) : out;
}

// samples of one series after the last reset, inside the lookback window
function recent(samples, key, now) {
  const since = now - LOOKBACK[key];
  const pts = (samples || []).filter((s) => s && s.t >= since && s.t <= now && typeof s[key] === "number");
  let start = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][key] < pts[i - 1][key] - RESET_DROP) start = i;
  return pts.slice(start);
}

// least-squares slope in pct per hour (null when there isn't enough data)
function slopePerHour(pts, key) {
  if (pts.length < 3) return null;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span < MIN_SPAN_MS) return null;
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { const x = (p.t - pts[0].t) / 3600e3; sx += x; sy += p[key]; sxx += x * x; sxy += x * p[key]; }
  const den = n * sxx - sx * sx;
  if (den <= 0) return null;
  return (n * sxy - sx * sy) / den;
}

// forecast one window: at the current pace, when does it hit 100%?
function forecast(samples, key, now) {
  const pts = recent(samples, key, now);
  const rate = slopePerHour(pts, key);
  const pct = pts.length ? pts[pts.length - 1][key] : null;
  if (rate === null || pct === null) return { rate: null, etaMs: null, pct, samples: pts.length };
  const r = rate < 0.3 ? 0 : rate;            // noise floor: "idle"
  const etaMs = r > 0 ? ((100 - pct) / r) * 3600e3 : null;
  return { rate: r, etaMs, pct, samples: pts.length };
}

// quota weather: compare the projected exhaustion with the reset time
//   sunny  — won't run out before the reset (or idle)
//   cloudy — would run out, but only after the reset (tight)
//   rain   — runs out before the reset at this pace
//   storm  — runs out in the first half of the remaining time
function outlook(fc, resetsAt, now) {
  const resetMs = resetsAt ? new Date(resetsAt).getTime() - now : null;
  const o = { weather: "unknown", etaMs: fc ? fc.etaMs : null, rate: fc ? fc.rate : null, resetMs, exhaustsBeforeReset: false };
  if (!fc || fc.rate === null) return o;
  if (fc.pct !== null && fc.pct >= 99.5) { o.weather = "storm"; o.exhaustsBeforeReset = true; return o; }
  if (fc.etaMs === null) { o.weather = "sunny"; return o; }
  if (resetMs === null || resetMs <= 0) { o.weather = fc.etaMs < 2 * 3600e3 ? "rain" : "sunny"; o.exhaustsBeforeReset = o.weather === "rain"; return o; }
  if (fc.etaMs >= resetMs * 1.5) o.weather = "sunny";
  else if (fc.etaMs >= resetMs) o.weather = "cloudy";
  else if (fc.etaMs >= resetMs / 2) { o.weather = "rain"; o.exhaustsBeforeReset = true; }
  else { o.weather = "storm"; o.exhaustsBeforeReset = true; }
  return o;
}

// everything the renderers need, computed once per fresh poll
function trendOf(samples, usage, now) {
  const five = outlook(forecast(samples, "f", now), usage && usage.fiveHour ? usage.fiveHour.resetsAt : null, now);
  const week = outlook(forecast(samples, "w", now), usage && usage.week ? usage.week.resetsAt : null, now);
  const order = { storm: 3, rain: 2, cloudy: 1, sunny: 0, unknown: -1 };
  const worst = order[week.weather] > order[five.weather] ? "w" : "f";
  // compact series for the sparklines: 5h over the last 6 h, weekly over 7 d
  const sinceF = now - 6 * 3600e3, sinceW = now - 7 * 24 * 3600e3;
  const seriesF = (samples || []).filter((s) => s.t >= sinceF && typeof s.f === "number").map((s) => [s.t, s.f]);
  const seriesW = (samples || []).filter((s) => s.t >= sinceW && typeof s.w === "number").map((s) => [s.t, s.w]);
  return { five, week, worst, seriesF, seriesW: thin(seriesW, 240) };
}

// keep at most n points (uniform stride) so IPC payloads stay small
function thin(series, n) {
  if (series.length <= n) return series;
  const stride = series.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(series[Math.floor(i * stride)]);
  out.push(series[series.length - 1]);
  return out;
}

module.exports = { pushSample, forecast, outlook, trendOf, MAX_SAMPLES, MAX_AGE_MS };
