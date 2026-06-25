/* Claude Pet — shared pure helpers used by both renderers (floating pet &
   Dynamic Island). Keeping mood thresholds, countdown formatting and the
   sprite drawing in one place stops the two skins from drifting apart.
   Depends on the global SPRITES (sprites.js) being loaded first. */
(function () {
  "use strict";

  // usage → mood. errorCode short-circuits to "lost". Mirrors the thresholds
  // the whole app reacts to, so it lives here as the single source of truth.
  function computeMode(usage, errorCode) {
    if (errorCode === "no-credentials" || errorCode === "auth") return "lost";
    if (!usage) return "unknown";
    const f = usage.fiveHour ? usage.fiveHour.pct : 0;
    const w = usage.week ? usage.week.pct : 0;
    const worst = Math.max(f, w);
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

  // Draw a 16×16 pixel pet onto a 2d context. animState is already resolved
  // to "idle" | "walk" | "sleep"; blinkOn toggles the closed-eye overlay.
  function drawPet(ctx, character, animState, frameIdx, blinkOn) {
    const pal = SPRITES.palettes[character];
    const frames = SPRITES.frames[character][animState];
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
    if (blinkOn && animState !== "sleep") {
      const dy = animState === "idle" && fi === 1 ? 1 : 0;
      ctx.fillStyle = pal.d;
      for (const [ex, ey] of SPRITES.eyes[character]) {
        ctx.fillRect(ex, ey + dy, 1, 1);
      }
    }
  }

  window.PetCore = { computeMode, fmtCd, drawPet };
})();
