/* Claude Pet — Dynamic Island renderer. The pet lives inside a black capsule
   pinned to the top-center notch. It never walks; instead the capsule morphs
   between a compact pill (pet + 5h %) and an expanded panel (full usage).
   Reuses the exact same usage→mood pipeline as the floating pet. */
(function () {
  "use strict";
  const api = window.petAPI;
  const t = window.t;   // i18n lookup (reads window.I18N live)
  const {
    computeMode, fmtCd, drawPet, frameCount, mergeCustomPets,
    renderOthers, renderScoped, renderExtra, renderBreakdown, renderTrend, renderGarden,
    setWeatherFx, renderReport, blockingWindow, lockedReason,
  } = window.PetCore;
  const sfx = (n) => { if (window.SFX) window.SFX.play(n); };

  const charsNow = () => Object.keys(SPRITES.frames);
  let character = "cat";

  // ------------------------------------------------------------- dom
  const island = document.getElementById("island");
  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const miniPct = document.getElementById("mini-pct");
  const miniBadge = document.getElementById("mini-badge");
  const nameEl = document.getElementById("pet-name");
  const bubble = document.getElementById("bubble");
  const msgEl = document.getElementById("msg");
  const bar5 = document.getElementById("bar5");
  const barw = document.getElementById("barw");
  const pct5 = document.getElementById("pct5");
  const pctw = document.getElementById("pctw");
  const reset5 = document.getElementById("reset5");
  const resetw = document.getElementById("resetw");
  const scopedEl = document.getElementById("scoped");
  const extraEl = document.getElementById("extra");
  const breakdownEl = document.getElementById("breakdown");
  const trendEl = document.getElementById("trend");
  const gardenEl = document.getElementById("garden");
  const reportEl = document.getElementById("report-card");
  const wxEl = document.getElementById("wx");
  const othersEl = document.getElementById("others");

  // ------------------------------------------------------------- state
  let usage = null;
  let errorCode = null;
  let errorDetail = "";
  let mode = "unknown";
  let frameIdx = 0;
  let lastSwap = 0;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 3000;
  let celebrateUntil = 0;
  let lastT = performance.now();

  // animation in-place (no walking): pick frame state + cadence per mood
  const ANIM = {
    happy:    { state: "walk",  frameMs: 280 },
    calm:     { state: "idle",  frameMs: 550 },
    sleepy:   { state: "idle",  frameMs: 900 },
    anxious:  { state: "walk",  frameMs: 160 },
    overage:  { state: "walk",  frameMs: 180 }, // plan dry, credits burning
    depleted: { state: "sleep", frameMs: 1100 },
    lost:     { state: "sleep", frameMs: 1300 },
    unknown:  { state: "idle",  frameMs: 600 },
  };

  // zh fallbacks; replaced live by window.PetLines from the i18n broadcast
  let CLICK_LINES = {
    cat: ["喵~", "(=^･ω･^=)", "呼噜呼噜…", "摸摸!"],
    dog: ["汪!", "尾巴摇摇~", "(´･ᴥ･`)", "一起加油!"],
    bear: ["吼~", "抱抱!", "ʕ•ᴥ•ʔ", "蜂蜜呢?"],
    rabbit: ["蹦蹦~", "(•ㅅ•)", "耳朵不要拉啦!", "一起蹦跶!"],
    fox: ["嗷呜~", "(◡ ω ◡)", "尾巴毛茸茸的!", "嘿嘿~"],
    penguin: ["企~", "ʕ•ᴥ•ʔ 摇摇摆", "滑一个!", "(°ㅂ°)"],
    star: ["✦ 闪!", "我是小克~", "充能中…", "(★ω★)"],
  };
  let FEED_LINES = {
    cat: ["啊呜啊呜~ 小鱼干!", "喵呜~ 好吃!"],
    dog: ["啊呜! 肉骨头!", "汪汪! 谢谢投喂!"],
    bear: ["啊呜~ 是蜂蜜味的!", "吧唧吧唧…"],
    rabbit: ["咔哧咔哧~ 胡萝卜!", "嫩嫩的菜叶子!"],
    fox: ["啊呜! 这是给我的?", "嗷呜~ 真香!"],
    penguin: ["啊呜~ 小鱼!", "新鲜的鱼鱼!"],
    star: ["✦ 吸收能量中…", "嗯! 满电啦!"],
  };
  let COMBO = "别 rua 了别 rua 了!!";
  let RESET_LINE = "额度重置啦!! ✦";
  // custom pixel buddies (loved ones) fall back to these lines
  let BUDDY_LINES = {
    click: ["陪你工作~", "加油加油!", "想我了吗?", "❤"],
    feed: ["谢谢~ 你也要好好吃饭!", "啊呜~ 一起补充能量!"],
  };
  let HARVEST_LINES = ["啊呜~ 自己种的最香!", "咔嚓咔嚓~ 新鲜!", "谢谢你照顾菜园 ❤"];

  // ------------------------------------------------------------- pet animation
  let microState = null;   // idle micro-animation: "yawn" | "stretch"
  let microUntil = 0;
  let nextMicro = performance.now() + 15000 + Math.random() * 15000;

  function tick(t) {
    lastT = t;
    const a = ANIM[mode] || ANIM.unknown;

    // occasionally stop to yawn / stretch (never while asleep or celebrating)
    if (a.state !== "sleep" && t >= celebrateUntil && t > nextMicro) {
      microState = Math.random() < (mode === "sleepy" ? 0.72 : 0.42) ? "yawn" : "stretch";
      microUntil = t + 2800;
      nextMicro = t + 22000 + Math.random() * 30000;
      frameIdx = 0;
    }
    const microing = a.state !== "sleep" && t < microUntil && microState;
    if (!microing) microState = null;

    const state = microing ? microState : a.state;
    const frameMs = microing ? 700 : a.frameMs;
    if (t - lastSwap > frameMs) { frameIdx = (frameIdx + 1) % frameCount(character, state); lastSwap = t; }
    if (t > nextBlink) { blinkUntil = t + 160; nextBlink = t + 2200 + Math.random() * 3500; }

    let bob = state === "sleep" || microing ? 0 : Math.sin(t / 420) * 1.2;
    if (t < celebrateUntil) bob = -Math.abs(Math.sin(t / 85)) * 6;
    canvas.style.transform = `translateY(${bob.toFixed(2)}px)`;

    drawPet(ctx, character, state, frameIdx, t < blinkUntil, season ? season.hat : null);
  }
  function rafLoop(t) { tick(t); requestAnimationFrame(rafLoop); }

  // ------------------------------------------------------------- usage / hud
  // grow the expanded capsule to fit extra rows (scoped limits / extra usage /
  // breakdown / trend / garden / other agents), capped just under the 500px host window
  function fitExpanded() {
    const body = document.querySelector(".body");
    if (!body) return;
    const barH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar-h")) || 32;
    const h = Math.max(300, Math.min(492, barH + body.scrollHeight + 6));
    document.documentElement.style.setProperty("--expanded-h", h + "px");
  }

  function setBar(fill, pctEl, lineEl, win) {
    if (!win) { fill.style.width = "0%"; pctEl.textContent = "--%"; lineEl.textContent = ""; return; }
    const pct = Math.round(win.pct);
    fill.style.width = Math.min(100, pct) + "%";
    fill.classList.toggle("warn", pct >= 70 && pct < 90);
    fill.classList.toggle("danger", pct >= 90);
    pctEl.textContent = pct + "%";
    const cd = fmtCd(win.resetsAt);
    lineEl.textContent = cd ? "↻ " + cd : "";
  }

  const WEATHER_EMOJI = { cloudy: "🌤", rain: "🌧", storm: "⛈" };
  // the collapsed pill's badge: a crow needs you (click → expand), then bad
  // weather, then the season's emoji; nothing when all is calm
  function refreshBadge() {
    let b = "", cls = "";
    if (garden && garden.plots && garden.plots.some((p) => p && p.crow)) { b = "🐦‍⬛"; cls = "crow"; }
    else {
      const tr = usage && usage.trend;
      const wx = tr ? (tr.worst === "w" ? tr.week : tr.five) : null;
      if (wx && WEATHER_EMOJI[wx.weather]) b = WEATHER_EMOJI[wx.weather];
      else if (season) b = season.fx[0];
    }
    miniBadge.textContent = b;
    miniBadge.className = b ? cls : "hidden";
  }
  function refreshMini() {
    refreshBadge();
    if (errorCode === "no-credentials" || errorCode === "auth") { miniPct.textContent = "?"; miniPct.className = ""; return; }
    if (errorCode === "rate-limit") { miniPct.textContent = "🚦"; miniPct.className = ""; return; }
    if (mode === "overage") { miniPct.textContent = "💸"; miniPct.className = "danger"; return; }
    const f = usage && usage.fiveHour ? Math.round(usage.fiveHour.pct) : null;
    if (f === null) { miniPct.textContent = "··"; miniPct.className = ""; return; }
    miniPct.textContent = f + "%";
    miniPct.className = f >= 90 ? "danger" : f >= 70 ? "warn" : "";
  }

  function refreshBody() {
    setBar(bar5, pct5, reset5, usage && usage.fiveHour);
    setBar(barw, pctw, resetw, usage && usage.week);
    renderScoped(scopedEl, usage);
    renderExtra(extraEl, usage);
    renderBreakdown(breakdownEl, usage);
    renderTrend(trendEl, usage);
    refreshGarden();
    refreshReport();
    refreshWeather();
    renderOthers(othersEl, usage && usage.others);
    nameEl.textContent = ((SPRITES.names && SPRITES.names[character]) || character) + (season ? " " + season.fx[0] : "");
    msgEl.classList.add("hidden");
    if (errorCode === "no-credentials") show(msgEl, t("err.noCreds"));
    else if (errorCode === "auth") show(msgEl, t("err.auth"));
    else if (errorCode === "rate-limit") show(msgEl, "🚦 " + (errorDetail || t("err.rate")));
    else if (errorCode) show(msgEl, t("err.fetch") + (errorDetail ? " · " + errorDetail.slice(0, 80) : ""));
    else if (mode === "overage") show(msgEl, t("msg.overage"));
    else if (mode === "depleted" && usage) {
      const lock = lockedReason(usage);
      const win = blockingWindow(usage);
      if (lock) show(msgEl, t("msg.locked").replace("{reason}", lock));
      else show(msgEl, t("msg.depleted") + " " + ((win && fmtCd(win.resetsAt)) || "") + (usage.extra && usage.extra.enabled ? " · " + t("hud.extraCapped") : ""));
    }
    fitExpanded();   // after the message box exists, so it's counted in the height
  }
  function show(el, text) { el.textContent = text; el.classList.remove("hidden"); }


  // ------------------------------------------------------------- 🌱 garden
  let garden = null;
  let gardenOn = true;
  let season = null;        // 🎃 current season from the usage payload (hat, fx)
  let lastHarvestAt = 0;
  const CROP_EMOJI = { carrot: "🥕", tomato: "🍅", sunflower: "🌻", pumpkin: "🎃" };
  function onPlot(i, plot) {
    if (plot && plot.crow) { api.gardenShoo(i); return; }          // 🐦‍⬛ shoo first
    if (!plot) { api.gardenPlant(i, null); sfx("plant"); }
    else if (plot.progress >= 1) api.gardenHarvest(i);
    else sayTemp((plot.wilt >= 0.5 ? t("garden.thirsty") : t("garden.growing"))
      .replace("{crop}", t("crop." + plot.crop)).replace("{pct}", String(Math.round(plot.progress * 100))), 2000);
  }
  function celebrateHarvest(crop) {
    sfx("harvest");
    sayTemp(HARVEST_LINES[Math.floor(Math.random() * HARVEST_LINES.length)], 2600);
    celebrateUntil = performance.now() + 1500;
    if (!hovering) autoExpand(3000);
    let n = 0;
    const tk = setInterval(() => { spawnFx(n % 2 ? "♥" : (CROP_EMOJI[crop] || "🌱")); if (++n > 4) clearInterval(tk); }, 220);
  }
  function refreshGarden() { renderGarden(gardenEl, gardenOn ? garden : null, onPlot); refreshBadge(); }
  let lastShooed = -1;
  let lastLossAt = 0;
  api.onGarden((g) => {
    garden = g;
    const h = g && g.lastHarvest;
    if (h && h.at && h.at !== lastHarvestAt) {
      if (lastHarvestAt) celebrateHarvest(h.crop);   // not on the initial load
      lastHarvestAt = h.at;
    }
    const shooed = g ? g.shooed || 0 : 0;
    if (lastShooed >= 0 && shooed > lastShooed) { sfx("shoo"); sayTemp(t("garden.shooed"), 1800); spawnFx("🐦‍⬛"); spawnFx("💨"); }
    lastShooed = shooed;
    const loss = g && g.lastLoss;
    if (loss && loss.at && loss.at !== lastLossAt) {
      if (lastLossAt) { sayTemp(t("crow.lost").replace("{crop}", t("crop." + loss.crop)), 3000); spawnFx("🐦‍⬛"); }
      lastLossAt = loss.at;
    }
    refreshGarden();
  });
  // 📋 weekly report card (toggle with the button; auto-opens when a new
  // week was just graded)
  let reportOpen = false;
  let lastReportAt = 0;
  function refreshReport() {
    reportEl.classList.toggle("hidden", !reportOpen);
    reportEl.parentElement.classList.toggle("report-mode", reportOpen);
    if (reportOpen) renderReport(reportEl, usage && usage.report, usage && usage.lastReport, shareReport);
    fitExpanded();
  }
  // 📤 share: render the pixel card and hand the PNG to main (Downloads + clipboard)
  function shareReport() {
    try {
      const c = document.createElement("canvas");
      window.PetCore.renderShareCard(c, {
        report: usage && usage.report, character, hat: season ? season.hat : null,
        seriesW: usage && usage.trend ? usage.trend.seriesW : [], lastReport: usage && usage.lastReport,
      });
      api.shareReport(c.toDataURL("image/png"));
      sfx("level");
    } catch (e) { sayTemp(t("report.shareFail"), 2000); }
  }

  document.getElementById("report").addEventListener("click", () => { reportOpen = !reportOpen; sfx("click"); refreshReport(); });
  // ⛈ live weather on the overlay canvas, driven by the forecast
  function refreshWeather() {
    const tr = usage && usage.trend;
    const wx = tr ? (tr.worst === "w" ? tr.week : tr.five) : null;
    setWeatherFx(wxEl, wx ? wx.weather : "unknown", () => { if (island.classList.contains("expanded")) sfx("thunder"); });
  }
  api.onSfx((n) => sfx(n));

  function applyState() {
    mode = computeMode(usage, errorCode);
    refreshMini();
    refreshBody();
    refreshBubble();
  }

  // ------------------------------------------------------------- bubble + fx
  let bubbleTimer = null;
  function refreshBubble() {
    clearTimeout(bubbleTimer);
    if (mode === "depleted" || mode === "lost" || mode === "overage") {
      bubble.textContent = mode === "lost" ? "?" : mode === "overage" ? "💸" : t("bubble.zzz");
      bubble.classList.remove("hidden");
    } else {
      bubble.classList.add("hidden");
    }
  }
  function sayTemp(text, ms) {
    bubble.textContent = text;
    bubble.classList.remove("hidden");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(refreshBubble, ms || 1600);
  }
  function spawnFx(emoji) {
    const fx = document.createElement("div");
    fx.className = "float-fx";
    const r = island.getBoundingClientRect();
    fx.textContent = emoji;
    fx.style.left = (r.left + r.width / 2 + (Math.random() * 30 - 15)) + "px";
    fx.style.top = (r.bottom - 8 + (Math.random() * 8 - 4)) + "px";
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }

  // ------------------------------------------------------------- expand / collapse
  let hovering = false;
  let collapseTimer = null;
  let autoTimer = null;
  function expand() {
    clearTimeout(collapseTimer);
    island.classList.remove("collapsed");
    island.classList.add("expanded");
  }
  function collapse() {
    island.classList.remove("expanded");
    island.classList.add("collapsed");
  }
  function scheduleCollapse(delay) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => { if (!hovering) collapse(); }, delay || 500);
  }
  // pop open briefly (live-activity style), then auto-collapse unless hovered
  function autoExpand(ms) {
    expand();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { if (!hovering) collapse(); }, ms || 3200);
  }
  island.addEventListener("mouseenter", () => { hovering = true; clearTimeout(autoTimer); expand(); });
  island.addEventListener("mouseleave", () => { hovering = false; scheduleCollapse(500); });
  // native menus (right-click / 🐾) can swallow the mouseleave, leaving
  // `hovering` stuck true and the panel stuck open — reconcile against the real
  // CSS :hover state on blur/focus and a moment after a menu is requested
  function reconcileHover() {
    hovering = island.matches(":hover");
    if (!hovering) scheduleCollapse(150);
  }
  function afterMenu() { setTimeout(reconcileHover, 300); setTimeout(reconcileHover, 800); }
  window.addEventListener("blur", () => { hovering = false; scheduleCollapse(300); });
  window.addEventListener("focus", reconcileHover);

  // ------------------------------------------------------------- click-through
  // collapsed: only the pet/% capture the mouse; expanded: the whole capsule.
  // the empty notch-gap & flank padding stay click-through so they never
  // swallow real menu-bar clicks (esp. on non-notch / external displays)
  function overPill(el) {
    if (!el) return false;
    if (island.classList.contains("expanded")) return !!el.closest("#island");
    return !!el.closest("#pet, #mini-pct, #mini-badge");
  }
  let ignoring = null;
  document.addEventListener("mousemove", (e) => {
    if (window.__petGameActive) return;
    const interactive = overPill(document.elementFromPoint(e.clientX, e.clientY));
    if (interactive === ignoring) {
      api.setIgnore(!interactive);
      ignoring = !interactive;
    }
  });
  api.setIgnore(false);
  ignoring = false;
  // games module bypasses this tracker via api.setIgnore; let it restore a safe
  // click-through state on exit so transparent flanks don't keep eating clicks
  window.__petResetIgnore = () => { api.setIgnore(true); ignoring = true; };

  // ------------------------------------------------------------- interactions
  island.addEventListener("contextmenu", (e) => { e.preventDefault(); api.showMenu(); afterMenu(); });

  let comboCount = 0;
  let comboTimer = null;
  function onPetClick(e) {
    e.stopPropagation();
    comboCount++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => (comboCount = 0), 2500);
    if (comboCount >= 5) {
      comboCount = 0;
      sayTemp(COMBO, 2200);
      celebrateUntil = performance.now() + 1200;
      let n = 0;
      const t = setInterval(() => { spawnFx("♥"); if (++n > 6) clearInterval(t); }, 120);
      return;
    }
    const lines = CLICK_LINES[character] || BUDDY_LINES.click;
    sayTemp(lines[Math.floor(Math.random() * lines.length)]);
    spawnFx("♥");
  }
  canvas.addEventListener("click", onPetClick);
  miniBadge.addEventListener("click", (e) => { e.stopPropagation(); expand(); });

  function feedPet() {
    const lines = FEED_LINES[character] || BUDDY_LINES.feed;
    sayTemp(lines[Math.floor(Math.random() * lines.length)], 2200);
    celebrateUntil = performance.now() + 1100;
    let n = 0;
    const t = setInterval(() => { spawnFx(n === 0 ? "🍖" : "♥"); if (++n > 3) clearInterval(t); }, 250);
  }

  function switchCharacter(step) {
    const chars = charsNow();
    const i = (chars.indexOf(character) + step + chars.length) % chars.length;
    api.setCharacter(chars[i]); // main saves & broadcasts back
  }
  document.getElementById("prev").addEventListener("click", () => switchCharacter(-1));
  document.getElementById("next").addEventListener("click", () => switchCharacter(1));
  document.getElementById("feed").addEventListener("click", feedPet);
  document.getElementById("menu").addEventListener("click", () => { api.showMenu(); afterMenu(); });
  document.getElementById("refresh").addEventListener("click", () => { sayTemp(t("game.refresh"), 1200); api.refresh(); });
  document.getElementById("game").addEventListener("click", () => { if (window.PetGames) window.PetGames.open(); });

  // ------------------------------------------------------------- host events
  const MOOD_ORDER = { happy: 0, calm: 1, sleepy: 2, anxious: 3, overage: 4, depleted: 5 };
  const knownMood = (m) => m in MOOD_ORDER;
  api.onUsage((d) => {
    const prev = mode;
    usage = d; errorCode = null;
    season = d && d.season ? d.season : null;
    const lr = d && d.lastReport;
    if (lr && lr.at && lr.at !== lastReportAt) {
      if (lastReportAt) { reportOpen = true; if (!hovering) autoExpand(9000); }
      lastReportAt = lr.at;
    }
    applyState();
    // live-activity: pop open only on a real tightening between two known moods
    // (not when arriving from the unknown/lost no-data states, e.g. on launch)
    if (!hovering && knownMood(prev) && knownMood(mode) &&
        MOOD_ORDER[mode] > MOOD_ORDER[prev] && MOOD_ORDER[mode] >= 2) {
      autoExpand(3200);
    }
  });
  api.onError((d) => {
    errorCode = (d && d.code) || "fetch";
    errorDetail = (d && d.message) || "";
    applyState();
  });
  api.onCelebrate(() => {
    celebrateUntil = performance.now() + 2600;
    sayTemp(RESET_LINE, 2600);
    if (!hovering) autoExpand(3200);
    let n = 0;
    const t = setInterval(() => { spawnFx((season ? season.fx : ["✦", "★", "♥"])[n % 3]); if (++n > 7) clearInterval(t); }, 300);
  });
  api.onCharacter((c) => {
    if (charsNow().includes(c)) { character = c; window.__petCharacter = c; frameIdx = 0; refreshBody(); }
  });
  api.onCustomPets((list) => {
    mergeCustomPets(list);
    if (!charsNow().includes(character)) { character = "cat"; frameIdx = 0; }
    refreshBody();
  });
  api.onGeometry((g) => {
    if (!g) return;
    const root = document.documentElement.style;
    if (Number.isFinite(g.notchTop) && g.notchTop > 0) root.setProperty("--bar-h", g.notchTop + "px");
    if (g.hasNotch && Number.isFinite(g.notchW) && g.notchW > 0) root.setProperty("--notch-w", g.notchW + "px");
  });
  api.onOpenGame((k) => { if (window.PetGames) window.PetGames.open(k); });
  api.onI18n((d) => {
    window.I18N = d.dict; window.__lang = d.lang;
    if (d.lines) {
      CLICK_LINES = d.lines.click; FEED_LINES = d.lines.feed; COMBO = d.lines.combo; RESET_LINE = d.lines.reset;
      if (d.lines.buddy) BUDDY_LINES = d.lines.buddy;
      if (d.lines.harvest) HARVEST_LINES = d.lines.harvest;
    }
    if (window.applyI18n) window.applyI18n();
    refreshMini(); refreshBody(); refreshBubble();
  });
  api.onFeatures((f) => {
    const g = document.getElementById("game");
    if (g) g.style.display = (f && f.games) ? "" : "none";
    gardenOn = !(f && f.garden === false);
    if (window.SFX) window.SFX.setEnabled(!!(f && f.sound));
    refreshGarden();
    fitExpanded();
  });

  // keep countdowns live
  setInterval(() => {
    if (usage) {
      setBar(bar5, pct5, reset5, usage.fiveHour);
      setBar(barw, pctw, resetw, usage.week);
      renderScoped(scopedEl, usage);
      renderExtra(extraEl, usage);
    }
    // 🐦‍⬛ keep the crow flapping while it's around
    if (garden && garden.plots && garden.plots.some((p) => p && p.crow)) refreshGarden();
  }, 1000);

  applyState();
  refreshBubble();
  requestAnimationFrame(rafLoop);
  // watchdog: keep ticking if rAF gets suspended while unfocused/occluded
  setInterval(() => { const t = performance.now(); if (t - lastT > 900) tick(t); }, 1000);
})();
