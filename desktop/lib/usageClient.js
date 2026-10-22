// Fetch Claude subscription usage from the (undocumented) OAuth usage
// endpoint — the same data Claude Code's /usage command shows.
//
// Payload shape as of 2026-10 (captured in test/fixtures/usage-2026-10.json):
//   five_hour / seven_day        legacy per-window objects {utilization, resets_at,
//                                limit_dollars, used_dollars, locked_reason}
//   limits[]                     the structured list Claude Code renders:
//                                {kind: session|weekly_all|weekly_scoped, group,
//                                 percent, severity, resets_at, is_active,
//                                 scope: {model: {id, display_name}, surface}}
//   weekly_scoped_shares[]       {limit_index, allowance_percent_of_weekly, …}
//   extra_usage + spend          usage credits that kick in past the plan limits
//   seven_day_breakdown.rows[]   where the week went (Claude Code / Chats / Cowork…)
//   <codename keys>              obfuscated experiments (tangelo, iguana_necktie…) — ignored
//
// normalize() prefers limits[] and falls back to the legacy keys, so either
// generation of the payload yields the same shape the renderers consume:
//   { fiveHour, week, weekOpus, fable, scoped[], extra, breakdown, raw }

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

function clampPct(v) {
  return Math.max(0, Math.min(100, v));
}

// utilization may arrive as 0..1 fraction or 0..100 percent
function pctOf(v) {
  if (typeof v !== "number" || !isFinite(v)) return null;
  return clampPct(v > 0 && v < 1 ? v * 100 : v);
}

// tolerate ISO strings, epoch seconds or epoch milliseconds
function isoOf(v) {
  if (typeof v === "number" && isFinite(v)) {
    return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  }
  if (typeof v === "string" && v.trim()) return v;
  return null;
}

function pickWindow(obj) {
  if (!obj || typeof obj !== "object") return null;
  let pct = null;
  if (typeof obj.percent === "number" && isFinite(obj.percent)) pct = clampPct(obj.percent); // limits[] is always 0..100
  else pct = pctOf(obj.utilization ?? obj.used_percent);
  // dollar-denominated windows carry no utilization — derive one
  if (pct === null && typeof obj.limit_dollars === "number" && obj.limit_dollars > 0 &&
      typeof obj.used_dollars === "number" && isFinite(obj.used_dollars)) {
    pct = clampPct((obj.used_dollars / obj.limit_dollars) * 100);
  }
  const resetsAt = isoOf(obj.resets_at ?? obj.resetsAt ?? obj.reset_at);
  if (pct === null && !resetsAt) return null;
  const w = { pct: pct ?? 0, resetsAt };
  if (typeof obj.severity === "string") w.severity = obj.severity;
  if (typeof obj.is_active === "boolean") w.isActive = obj.is_active;
  if (obj.locked_reason != null && obj.locked_reason !== "") w.lockedReason = String(obj.locked_reason);
  return w;
}

// label of a scoped limit: the model ("Fable") or surface it applies to
function scopeLabel(scope) {
  if (!scope || typeof scope !== "object") return null;
  const m = scope.model;
  if (m && typeof m === "object" && (m.display_name || m.id)) return String(m.display_name || m.id);
  if (typeof m === "string" && m) return m;
  const s = scope.surface;
  if (s && typeof s === "object" && (s.display_name || s.id)) return String(s.display_name || s.id);
  if (typeof s === "string" && s) return s;
  return null;
}

function slug(label) {
  return String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "scoped";
}

const FABLE_RE = /fable|mythos/i;

// Fable/Mythos used to arrive under a key literally named after the model;
// keep that lookup as a fallback for older payload generations.
function pickFableLegacy(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of Object.keys(obj)) {
    if (FABLE_RE.test(k)) {
      const w = pickWindow(obj[k]);
      if (w) return { ...w, key: slug(k), label: "Fable", sharePct: null };
    }
  }
  return null;
}

