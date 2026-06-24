// Fetch Claude subscription usage from the (undocumented) OAuth usage
// endpoint — the same data Claude Code's /usage command shows.
// The response shape may change; normalize() is intentionally tolerant.

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

function pctOf(v) {
  if (typeof v !== "number" || !isFinite(v)) return null;
  // utilization may arrive as 0..1 fraction or 0..100 percent
  const pct = v > 0 && v < 1 ? v * 100 : v;
  return Math.max(0, Math.min(100, pct));
}

function pickWindow(obj) {
  if (!obj || typeof obj !== "object") return null;
  const pct = pctOf(obj.utilization ?? obj.used_percent ?? obj.percent);
  let resetsAt = obj.resets_at ?? obj.resetsAt ?? obj.reset_at ?? null;
  if (typeof resetsAt === "number") {
    // tolerate epoch seconds or milliseconds
    resetsAt = new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();
  }
  if (pct === null && !resetsAt) return null;
  return { pct: pct ?? 0, resetsAt };
}

function normalize(raw) {
  const out = { fiveHour: null, week: null, weekOpus: null, raw };
  if (raw && typeof raw === "object") {
    out.fiveHour = pickWindow(raw.five_hour ?? raw.fiveHour ?? raw.session);
    out.week = pickWindow(raw.seven_day ?? raw.sevenDay ?? raw.weekly);
    out.weekOpus = pickWindow(raw.seven_day_opus ?? raw.seven_day_sonnet_4_5 ?? null);
    // some variants nest under "usage" / "limits" / arrays
    if (!out.fiveHour && !out.week) {
      const nest = raw.usage || raw.limits || raw.data;
      if (nest && typeof nest === "object" && !Array.isArray(nest)) {
        out.fiveHour = pickWindow(nest.five_hour ?? nest.session);
        out.week = pickWindow(nest.seven_day ?? nest.weekly);
      }
      if (Array.isArray(nest)) {
        for (const item of nest) {
          const w = pickWindow(item);
          if (!w) continue;
          const key = String(item.type || item.window || item.name || "");
          if (/five|5h|session/i.test(key) && !out.fiveHour) out.fiveHour = w;
          else if (/opus/i.test(key) && !out.weekOpus) out.weekOpus = w;
          else if (/seven|week/i.test(key) && !out.week) out.week = w;
        }
      }
    }
  }
  return out;
}

/** @returns {Promise<{fiveHour:any, week:any, weekOpus:any, raw:any}>} */
async function fetchUsage(accessToken) {
  const res = await fetch(ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "Content-Type": "application/json",
      "User-Agent": "claude-cli/2.0.0 (external, claude-pet)",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`usage endpoint HTTP ${res.status} ${body.slice(0, 160)}`);
    err.status = res.status;
    const ra = parseInt(res.headers.get("retry-after"), 10);
    if (Number.isFinite(ra) && ra > 0) err.retryAfter = ra;
    throw err;
  }
  return normalize(await res.json());
}

module.exports = { fetchUsage, normalize };
