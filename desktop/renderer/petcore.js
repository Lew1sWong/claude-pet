/* Claude Pet — shared pure helpers used by both renderers (floating pet &
   Dynamic Island). Keeping mood thresholds, countdown formatting and the
   sprite drawing in one place stops the two skins from drifting apart.
   Depends on the global SPRITES (sprites.js) being loaded first. */
(function () {
  "use strict";

  // usage → mood. errorCode short-circuits to "lost". Mirrors the thresholds
  // the whole app reacts to, so it lives here as the single source of truth.
  // Fable (the priciest window) counts toward the pet's anxiety; when Claude
  // itself is off but other agents (Codex/OpenClaw/自定义) are tracked, their
  // worst window drives the mood instead so the pet never plays dead.
  function computeMode(usage, errorCode) {
    if (errorCode === "no-credentials" || errorCode === "auth") return "lost";
    if (!usage) return "unknown";
    const f = usage.fiveHour ? usage.fiveHour.pct : 0;
    const w = usage.week ? usage.week.pct : 0;
    const fb = usage.fable ? usage.fable.pct : 0;
    if (!usage.fiveHour && !usage.week && !usage.fable) {
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
    const worst = Math.max(f, w, fb);
    if (f >= 99.5 || w >= 99.5) return "depleted";
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
        const row = document.createElement("div");
        row.className = "bar-row";
        const label = document.createElement("span");
        label.className = "bar-label";
        label.textContent = w.label || "";
        const bar = document.createElement("div");
        bar.className = "bar";
        const fill = document.createElement("div");
        fill.className = "bar-fill";
        const pct = typeof w.pct === "number" ? Math.round(w.pct) : null;
        fill.style.width = pct === null ? "0%" : Math.min(100, pct) + "%";
        if (pct !== null && pct >= 90) fill.classList.add("danger");
        else if (pct !== null && pct >= 70) fill.classList.add("warn");
        bar.appendChild(fill);
        const pctEl = document.createElement("span");
        pctEl.className = "bar-pct";
        pctEl.textContent = pct === null ? "--%" : pct + "%";
        row.appendChild(label); row.appendChild(bar); row.appendChild(pctEl);
        container.appendChild(row);
        const cd = w.resetsAt ? fmtCd(w.resetsAt) : null;
        if (cd) {
          const line = document.createElement("div");
          line.className = "reset-line";
          line.textContent = "↻ " + cd;
          container.appendChild(line);
        }
      });
    });
  }

  window.PetCore = { computeMode, fmtCd, drawPet, frameCount, mergeCustomPets, renderOthers };
})();