// the structured list — returns true when it yielded anything
function fromLimits(raw, out) {
  const list = Array.isArray(raw.limits) ? raw.limits : null;
  if (!list) return false;
  const shares = Array.isArray(raw.weekly_scoped_shares) ? raw.weekly_scoped_shares : [];
  let any = false;
  list.forEach((item, idx) => {
    const w = pickWindow(item);
    if (!w) return;
    const kind = String(item.kind || "").toLowerCase();
    const group = String(item.group || "").toLowerCase();
    const label = scopeLabel(item.scope);
    if (kind === "session" || (!kind && group === "session")) {
      if (!out.fiveHour) { out.fiveHour = w; any = true; }
      return;
    }
    if (kind === "weekly_scoped" || (label && group === "weekly")) {
      const share = shares.find((s) => s && s.limit_index === idx) || null;
      out.scoped.push({
        ...w,
        key: slug(label || `scoped-${idx}`),
        label: label || "Scoped",
        sharePct: share && typeof share.allowance_percent_of_weekly === "number" ? share.allowance_percent_of_weekly : null,
        usedOfWeeklyPct: share && typeof share.used_percent_of_weekly === "number" ? share.used_percent_of_weekly : null,
      });
      any = true;
      return;
    }
    if (kind === "weekly_all" || (!kind && group === "weekly") || /week|seven/.test(kind)) {
      if (!out.week) { out.week = w; any = true; }
    }
  });
  return any;
}

// usage credits beyond the plan limits ("extra usage"). Money fields are
// integers in minor units (decimal_places / exponent tell how many), like
// Stripe amounts — we convert to major units for display.
function pickExtra(raw) {
  const ex = raw.extra_usage && typeof raw.extra_usage === "object" ? raw.extra_usage : null;
  const sp = raw.spend && typeof raw.spend === "object" ? raw.spend : null;
  if (!ex && !sp) return null;
  const e = ex || {};
  const s = sp || {};
  const decimals = Number.isInteger(e.decimal_places) ? e.decimal_places
    : (s.used && Number.isInteger(s.used.exponent) ? s.used.exponent : 2);
  const money = (v) => {
    if (v == null) return null;
    if (typeof v === "object") {
      const exp = Number.isInteger(v.exponent) ? v.exponent : decimals;
      const m = v.amount_minor ?? v.amount;
      return typeof m === "number" && isFinite(m) ? m / Math.pow(10, exp) : null;
    }
    return typeof v === "number" && isFinite(v) ? v / Math.pow(10, decimals) : null;
  };
  const enabled = typeof e.is_enabled === "boolean" ? e.is_enabled : !!s.enabled;
  const pct = pctOf(e.utilization ?? s.percent);
  const used = money(e.used_credits) ?? money(s.used);   // extra_usage is the primary object
  const limit = money(e.monthly_limit) ?? money(s.limit) ?? money(s.cap);
  return {
    enabled,
    pct,
    used,
    limit,
    currency: (typeof e.currency === "string" && e.currency) || (s.used && s.used.currency) || null,
    disabledReason: e.disabled_reason || s.disabled_reason || null,
    userDisabled: !!e.user_disabled,
    spendLimitReached: !!e.spend_limit_reached,
    severity: typeof s.severity === "string" ? s.severity : null,
    everEnabled: !!e.credits_ever_enabled,
  };
}

// per-surface share of this week's usage (rows sum to ~100)
function pickBreakdown(raw) {
  const b = raw.seven_day_breakdown;
  if (!b || typeof b !== "object" || !Array.isArray(b.rows)) return null;
  const rows = b.rows
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const label = String(r.display_name || r.key || "").trim();
      const pct = typeof r.percent === "number" && isFinite(r.percent) ? clampPct(r.percent) : pctOf(r.utilization);
      return label && pct !== null ? { key: String(r.key || slug(label)), label, pct } : null;
    })
    .filter(Boolean);
  if (!rows.length) return null;
  return { asOf: isoOf(b.as_of), windowStartedAt: isoOf(b.window_started_at), rows };
}

