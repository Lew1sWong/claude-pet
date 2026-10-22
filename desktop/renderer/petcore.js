/* Claude Pet — shared pure helpers used by both renderers (floating pet &
   Dynamic Island). Keeping mood thresholds, countdown formatting, the usage
   rows and the sprite drawing in one place stops the two skins from drifting
   apart. Depends on the global SPRITES (sprites.js) being loaded first.
   Loadable under node for tests (shim `window` + `SPRITES`). */
(function () {
  "use strict";

  const tt = (k) => (typeof window !== "undefined" && typeof window.t === "function" ? window.t(k) : k);
  const FABLE_RE = /fable|mythos/i;

  // every model/surface-scoped weekly limit; cached payloads from <0.2.0 only
  // carried `fable`, so fall back to that
  function scopedList(usage) {
    if (!usage) return [];
    if (Array.isArray(usage.scoped)) return usage.scoped.filter(Boolean);
    return usage.fable ? [{ key: "fable", label: "Fable", sharePct: null, ...usage.fable }] : [];
  }

  // ---- mood logic. Mirrors lib/usageClient.js (planExhausted / extraActive /
  // isOverage) — test/mood.test.js keeps both sides identical. ----
  function lockedReason(u) {
    if (!u) return null;
    return (u.fiveHour && u.fiveHour.lockedReason) || (u.week && u.week.lockedReason) || null;
  }
  // plan limits exhausted (or locked): Claude itself is blocked
  function planExhausted(u) {
    if (!u) return false;
    if (lockedReason(u)) return true;
    const f = u.fiveHour, w = u.week;
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
    if (!u || lockedReason(u)) return false;
    return planExhausted(u) && extraActive(u);
  }
  // the window that keeps Claude blocked (latest reset wins when both are dry)
  function blockingWindow(u) {
    if (!u) return null;
    const c = [u.fiveHour, u.week].filter((w) => w && (w.pct >= 99.5 || w.lockedReason));
    if (!c.length) return u.fiveHour || u.week || null;
    return c.reduce((a, b) => (Date.parse(b.resetsAt || "") > Date.parse(a.resetsAt || "") ? b : a));
  }

  // usage → mood. errorCode short-circuits to "lost". Mirrors the thresholds
  // the whole app reacts to, so it lives here as the single source of truth.
  // Scoped windows (Fable ✦ etc., the priciest ones) count toward anxiety; a
  // dry plan with usage credits enabled is "overage" (still working, burning
  // money) instead of "depleted". When Claude itself is off but other agents
  // (Codex/OpenClaw/自定义) are tracked, their worst window drives the mood
  // instead so the pet never plays dead.
  function computeMode(usage, errorCode) {
    if (errorCode === "no-credentials" || errorCode === "auth") return "lost";
    if (!usage) return "unknown";
    const scoped = scopedList(usage);
    if (!usage.fiveHour && !usage.week && !scoped.length) {
      const winds = [];
      (usage.others || []).forEach((p) => (p.windows || []).forEach((x) => {
        if (x && typeof x.pct === "number") winds.push(x.pct);
      }));
      if (!winds.length) return "unknown";
      const worst = Math.max.apply(null, winds);
      if (worst >= 99.5) return "depleted";
      if (worst >= 90) return "anxious";
      if (worst >= 70) return "sleepy";
      if (worst >= 40) return "calm";
      return "happy";
    }
    if (planExhausted(usage)) return isOverage(usage) ? "overage" : "depleted";
    const f = usage.fiveHour ? usage.fiveHour.pct : 0;
    const w = usage.week ? usage.week.pct : 0;
    const worst = Math.max(f, w, ...scoped.map((s) => (typeof s.pct === "number" ? s.pct : 0)));
    if (worst >= 90) return "anxious";
    if (worst >= 70) return "sleepy";
    if (worst >= 40) return "calm";
    return "happy";
  }

  // ISO timestamp → human "X 后重置 · <local time>" string (or null).
  function fmtCd(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return null;
    const en = typeof window !== "undefined" && window.__lang === "en";
    if (ms <= 0) return en ? "resetting…" : "即将重置…";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const local = new Date(iso).toLocaleString(en ? "en-US" : "zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const cd = en
      ? (h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`)
      : (h >= 24 ? `${Math.floor(h / 24)} 天 ${h % 24} 小时` : h > 0 ? `${h} 小时 ${String(m).padStart(2, "0")} 分` : `${m} 分钟`);
    return en ? `${cd} left · ${local}` : `${cd}后重置 · ${local}`;
  }

  // amount in major units → "S$12.34" (falls back to "SGD 12.34")
  function fmtMoney(v, cur) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", maximumFractionDigits: 2 }).format(v);
    } catch {
      return (cur ? cur + " " : "$") + v.toFixed(2);
    }
  }
  // " · 24% · S$12.34 / S$50.00" for the overage HUD line
  function extraSummary(u) {
    const ex = u && u.extra;
    if (!ex) return "";
    const bits = [];
    if (typeof ex.pct === "number") bits.push(Math.round(ex.pct) + "%");
    const used = fmtMoney(ex.used, ex.currency), lim = fmtMoney(ex.limit, ex.currency);
    if (used) bits.push(lim ? used + " / " + lim : used);
    return bits.length ? " · " + bits.join(" · ") : "";
  }

  // Draw a 16×16 pixel pet onto a 2d context. animState is one of
  // "idle" | "walk" | "sleep" | "yawn" | "stretch" — states a character (e.g.
  // a custom pixel buddy) doesn't have fall back to idle. blinkOn toggles the
  // closed-eye overlay (skipped while yawning: eyes are already shut in-frame).
  function framesFor(character, animState) {
    const states = SPRITES.frames[character];
    return states[animState] || states.idle;
  }
  function frameCount(character, animState) {
    return framesFor(character, animState).length;
  }
  function drawPet(ctx, character, animState, frameIdx, blinkOn) {
    const pal = SPRITES.palettes[character];
    const frames = framesFor(character, animState);
    const fi = frameIdx % frames.length;
    const frame = frames[fi];
    ctx.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) {
      const row = frame[y];
      for (let x = 0; x < 16; x++) {
        const c = row[x];
        if (c !== ".") {
          ctx.fillStyle = pal[c];
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const eyes = SPRITES.eyes[character];
    if (blinkOn && animState !== "sleep" && animState !== "yawn" && eyes && eyes.length) {
      const dy = animState === "idle" && fi === 1 ? 1 : 0;
      ctx.fillStyle = pal.d;
      for (const [ex, ey] of eyes) {
        ctx.fillRect(ex, ey + dy, 1, 1);
      }
    }
  }

  // Merge user-made pixel buddies (photos of loved ones, pixelated in the
  // Settings window) into SPRITES so every renderer treats them like built-in
  // characters. Idempotent: prunes buddies that were deleted since last call.
  function mergeCustomPets(list) {
    const alive = new Set();
    (list || []).forEach((p) => {
      if (!p || !p.id || !p.frames || !p.palette) return;
      SPRITES.frames[p.id] = p.frames;
      SPRITES.palettes[p.id] = p.palette;
      SPRITES.names[p.id] = p.name || "❤";
      SPRITES.eyes[p.id] = [];
      alive.add(p.id);
    });
    Object.keys(SPRITES.frames).forEach((id) => {
      if (id.startsWith("buddy-") && !alive.has(id)) {
        delete SPRITES.frames[id];
        delete SPRITES.palettes[id];
        delete SPRITES.names[id];
        delete SPRITES.eyes[id];
      }
    });
  }

  // ---- usage rows (DOM-only, shared by both HUD skins) ----
  // one "label ▓▓▓░░ 42%" row plus its "↻ reset" line
  function makeRow(labelText, cls) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.className = "bar-label" + (cls ? " " + cls : "");
    label.textContent = labelText;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (cls ? " " + cls : "");
    bar.appendChild(fill);
    const pctEl = document.createElement("span");
    pctEl.className = "bar-pct";
    row.appendChild(label); row.appendChild(bar); row.appendChild(pctEl);
    const line = document.createElement("div");
    line.className = "reset-line hidden";
    return { row, label, fill, pctEl, line };
  }
  function fillBar(parts, win) {
    const pct = win && typeof win.pct === "number" ? Math.round(win.pct) : null;
    parts.fill.style.width = pct === null ? "0%" : Math.min(100, pct) + "%";
    parts.fill.classList.toggle("warn", pct !== null && pct >= 70 && pct < 90);
    parts.fill.classList.toggle("danger", pct !== null && pct >= 90);
    parts.pctEl.textContent = pct === null ? "--%" : pct + "%";
    const cd = win && win.resetsAt ? fmtCd(win.resetsAt) : null;
    parts.line.textContent = cd ? "↻ " + cd : "";
    parts.line.classList.toggle("hidden", !cd);
  }
  // "Fable" → "F✦": one letter + the scoped-limit star fits the label column
  function abbr(label) {
    const s = String(label || "").trim();
    return (s ? s[0].toUpperCase() : "?") + "✦";
  }

  // Model-scoped weekly limits (Fable ✦ …). Rows are rebuilt only when the
  // set of limits changes; otherwise updated in place so bars don't flicker.
  function renderScoped(container, usage) {
    if (!container) return;
    const list = scopedList(usage);
    const sig = list.map((s) => s.key + "|" + s.label).join(";");
    if (container.dataset.sig !== sig) {
      container.textContent = "";
      container.dataset.sig = sig;
      container._rows = list.map((s) => {
        const parts = makeRow(abbr(s.label), FABLE_RE.test(s.label) ? "fable" : "scoped");
        container.appendChild(parts.row);
        container.appendChild(parts.line);
        return parts;
      });
    }
    list.forEach((s, i) => {
      const parts = container._rows[i];
      fillBar(parts, s);
      const share = typeof s.sharePct === "number"
        ? " · " + tt("hud.share").replace("{pct}", String(Math.round(s.sharePct))) : "";
      parts.label.title = s.label + share;
    });
  }

  // Extra usage (usage credits past the plan limits) — shown only when enabled
  function renderExtra(container, usage) {
    if (!container) return;
    const ex = usage && usage.extra;
    const on = !!(ex && ex.enabled);
    container.classList.toggle("hidden", !on);
    if (!on) return;
    if (!container._parts) {
      container.textContent = "";
      const parts = makeRow("💸", "extra");
      container.appendChild(parts.row);
      container.appendChild(parts.line);
      container._parts = parts;
    }
    const parts = container._parts;
    parts.label.title = tt("hud.extra");
    const hasPct = typeof ex.pct === "number";
    fillBar(parts, hasPct ? { pct: ex.pct } : null);
    if (!hasPct) parts.pctEl.textContent = "∞";   // no monthly cap: pay as you go
    const used = fmtMoney(ex.used, ex.currency), lim = fmtMoney(ex.limit, ex.currency);
    let line = used ? tt("hud.extraUsed").replace("{used}", used) : "";
    if (used && lim) line += " / " + lim;
    if (ex.spendLimitReached) line += (line ? " · " : "") + tt("hud.extraCapped");
    parts.line.textContent = line;
    parts.line.classList.toggle("hidden", !line);
  }

  // "本周去向: Claude Code 79% · Cowork 19% · Chats 2%"
  function renderBreakdown(container, usage) {
    if (!container) return;
    const b = usage && usage.breakdown;
    const rows = b && Array.isArray(b.rows)
      ? b.rows.filter((r) => r && typeof r.pct === "number" && r.pct > 0).sort((a, c) => c.pct - a.pct).slice(0, 4)
      : [];
    container.classList.toggle("hidden", !rows.length);
    if (!rows.length) return;
    container.textContent = tt("hud.breakdown") + ": " +
      rows.map((r) => r.label + " " + Math.round(r.pct) + "%").join(" · ");
  }

  // Render the "other agents" usage rows (Codex, OpenClaw 龙虾, custom JSON…)
  // into a container. Kept DOM-only so both HUD skins share it.
  function renderOthers(container, others) {
    if (!container) return;
    container.textContent = "";
    (others || []).forEach((p) => {
      if (!p || !Array.isArray(p.windows) || !p.windows.length) return;
      const name = document.createElement("div");
      name.className = "src-name";
      name.textContent = p.label || p.id;
      container.appendChild(name);
      p.windows.slice(0, 3).forEach((w) => {
        const parts = makeRow(w.label || "", "");
        fillBar(parts, w);
        container.appendChild(parts.row);
        container.appendChild(parts.line);
      });
    });
  }

  window.PetCore = {
    computeMode, planExhausted, extraActive, isOverage, blockingWindow, lockedReason, scopedList,
    fmtCd, fmtMoney, extraSummary,
    drawPet, frameCount, mergeCustomPets,
    renderOthers, renderScoped, renderExtra, renderBreakdown,
  };
})();
