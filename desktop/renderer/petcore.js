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
  // hat: a SEASON_SPRITES hat id (witch / santa / party) or null
  function drawPet(ctx, character, animState, frameIdx, blinkOn, hat) {
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
    // 🎃 seasonal hat — bobs with the idle breath, comes off while lying down
    const SS = typeof window !== "undefined" && window.SEASON_SPRITES;
    if (hat && SS && SS.hats[hat] && animState !== "sleep") {
      const dy = animState === "idle" && fi === 1 ? 1 : 0;
      const hf = SS.hats[hat];
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const c = hf[y][x];
          if (c !== ".") { ctx.fillStyle = SS.palette[c]; ctx.fillRect(x, y + dy, 1, 1); }
        }
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

  // ---- 📈 trend: pixel sparklines + "quota weather" ----
  // "1h 20m" / "1 小时 20 分" for forecast ETAs
  function fmtEta(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
    const en = typeof window !== "undefined" && window.__lang === "en";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (h >= 48) return en ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
    if (h > 0) return en ? `${h}h ${String(m).padStart(2, "0")}m` : `${h} 小时 ${String(m).padStart(2, "0")} 分`;
    return en ? `${Math.max(1, m)}m` : `${Math.max(1, m)} 分钟`;
  }
  // step-style pixel line of [[t, pct], …] over [from, to]; 70/90 guide ticks
  function drawSparkline(canvas, series, from, to) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.07)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.14)";
    for (const g of [70, 90]) { const y = Math.round(H - 1 - (g / 100) * (H - 1)); for (let x = 0; x < W; x += 3) ctx.fillRect(x, y, 1, 1); }
    if (!Array.isArray(series) || series.length < 2 || to <= from) return;
    let px = null, py = null;
    for (const [t, pct] of series) {
      if (t < from || t > to) continue;
      const x = Math.round(((t - from) / (to - from)) * (W - 1));
      const y = Math.round(H - 1 - (Math.max(0, Math.min(100, pct)) / 100) * (H - 1));
      ctx.fillStyle = pct >= 90 ? "#ff6b5e" : pct >= 70 ? "#e6c455" : "#6cc887";
      if (px !== null) {
        // horizontal run, then a vertical step — reads like an 8-bit chart
        for (let xx = px; xx <= x; xx++) ctx.fillRect(xx, py, 1, 1);
        const lo = Math.min(py, y), hi = Math.max(py, y);
        for (let yy = lo; yy <= hi; yy++) ctx.fillRect(x, yy, 1, 1);
      }
      ctx.fillRect(x, y, 1, 1);
      px = x; py = y;
    }
  }
  function renderTrend(container, usage) {
    if (!container) return;
    const tr = usage && usage.trend;
    const show = !!(tr && ((tr.seriesF && tr.seriesF.length > 1) || (tr.seriesW && tr.seriesW.length > 1)));
    container.classList.toggle("hidden", !show);
    if (!show) return;
    if (!container._parts) {
      container.textContent = "";
      const mk = (labelText) => {
        const row = document.createElement("div");
        row.className = "spark-row";
        const label = document.createElement("span");
        label.className = "bar-label";
        label.textContent = labelText;
        const canvas = document.createElement("canvas");
        canvas.width = 150; canvas.height = 14;
        canvas.className = "spark";
        row.appendChild(label); row.appendChild(canvas);
        container.appendChild(row);
        return { row, label, canvas };
      };
      const f = mk("5H"), w = mk("");
      const line = document.createElement("div");
      line.className = "trend-line";
      container.appendChild(line);
      container._parts = { f, w, line };
    }
    const P = container._parts;
    const now = Date.now();
    P.w.label.textContent = tt("hud.week");
    drawSparkline(P.f.canvas, tr.seriesF, now - 6 * 3600e3, now);
    drawSparkline(P.w.canvas, tr.seriesW, now - 7 * 24 * 3600e3, now);
    P.f.canvas.title = "5h · 6h"; P.w.canvas.title = tt("hud.week") + " · 7d";
    const key = tr.worst === "w" ? "w" : "f";
    const o = key === "w" ? tr.week : tr.five;
    let text = tt("trend.idle");
    if (o && o.weather && o.weather !== "unknown") {
      text = tt(`trend.${o.weather}.${key}`).replace("{eta}", fmtEta(o.etaMs));
      if (typeof o.rate === "number" && o.rate > 0) text += " · " + tt("trend.rate").replace("{rate}", o.rate.toFixed(1));
    }
    P.line.textContent = text;
  }

  // ---- 🌱 pixel garden ----
  function paintFrame(ctx, frame, pal) {
    ctx.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) {
      const row = frame[y];
      for (let x = 0; x < 16; x++) {
        const c = row[x];
        if (c !== ".") { ctx.fillStyle = pal[c]; ctx.fillRect(x, y, 1, 1); }
      }
    }
  }
  function stageOfPlot(p) {
    if (!p) return -1;
    if (p.progress >= 1) return 3;
    return Math.min(2, Math.floor(p.progress * 3));
  }
  // garden: {plots: [{crop, progress, wilt}|null ×3], harvested}; onPlot(i, plot) on click
  function renderGarden(container, garden, onPlot) {
    if (!container) return;
    const G = typeof window !== "undefined" && window.GARDEN_SPRITES;
    const show = !!(garden && Array.isArray(garden.plots) && G);
    container.classList.toggle("hidden", !show);
    if (!show) return;
    if (!container._plots) {
      container.textContent = "";
      const row = document.createElement("div");
      row.className = "garden-row";
      container._plots = garden.plots.map((_, i) => {
        const c = document.createElement("canvas");
        c.width = 16; c.height = 16;
        c.className = "plot";
        c.addEventListener("click", (e) => { e.stopPropagation(); if (onPlot) onPlot(i, container._garden ? container._garden.plots[i] : null); });
        row.appendChild(c);
        return c;
      });
      container.appendChild(row);
      const hint = document.createElement("div");
      hint.className = "garden-hint";
      container.appendChild(hint);
      container._hint = hint;
    }
    container._garden = garden;
    garden.plots.forEach((p, i) => {
      const c = container._plots[i];
      if (!c) return;
      const ctx = c.getContext("2d");
      const st = stageOfPlot(p);
      const frame = p && G.crops[p.crop] ? G.crops[p.crop][st] : G.soil;
      paintFrame(ctx, frame, G.palette);
      const thirsty = !!(p && p.wilt >= 0.5 && st < 3);
      if (thirsty) { ctx.fillStyle = "#5aa7ff"; ctx.fillRect(13, 1, 2, 2); ctx.fillRect(14, 0, 1, 1); }
      const crow = !!(p && p.crow);
      if (crow && G.crow) {
        // 🐦‍⬛ flap every ~600 ms; the caller re-renders each second while a crow is around
        const cf = G.crow[Math.floor(Date.now() / 600) % G.crow.length];
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const ch = cf[y][x];
          if (ch !== ".") { ctx.fillStyle = G.palette[ch]; ctx.fillRect(x, y, 1, 1); }
        }
      }
      c.classList.toggle("ripe", st === 3 && !crow);
      c.classList.toggle("crow", crow);
      c.classList.toggle("thirsty", thirsty);
      c.classList.toggle("empty", !p);
      const crop = p ? tt("crop." + p.crop) : "";
      c.title = !p ? tt("garden.plant")
        : crow ? tt("garden.crow").replace("{crop}", crop)
          : st === 3 ? tt("garden.ripe").replace("{crop}", crop)
            : thirsty ? tt("garden.thirsty").replace("{crop}", crop)
              : tt("garden.growing").replace("{crop}", crop).replace("{pct}", String(Math.round(p.progress * 100)));
    });
    const boost = garden.boost && Date.now() < garden.boost.until && garden.boost.factor > 1 ? garden.boost : null;
    container._hint.textContent = (boost
      ? tt("garden.boost").replace("{x}", String(boost.factor)).replace("{grade}", boost.grade || "A")
      : tt("garden.hint")) + (garden.harvested ? ` · 🧺 ${garden.harvested}` : "");
  }

  // ---- ⛈ live quota weather: pixel rain / lightning / sunny sparkles on an
  // overlay canvas (1 canvas px = 2 css px for that chunky look) ----
  const FX = { canvas: null, weather: "unknown", raf: 0, drops: [], sparks: [], flashUntil: 0, nextFlash: 0, onThunder: null, lastThunder: -Infinity };
  const THUNDER_GAP_MS = 60 * 1000;   // the flash can be frequent; the sound can't
  function setWeatherFx(canvas, weather, onThunder) {
    if (!canvas) return;
    FX.canvas = canvas;
    FX.onThunder = onThunder || null;
    const w = weather || "unknown";
    if (FX.weather !== w) { FX.weather = w; FX.drops = []; FX.sparks = []; FX.flashUntil = 0; FX.nextFlash = 0; }
    const active = w === "rain" || w === "storm" || w === "sunny";
    canvas.classList.toggle("hidden", !active);
    if (active && !FX.raf) FX.raf = requestAnimationFrame(fxTick);
  }
  function fxTick(t) {
    const c = FX.canvas;
    const active = FX.weather === "rain" || FX.weather === "storm" || FX.weather === "sunny";
    if (!c || !active) { FX.raf = 0; return; }
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) { FX.raf = 0; setTimeout(() => { if (!FX.raf) FX.raf = requestAnimationFrame(fxTick); }, 600); return; } // hidden HUD: idle
    const w = Math.max(1, Math.floor(cw / 2)), h = Math.max(1, Math.floor(ch / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (FX.weather === "sunny") {
      if (FX.sparks.length < 6 && Math.random() < 0.08) FX.sparks.push({ x: Math.random() * w, y: h * (0.3 + Math.random() * 0.7), life: 1 });
      FX.sparks = FX.sparks.filter((s) => s.life > 0);
      for (const s of FX.sparks) {
        s.y -= 0.15; s.life -= 0.012;
        ctx.fillStyle = `rgba(245, 209, 66, ${Math.max(0, s.life).toFixed(2)})`;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
        if (s.life > 0.5) { ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 1, 1); ctx.fillRect(Math.round(s.x) + 1, Math.round(s.y), 1, 1); ctx.fillRect(Math.round(s.x), Math.round(s.y) - 1, 1, 1); ctx.fillRect(Math.round(s.x), Math.round(s.y) + 1, 1, 1); }
      }
    } else {
      const storm = FX.weather === "storm";
      const want = storm ? Math.floor(w / 4) : Math.floor(w / 9);
      while (FX.drops.length < want) FX.drops.push({ x: Math.random() * w, y: Math.random() * h, v: 2 + Math.random() * (storm ? 2.5 : 1.2) });
      ctx.fillStyle = storm ? "rgba(150, 190, 255, .75)" : "rgba(130, 170, 230, .55)";
      for (const d of FX.drops) {
        d.y += d.v; d.x -= storm ? 0.6 : 0.25;
        if (d.y > h) { d.y = -2; d.x = Math.random() * w; }
        if (d.x < 0) d.x = w;
        ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 2);
      }
      if (storm) {
        if (!FX.nextFlash) FX.nextFlash = t + 2500 + Math.random() * 5000;
        if (t >= FX.nextFlash) {
          FX.flashUntil = t + 140; FX.nextFlash = t + 4000 + Math.random() * 7000;
          if (FX.onThunder && t - FX.lastThunder >= THUNDER_GAP_MS) {
            FX.lastThunder = t;
            try { FX.onThunder(); } catch { /* ignore */ }
          }
        }
        if (t < FX.flashUntil) {
          ctx.fillStyle = "rgba(255, 255, 255, .28)"; ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#fff8c0";
          let x = Math.floor(w * (0.3 + Math.random() * 0.4)), y = 0;
          while (y < h) { ctx.fillRect(x, y, 1, 3); y += 3; x += Math.random() < 0.5 ? -1 : 1; }
        }
      }
    }
    FX.raf = requestAnimationFrame(fxTick);
  }

  // ---- 📋 weekly report card ----
  // onShare(): optional — adds a 📤 button under the card
  function renderReport(container, report, lastReport, onShare) {
    if (!container) return;
    container.textContent = "";
    const el = (cls, text, parent) => { const d = document.createElement("div"); d.className = cls; if (text != null) d.textContent = text; (parent || container).appendChild(d); return d; };
    el("rc-title", tt("report.title"));
    if (!report || !report.grade) { el("rc-row", tt("report.empty")); return; }
    const head = el("rc-head");
    const g = document.createElement("span"); g.className = "rc-grade g-" + report.grade; g.textContent = report.grade; head.appendChild(g);
    const txt = document.createElement("div");
    el("rc-name", tt("title." + report.title), txt);
    el("rc-sub", report.usedPct !== null ? tt("report.used").replace("{pct}", String(Math.round(report.usedPct))) : "", txt);
    head.appendChild(txt);
    el("rc-row", tt("report.depletions").replace("{n}", String(report.depletions)).replace("{m}", String(report.nearMisses)));
    const bits = [];
    if (report.peakDay !== null) bits.push(tt("report.peak").replace("{day}", tt("day." + report.peakDay)));
    bits.push(tt("report.late").replace("{pct}", String(Math.round(report.lateNightShare * 100))));
    el("rc-row", bits.join(" · "));
    el("rc-row", tt("report.garden").replace("{h}", String(report.harvested)).replace("{l}", String(report.lost)).replace("{s}", String(report.shooed)));
    (report.tips || []).forEach((k) => el("rc-tip", "💡 " + tt("tip." + k)));
    if (lastReport && lastReport.grade) el("rc-last", tt("report.last").replace("{grade}", lastReport.grade).replace("{title}", tt("title." + lastReport.title)));
    if (typeof onShare === "function") {
      const b = document.createElement("button");
      b.className = "rc-share";
      b.textContent = tt("report.share");
      b.addEventListener("click", (e) => { e.stopPropagation(); onShare(); });
      container.appendChild(b);
    }
  }

  // ---- 📤 shareable pixel report card (PNG) ----
  // d: { report, character, hat, seriesW, lastReport }. Draws a 600×340 card at
  // 2× into `canvas` and returns it.
  function renderShareCard(canvas, d) {
    const S = 2, W = 600, H = 340;
    canvas.width = W * S; canvas.height = H * S;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const en = typeof window !== "undefined" && window.__lang === "en";
    const font = (px, bold) => `${bold ? "bold " : ""}${px}px -apple-system, "PingFang SC", "Helvetica Neue", "Segoe UI", sans-serif`;
    // background + pixel frame
    ctx.fillStyle = "#15151f"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1e1e2e"; for (let x = 0; x < W; x += 12) for (let y = 0; y < H; y += 12) if ((x + y) % 24 === 0) ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = "#8e7cc3"; ctx.lineWidth = 2; ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.strokeStyle = "#3a3a4a"; ctx.lineWidth = 1; ctx.strokeRect(9.5, 9.5, W - 19, H - 19);
    // the pet (with its hat) at ×6
    const off = document.createElement("canvas"); off.width = 16; off.height = 16;
    try { drawPet(off.getContext("2d"), d.character || "cat", "idle", 0, false, d.hat || null); } catch { /* ignore */ }
    ctx.drawImage(off, 0, 0, 16, 16, 28, 34, 96, 96);
    // header
    ctx.fillStyle = "#e8e8f0"; ctx.font = font(20, true); ctx.textBaseline = "top";
    ctx.fillText("Claude Pet · " + tt("report.card.title"), 146, 32);
    const r = d.report || {};
    const since = r.since ? new Date(r.since) : null;
    const fmtD = (t) => `${t.getMonth() + 1}/${t.getDate()}`;
    ctx.fillStyle = "#9a9ab0"; ctx.font = font(12);
    ctx.fillText((since ? fmtD(since) + " – " : "") + fmtD(new Date()), 146, 58);
    // grade box
    const colors = { S: "#f5d142", A: "#6cc887", B: "#e6b455", C: "#d9634f" };
    const gc = colors[r.grade] || "#9a9ab0";
    ctx.strokeStyle = gc; ctx.lineWidth = 3; ctx.strokeRect(478, 30, 92, 92);
    ctx.fillStyle = gc; ctx.font = font(60, true); ctx.textAlign = "center";
    ctx.fillText(r.grade || "?", 524, 42);
    ctx.textAlign = "left";
    // title + stats
    ctx.fillStyle = "#f5d142"; ctx.font = font(26, true);
    ctx.fillText(r.title ? tt("title." + r.title) : "—", 146, 84);
    ctx.fillStyle = "#c8c8d8"; ctx.font = font(15);
    const used = r.usedPct !== null && r.usedPct !== undefined ? Math.round(r.usedPct) + "%" : "—";
    ctx.fillText(`${tt("report.card.used")} ${used} · ${tt("report.card.dry")} ${r.depletions || 0}${tt("report.card.times")} · ${tt("report.card.close")} ${r.nearMisses || 0}${tt("report.card.times")}`, 146, 128);
    const peak = r.peakDay !== null && r.peakDay !== undefined ? tt("day." + r.peakDay) : "—";
    ctx.fillText(`${tt("report.peak").replace("{day}", peak)} · ${tt("report.card.late")} ${Math.round((r.lateNightShare || 0) * 100)}%`, 146, 152);
    ctx.fillText(`🧺 ${tt("report.card.harvest")} ${r.harvested || 0} · 🐦‍⬛ ${r.lost || 0} · 🌱 ${r.shooed || 0}`, 146, 176);
    (r.tips || []).slice(0, 1).forEach((k) => { ctx.fillStyle = "#f0d890"; ctx.fillText("💡 " + tt("tip." + k), 146, 200); });
    // weekly sparkline
    const sx = 28, sy = 236, sw = 544, sh = 64;
    ctx.fillStyle = "#9a9ab0"; ctx.font = font(11); ctx.fillText(tt("report.card.week"), sx, sy - 14);
    ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = "rgba(255,255,255,.14)"; for (const g of [70, 90]) { const y = Math.round(sy + sh - (g / 100) * sh); for (let x = sx; x < sx + sw; x += 6) ctx.fillRect(x, y, 2, 1); }
    const series = Array.isArray(d.seriesW) ? d.seriesW : [];
    if (series.length > 1) {
      const t0 = series[0][0], t1 = series[series.length - 1][0] || t0 + 1;
      let px = null, py = null;
      for (const [t, pct] of series) {
        const x = Math.round(sx + ((t - t0) / Math.max(1, t1 - t0)) * (sw - 2));
        const y = Math.round(sy + sh - 2 - (Math.max(0, Math.min(100, pct)) / 100) * (sh - 4));
        ctx.fillStyle = pct >= 90 ? "#ff6b5e" : pct >= 70 ? "#e6c455" : "#6cc887";
        if (px !== null) { ctx.fillRect(Math.min(px, x), py, Math.abs(x - px) + 2, 2); ctx.fillRect(x, Math.min(py, y), 2, Math.abs(y - py) + 2); }
        ctx.fillRect(x, y, 2, 2); px = x; py = y;
      }
    }
    // footer
    ctx.fillStyle = "#6a6a80"; ctx.font = font(11);
    ctx.fillText("github.com/Lew1sWong/claude-pet", sx, 314);
    ctx.textAlign = "right"; ctx.fillText(en ? "my week with Claude 🐾" : "我和 Claude 的一周 🐾", sx + sw, 314); ctx.textAlign = "left";
    return canvas;
  }

  window.PetCore = {
    computeMode, planExhausted, extraActive, isOverage, blockingWindow, lockedReason, scopedList,
    fmtCd, fmtMoney, fmtEta, extraSummary,
    drawPet, frameCount, mergeCustomPets,
    renderOthers, renderScoped, renderExtra, renderBreakdown,
    drawSparkline, renderTrend, renderGarden, stageOfPlot,
    setWeatherFx, renderReport, renderShareCard,
  };
})();