function normalize(raw) {
  const out = {
    fiveHour: null, week: null, weekOpus: null, fable: null,
    scoped: [], extra: null, breakdown: null, raw,
  };
  if (!raw || typeof raw !== "object") return out;

  fromLimits(raw, out);

  // legacy / fallback keys fill whatever limits[] didn't provide
  if (!out.fiveHour) out.fiveHour = pickWindow(raw.five_hour ?? raw.fiveHour ?? raw.session);
  if (!out.week) out.week = pickWindow(raw.seven_day ?? raw.sevenDay ?? raw.weekly);
  const legacyOpus = pickWindow(raw.seven_day_opus ?? raw.seven_day_sonnet_4_5 ?? null);
  if (legacyOpus && !out.scoped.some((s) => /opus/i.test(s.label))) {
    out.scoped.push({ ...legacyOpus, key: "opus", label: "Opus", sharePct: null, usedOfWeeklyPct: null });
  }
  const legacySonnet = pickWindow(raw.seven_day_sonnet ?? null);
  if (legacySonnet && !out.scoped.some((s) => /sonnet/i.test(s.label))) {
    out.scoped.push({ ...legacySonnet, key: "sonnet", label: "Sonnet", sharePct: null, usedOfWeeklyPct: null });
  }
  if (!out.scoped.some((s) => FABLE_RE.test(s.label))) {
    const f = pickFableLegacy(raw);
    if (f) out.scoped.push(f);
  }

  // some older variants nest under "usage" / "limits" (object) / "data" (array)
  if (!out.fiveHour && !out.week) {
    const nest = raw.usage || (raw.limits && !Array.isArray(raw.limits) ? raw.limits : null) || raw.data;
    if (nest && typeof nest === "object" && !Array.isArray(nest)) {
      out.fiveHour = pickWindow(nest.five_hour ?? nest.session);
      out.week = pickWindow(nest.seven_day ?? nest.weekly);
      if (!out.scoped.length) { const f = pickFableLegacy(nest); if (f) out.scoped.push(f); }
    }
    if (Array.isArray(nest)) {
      for (const item of nest) {
        const w = pickWindow(item);
        if (!w) continue;
        const key = String(item.type || item.window || item.name || "");
        if (/five|5h|session/i.test(key) && !out.fiveHour) out.fiveHour = w;
        else if (FABLE_RE.test(key) && !out.scoped.some((s) => FABLE_RE.test(s.label))) out.scoped.push({ ...w, key: "fable", label: "Fable", sharePct: null, usedOfWeeklyPct: null });
        else if (/opus/i.test(key) && !out.scoped.some((s) => /opus/i.test(s.label))) out.scoped.push({ ...w, key: "opus", label: "Opus", sharePct: null, usedOfWeeklyPct: null });
        else if (/seven|week/i.test(key) && !out.week) out.week = w;
      }
    }
  }

  // derived convenience views the renderers / notifications key off
  out.fable = out.scoped.find((s) => FABLE_RE.test(s.label)) || null;
  out.weekOpus = out.scoped.find((s) => /opus/i.test(s.label)) || null;
  out.extra = pickExtra(raw);
  out.breakdown = pickBreakdown(raw);
  return out;
}

// ---- pure helpers shared with the main process (renderers mirror them in
// petcore.js — test/mood.test.js keeps the two in lock-step) ----

// plan limits are exhausted (or locked): Claude itself is blocked
function planExhausted(u) {
  if (!u) return false;
  const f = u.fiveHour, w = u.week;
  if ((f && f.lockedReason) || (w && w.lockedReason)) return true;
  return !!((f && f.pct >= 99.5) || (w && w.pct >= 99.5));
}

// extra usage (usage credits) is carrying the load right now
function extraActive(u) {
  const ex = u && u.extra;
  if (!ex || !ex.enabled || ex.spendLimitReached) return false;
  if (typeof ex.pct === "number" && ex.pct >= 99.5) return false;
  return true;
}

function isOverage(u) {
  if (!u) return false;
  const f = u.fiveHour, w = u.week;
  if ((f && f.lockedReason) || (w && w.lockedReason)) return false; // a lock isn't covered by credits
  return planExhausted(u) && extraActive(u);
}

// a bare pre-0.2.0 window ({pct, resetsAt}) → a scoped entry with label/key
function legacyScoped(w, label) {
  return { key: slug(label), label, sharePct: null, usedOfWeeklyPct: null, ...w };
}

// the subset of a normalized payload worth caching / sending to renderers;
// also upgrades pre-0.2.0 cached shapes (bare `fable`, no `scoped`)
function pickClaude(u) {
  u = u || {};
  let scoped = Array.isArray(u.scoped) ? u.scoped.filter(Boolean) : null;
  if (!scoped) {
    scoped = [];
    if (u.fable) scoped.push(legacyScoped(u.fable, "Fable"));
    if (u.weekOpus) scoped.push(legacyScoped(u.weekOpus, "Opus"));
  }
  scoped = scoped.map((s) => (s.label && s.key ? s : legacyScoped(s, s.label || "Scoped")));
  return {
    fiveHour: u.fiveHour || null,
    week: u.week || null,
    weekOpus: scoped.find((s) => /opus/i.test(s.label)) || null,
    fable: scoped.find((s) => FABLE_RE.test(s.label)) || null,
    scoped,
    extra: u.extra || null,
    breakdown: u.breakdown || null,
  };
}

/** @returns {Promise<ReturnType<typeof normalize>>} */
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

module.exports = { fetchUsage, normalize, pickClaude, planExhausted, extraActive, isOverage };
