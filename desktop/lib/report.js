// 📋 Weekly report card (pure, no Electron). Grades the current weekly
// window from the usage history and hands out a playful title:
//   furnace 烧 token 狂魔 · owl 夜猫子 · weekend 周末战士 · zen 佛系用户 ·
//   mondayRush 周一冲刺手 · pace 节奏大师 · farmer 种田能手 · steady 稳健开发者
const RESET_DROP = 15;
const WEEK_MS = 7 * 24 * 3600e3;

// local weekday / hour of a timestamp; injectable so tests are TZ-independent
function localParts(t) {
  const d = new Date(t);
  return { day: d.getDay(), hour: d.getHours() };
}

// samples since the last weekly reset (a drop of the weekly % between two
// samples), capped at 7 days
function weekSamples(samples, now) {
  const pts = (samples || []).filter((s) => s && Number.isFinite(s.t) && s.t <= now && s.t >= now - WEEK_MS);
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (typeof pts[i].w === "number" && typeof pts[i - 1].w === "number" && pts[i].w < pts[i - 1].w - RESET_DROP) start = i;
  }
  return pts.slice(start);
}

// episodes where the 5h window sat at/above a threshold (consecutive samples)
function episodes(pts, threshold) {
  let n = 0, inside = false;
  for (const p of pts) {
    const hot = typeof p.f === "number" && p.f >= threshold;
    if (hot && !inside) n++;
    inside = hot;
  }
  return n;
}

function computeReport(samples, opts, now) {
  const o = opts || {};
  const parts = o.localParts || localParts;
  const pts = weekSamples(samples, now);
  const r = {
    samples: pts.length, since: pts.length ? pts[0].t : null,
    usedPct: null, depletions: 0, nearMisses: 0,
    peakDay: null, evenness: null, lateNightShare: 0, weekendShare: 0, calmShare: 0,
    score: null, grade: null, title: null, tips: [],
    harvested: o.harvested || 0, lost: o.lost || 0, shooed: o.shooed || 0,
    breakdown: Array.isArray(o.breakdown) ? o.breakdown : null,
  };
  if (pts.length < 2) return r;

  const last = [...pts].reverse().find((p) => typeof p.w === "number");
  r.usedPct = last ? last.w : null;
  r.depletions = episodes(pts, 99.5);
  r.nearMisses = Math.max(0, episodes(pts, 90) - r.depletions);
  r.calmShare = pts.filter((p) => typeof p.f === "number" && p.f < 40).length / pts.length;

  // burn = positive 5h deltas (resets are negative and skipped), bucketed by
  // local weekday / hour of the later sample
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  let total = 0, late = 0, weekend = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].f, b = pts[i].f;
    if (typeof a !== "number" || typeof b !== "number" || b <= a) continue;
    const d = b - a;
    const { day, hour } = parts(pts[i].t);
    byDay[day] += d; total += d;
    if (hour < 5) late += d;
    if (day === 0 || day === 6) weekend += d;
  }
  if (total > 0) {
    r.lateNightShare = late / total;
    r.weekendShare = weekend / total;
    r.peakDay = byDay.indexOf(Math.max(...byDay));
    const active = byDay.filter((x) => x > 0);
    if (active.length >= 2) {
      const mean = total / active.length;
      const sd = Math.sqrt(active.reduce((s, x) => s + (x - mean) ** 2, 0) / active.length);
      r.evenness = Math.max(0, Math.min(1, 1 - sd / mean));
    } else {
      r.evenness = 0;
    }
  }

  let score = 100 - 12 * r.depletions - 4 * r.nearMisses;
  if (r.lateNightShare >= 0.3) score -= 8;
  if (r.evenness !== null && r.evenness >= 0.7 && r.depletions === 0) score += 5;
  if (r.lost > 0) score -= 3 * r.lost;
  r.score = Math.max(0, Math.min(100, Math.round(score)));
  r.grade = r.score >= 90 ? "S" : r.score >= 75 ? "A" : r.score >= 55 ? "B" : "C";

  const mondayRush = r.peakDay === 1 && total > 0 && byDay[1] >= 0.35 * total;
  r.title =
    r.depletions >= 3 ? "furnace"
      : r.lateNightShare >= 0.3 ? "owl"
        : r.weekendShare >= 0.4 ? "weekend"
          : r.usedPct !== null && r.usedPct < 25 && pts.length > 24 ? "zen"
            : mondayRush ? "mondayRush"
              : r.evenness !== null && r.evenness >= 0.7 && r.depletions === 0 ? "pace"
                : r.harvested >= 3 ? "farmer"
                  : "steady";

  if (r.depletions > 0) r.tips.push("depleted");
  if (r.lateNightShare >= 0.3) r.tips.push("owl");
  if (r.lost > 0) r.tips.push("crow");
  if (r.evenness !== null && r.evenness < 0.4 && r.depletions === 0 && now - r.since >= 3 * 24 * 3600e3) r.tips.push("spread");
  if (r.usedPct !== null && r.usedPct < 25 && pts.length > 24) r.tips.push("zen");
  r.tips = r.tips.slice(0, 2);
  return r;
}

module.exports = { computeReport, weekSamples, episodes };
