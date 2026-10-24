/* Claude Pet — floating desktop renderer. The pet stays centered in its
   small transparent window; "walking" moves the whole window across the
   screen via IPC. Transparent areas are click-through. */
(function () {
  "use strict";
  const api = window.petAPI;
  const t = window.t;   // i18n lookup (reads window.I18N live)

  const charsNow = () => Object.keys(SPRITES.frames);
  let character = "cat";

  // ------------------------------------------------------------- dom
  const wrap = document.getElementById("pet-wrap");
  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const bubble = document.getElementById("bubble");
  const hud = document.getElementById("hud");
  const nameEl = document.getElementById("pet-name");
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
  let dir = 1;
  let walkActive = false;
  let nextWalkDecision = 0;
  let frameIdx = 0;
  let lastSwap = 0;
  let blinkUntil = 0;
  let nextBlink = performance.now() + 3000;
  let celebrateUntil = 0;
  let dragging = false;
  let paused = false;
  let lastT = performance.now();
  let moveAcc = 0;
  let lastMoveSend = 0;
  let moveInFlight = false;
  let begUntil = 0;       // depleted-state "give me tokens" frantic crawl
  let nextBegFlip = 0;
  const BEG_SPEED = 64;
  let curAnim = "idle";   // resolved animation state, drives frame count & draw
  let microState = null;  // idle micro-animation: "yawn" | "stretch"
  let microUntil = 0;
  let nextMicro = performance.now() + 12000 + Math.random() * 15000;

  const PARAMS = {
    happy:    { anim: "walk",  frameMs: 280, speed: 26 },
    calm:     { anim: "auto",  frameMs: 550, speed: 18 },
    sleepy:   { anim: "idle",  frameMs: 900, speed: 0 },
    anxious:  { anim: "walk",  frameMs: 150, speed: 55 },
    overage:  { anim: "walk",  frameMs: 170, speed: 48 }, // plan dry, credits burning: still up, pacing
    depleted: { anim: "sleep", frameMs: 1100, speed: 0 },
    lost:     { anim: "sleep", frameMs: 1300, speed: 0 },
    unknown:  { anim: "auto",  frameMs: 550, speed: 18 }, // no data yet: stroll like calm
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

  let QUIPS = {
    happy: ["今天 bug 一定很少!", "额度满满, 冲鸭!", "陪你写代码~", "记得喝水哦"],
    calm: ["悠哉悠哉…", "代码和我, 你先看谁?", "嗯哼~ ♪", "伸个懒腰…"],
    sleepy: ["有点困了…", "额度有点紧张了哦", "省着点问 Claude 呀…"],
    anxious: ["额度快没啦!!", "💦 要不要歇一会?", "快到极限了…"],
    overage: ["在烧额外用量啦 💸", "钱包在冒烟…悠着点", "按量计费中, 省着点问"],
  };
  let COMBO = "别 rua 了别 rua 了!!";
  let RESET_LINE = "额度重置啦!! ✦";
  let BEG = "求求你🥺给点纯血 token 吧～";
  let MICRO_LINES = { yawn: "哈啊~ 有点困…", stretch: "唔~ 伸个懒腰!" };
  // custom pixel buddies (loved ones) have no per-character lines; use these
  let BUDDY_LINES = {
    click: ["陪你工作~", "加油加油!", "想我了吗?", "❤"],
    feed: ["谢谢~ 你也要好好吃饭!", "啊呜~ 一起补充能量!"],
  };
  let WEATHER_LINES = {
    rain: ["🌧 照这速度撑不到重置哦…", "省着点, 等会儿还要用呢"],
    storm: ["⛈ 慢点慢点! 这速度今晚要饿肚子", "额度在狂泻… 💦"],
  };
  let HARVEST_LINES = ["啊呜~ 自己种的最香!", "咔嚓咔嚓~ 新鲜!", "谢谢你照顾菜园 ❤"];
  let CONTEXT_LINES = {
    lateNight: ["凌晨了还在 vibe coding? 早点睡~", "夜深了, token 和你都该休息"],
    monday: ["周一快乐! 额度也是新的~"], friday: ["周五啦, 别把周额度留到周末烧"],
    weekend: ["周末也在写代码? 敬业!"], fableHeavy: ["Fable 烧得真香~ 钱包还好吗"],
    coworkHeavy: ["Cowork 用得挺勤快嘛"], codeHeavy: ["今天全泡在 Claude Code 里~"],
  };
  // what's going on right now (time of day / weekday / what's burning) → a
  // matching line pool, or null when nothing special is happening
  function contextPool() {
    const now = new Date();
    const h = now.getHours(), d = now.getDay();
    const c = [];
    if (h < 5) c.push("lateNight");
    if (d === 1 && h < 12) c.push("monday");
    if (d === 5 && h >= 15) c.push("friday");
    if (d === 0 || d === 6) c.push("weekend");
    const rows = usage && usage.breakdown && usage.breakdown.rows;
    if (rows) {
      const pct = (k) => ((rows.find((r) => r.key === k) || {}).pct || 0);
      if (pct("cowork") >= 40) c.push("coworkHeavy");
      if (pct("claude_code") >= 85) c.push("codeHeavy");
    }
    if (usage && usage.fable && usage.fable.pct >= 50) c.push("fableHeavy");
    const k = c[Math.floor(Math.random() * c.length)];
    return k && CONTEXT_LINES[k] && CONTEXT_LINES[k].length ? CONTEXT_LINES[k] : null;
  }

  // ------------------------------------------------------------- pet brain
  // shared, kept identical between the floating pet and the Dynamic Island
  const {
    computeMode, fmtCd, drawPet, frameCount, mergeCustomPets,
    renderOthers, renderScoped, renderExtra, renderBreakdown, renderTrend, renderGarden,
    setWeatherFx, renderReport, blockingWindow, lockedReason,
  } = window.PetCore;
  const sfx = (n) => { if (window.SFX) window.SFX.play(n); };

  function drawFrame(t) {
    const begging = t < begUntil;
    drawPet(ctx, character, curAnim, frameIdx, !begging && t < blinkUntil);
  }

  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const p = PARAMS[mode];
    const begging = t < begUntil;   // depleted: frantically crawl & beg for tokens

    // idle micro-animations: every so often the pet stops to yawn or stretch.
    // Sleepy pets yawn more; sleeping/lost pets are already lying down.
    const canMicro = !begging && !dragging &&
      mode !== "depleted" && mode !== "lost" && t >= celebrateUntil;
    if (canMicro && t > nextMicro) {
      microState = Math.random() < (mode === "sleepy" ? 0.72 : 0.42) ? "yawn" : "stretch";
      microUntil = t + 2800;
      nextMicro = t + 20000 + Math.random() * 30000;
      frameIdx = 0;
      const lines = MICRO_LINES[microState];
      if (lines && Math.random() < 0.35) sayTemp(lines, 2400);
      if (microState === "yawn" && mode === "sleepy") spawnFx("💤");
    }
    const microing = canMicro && t < microUntil && microState;
    if (!microing) microState = null;

    if (begging) {
      walkActive = true;
      if (t > nextBegFlip) { dir = Math.random() < 0.5 ? 1 : -1; nextBegFlip = t + 280 + Math.random() * 520; }
    } else if (microing) {
      walkActive = false;
    } else if (p.anim === "auto") {
      if (t > nextWalkDecision) {
        walkActive = Math.random() < 0.45;
        nextWalkDecision = t + 3500 + Math.random() * 3000;
      }
    } else {
      walkActive = p.anim === "walk";
    }
    if (paused && !begging) walkActive = false;

    curAnim = begging ? "walk"
      : microing ? microState
        : p.anim === "auto" || p.anim === "walk"
          ? (walkActive ? "walk" : "idle")
          : p.anim;

    // walking = move the whole window (frozen while a mini-game has resized it)
    const effSpeed = begging ? BEG_SPEED : p.speed;
    if (!dragging && walkActive && effSpeed > 0 && !window.__petGameActive) {
      moveAcc += dir * effSpeed * dt;
      if (t - lastMoveSend > 90 && Math.abs(moveAcc) >= 1 && !moveInFlight) {
        const dx = moveAcc;
        moveAcc = 0;
        lastMoveSend = t;
        moveInFlight = true;
        api.moveBy(dx).then((r) => {
          moveInFlight = false;
          if (r && r.atRight) dir = -1;
          if (r && r.atLeft) dir = 1;
        }).catch(() => { moveInFlight = false; });
      }
    }

    let jumpY = 0;
    if (t < celebrateUntil) jumpY = Math.abs(Math.sin(t / 85)) * 14;
    else if (begging) jumpY = Math.abs(Math.sin(t / 70)) * 5;   // frantic little hops
    wrap.style.bottom = 2 + jumpY + "px";
    canvas.classList.toggle("flip", dir < 0 && walkActive);

    const swapMs = begging ? 150 : microing ? 700 : p.frameMs;
    if (t - lastSwap > swapMs) {
      frameIdx = (frameIdx + 1) % frameCount(character, curAnim);
      lastSwap = t;
    }
    if (t > nextBlink) {
      blinkUntil = t + 160;
      nextBlink = t + 2200 + Math.random() * 3500;
    }
    drawFrame(t);
  }

  function rafLoop(t) {
    tick(t);
    requestAnimationFrame(rafLoop);
  }

  // ------------------------------------------------------------- hud
  function setBar(fill, pctEl, lineEl, win) {
    if (!win) {
      fill.style.width = "0%";
      pctEl.textContent = "--%";
      lineEl.textContent = "";
      return;
    }
    const pct = Math.round(win.pct);
    fill.style.width = Math.min(100, pct) + "%";
    fill.classList.toggle("warn", pct >= 70 && pct < 90);
    fill.classList.toggle("danger", pct >= 90);
    pctEl.textContent = pct + "%";
    const cd = fmtCd(win.resetsAt);
    lineEl.textContent = cd ? "↻ " + cd : "";
  }

  function refreshHud() {
    setBar(bar5, pct5, reset5, usage && usage.fiveHour);
    setBar(barw, pctw, resetw, usage && usage.week);
    // model-scoped weekly limits (Fable ✦ …), usage credits, where the week went
    renderScoped(scopedEl, usage);
    renderExtra(extraEl, usage);
    renderBreakdown(breakdownEl, usage);
    renderTrend(trendEl, usage);
    refreshGarden();
    refreshReport();
    refreshWeather();
    renderOthers(othersEl, usage && usage.others);
    nameEl.textContent = (SPRITES.names && SPRITES.names[character]) || character;

    msgEl.classList.add("hidden");
    if (errorCode === "no-credentials") {
      show(msgEl, t("err.noCreds"));
    } else if (errorCode === "auth") {
      show(msgEl, t("err.auth"));
    } else if (errorCode === "rate-limit") {
      show(msgEl, "🚦 " + (errorDetail || t("err.rate")));
    } else if (errorCode) {
      show(msgEl, t("err.fetch") + (errorDetail ? " · " + errorDetail.slice(0, 90) : ""));
    } else if (mode === "overage") {
      show(msgEl, t("msg.overage"));
    } else if (mode === "depleted" && usage) {
      const lock = lockedReason(usage);
      const win = blockingWindow(usage);
      const cd = win ? fmtCd(win.resetsAt) : null;
      if (lock) show(msgEl, t("msg.locked").replace("{reason}", lock));
      else show(msgEl, t("msg.depleted") + " " + (cd || "") + (usage.extra && usage.extra.enabled ? " · " + t("hud.extraCapped") : ""));
    }
  }
  function show(el, text) {
    el.textContent = text;
    el.classList.remove("hidden");
  }

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
    const r = wrap.getBoundingClientRect();
    fx.textContent = emoji;
    fx.style.left = r.left + r.width / 2 + (Math.random() * 24 - 12) + "px";
    fx.style.top = r.top + (Math.random() * 10 - 5) + "px";
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }


  // ------------------------------------------------------------- 🌱 garden
  let garden = null;
  let gardenOn = true;
  let lastHarvestAt = 0;
  const CROP_EMOJI = { carrot: "🥕", tomato: "🍅", sunflower: "🌻" };
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
    let n = 0;
    const tk = setInterval(() => { spawnFx(n % 2 ? "♥" : (CROP_EMOJI[crop] || "🌱")); if (++n > 4) clearInterval(tk); }, 220);
  }
  function refreshGarden() { renderGarden(gardenEl, gardenOn ? garden : null, onPlot); }
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
    if (reportOpen) renderReport(reportEl, usage && usage.report, usage && usage.lastReport);
  }
  document.getElementById("report").addEventListener("click", () => { reportOpen = !reportOpen; sfx("click"); refreshReport(); });
  // ⛈ live weather on the overlay canvas, driven by the forecast
  function refreshWeather() {
    const tr = usage && usage.trend;
    const wx = tr ? (tr.worst === "w" ? tr.week : tr.five) : null;
    setWeatherFx(wxEl, wx ? wx.weather : "unknown", () => sfx("thunder"));
  }
  api.onSfx((n) => sfx(n));

  function applyState() {
    const prev = mode;
    mode = computeMode(usage, errorCode);
    if (prev !== mode) {
      frameIdx = 0;
      refreshBubble();
    }
    refreshHud();
  }

  // ------------------------------------------------------------- click-through
  // transparent areas pass clicks to whatever is behind the pet
  let ignoring = null;
  document.addEventListener("mousemove", (e) => {
    if (dragging || window.__petGameActive) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const interactive = !!(el && el.closest("#pet-wrap, #hud, #bubble"));
    if (interactive === ignoring) {
      api.setIgnore(!interactive);
      ignoring = !interactive;
    }
  });
  // initialize as ignoring nothing until first mousemove
  api.setIgnore(false);
  ignoring = false;
  // let the games module restore a safe click-through state on exit (it bypasses
  // this tracker via api.setIgnore directly, which would otherwise desync)
  window.__petResetIgnore = () => { api.setIgnore(true); ignoring = true; };

  // ------------------------------------------------------------- hud hover
  let hudHide = null;
  function showHud() {
    clearTimeout(hudHide);
    hud.classList.remove("hidden");
  }
  function scheduleHideHud() {
    clearTimeout(hudHide);
    hudHide = setTimeout(() => hud.classList.add("hidden"), 1800);
  }
  wrap.addEventListener("mouseenter", showHud);
  wrap.addEventListener("mouseleave", scheduleHideHud);
  hud.addEventListener("mouseenter", showHud);
  hud.addEventListener("mouseleave", scheduleHideHud);

  // ------------------------------------------------------------- drag / click
  let downScreen = null;
  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.showMenu();
  });
  hud.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.showMenu();
  });
  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    wrap.classList.add("dragging");
    downScreen = { x: e.screenX, y: e.screenY };
    api.dragStart(e.clientX, e.clientY);
  });
  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove("dragging");
    api.dragEnd();
    const moved = downScreen &&
      Math.abs(e.screenX - downScreen.x) + Math.abs(e.screenY - downScreen.y) > 5;
    if (!moved) {
      if (e.detail >= 2) togglePause();
      else onPetClick();
    }
    downScreen = null;
  });

  // rapid-petting combo easter egg
  let comboCount = 0;
  let comboTimer = null;
  //额度用完时点一下 → 满地爬着求 token
  function startBeg() {
    begUntil = performance.now() + 4500;
    nextBegFlip = 0;
    sayTemp(BEG, 4200);
    spawnFx("🥺");
  }

  function onPetClick() {
    if (mode === "depleted" || mode === "lost") { startBeg(); return; }
    comboCount++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => (comboCount = 0), 2500);
    if (comboCount >= 5) {
      comboCount = 0;
      sayTemp(COMBO, 2200);
      celebrateUntil = performance.now() + 1200;
      let n = 0;
      const t = setInterval(() => {
        spawnFx("♥");
        if (++n > 7) clearInterval(t);
      }, 120);
      return;
    }
    const lines = CLICK_LINES[character] || BUDDY_LINES.click;
    sayTemp(lines[Math.floor(Math.random() * lines.length)]);
    spawnFx("♥");
  }

  function feedPet() {
    const lines = FEED_LINES[character] || BUDDY_LINES.feed;
    sayTemp(lines[Math.floor(Math.random() * lines.length)], 2200);
    celebrateUntil = performance.now() + 1100;
    let n = 0;
    const t = setInterval(() => {
      spawnFx(n === 0 ? "🍖" : "♥");
      if (++n > 3) clearInterval(t);
    }, 250);
  }

  // occasional self-talk
  let nextQuip = performance.now() + 45000;
  setInterval(() => {
    const t = performance.now();
    if (t < nextQuip || dragging || paused) return;
    if (mode === "depleted" || mode === "lost" || mode === "unknown") return;
    if (bubble.classList.contains("hidden")) {
      let pool = QUIPS[mode] || QUIPS.calm;
      // quota weather turning bad → the pet nags about the pace half the time
      const tr = usage && usage.trend;
      const wx = tr && (tr.worst === "w" ? tr.week : tr.five);
      if (wx && WEATHER_LINES[wx.weather] && Math.random() < 0.5) pool = WEATHER_LINES[wx.weather];
      else if (Math.random() < 0.45) { const cp = contextPool(); if (cp) pool = cp; }
      sayTemp(pool[Math.floor(Math.random() * pool.length)], 2800);
    }
    nextQuip = t + 70000 + Math.random() * 170000;
  }, 15000);

  function togglePause() {
    paused = !paused;
    sayTemp(paused ? t("pet.pause") : t("pet.resume"), 1600);
  }

  // ------------------------------------------------------------- buttons
  function switchCharacter(step) {
    const chars = charsNow();
    const i = (chars.indexOf(character) + step + chars.length) % chars.length;
    api.setCharacter(chars[i]); // main saves & broadcasts back
  }
  document.getElementById("prev").addEventListener("click", () => switchCharacter(-1));
  document.getElementById("next").addEventListener("click", () => switchCharacter(1));
  document.getElementById("menu").addEventListener("click", () => api.showMenu());
  document.getElementById("feed").addEventListener("click", feedPet);
  document.getElementById("refresh").addEventListener("click", () => {
    sayTemp(t("game.refresh"), 1200);
    api.refresh();
  });
  document.getElementById("quit").addEventListener("click", () => api.quit());
  document.getElementById("game").addEventListener("click", () => { if (window.PetGames) window.PetGames.open(); });

  // ------------------------------------------------------------- host events
  api.onUsage((d) => {
    usage = d; errorCode = null;
    // a freshly graded week → pop the card open and keep the HUD up a while
    const lr = d && d.lastReport;
    if (lr && lr.at && lr.at !== lastReportAt) {
      if (lastReportAt) { reportOpen = true; showHud(); clearTimeout(hudHide); hudHide = setTimeout(() => hud.classList.add("hidden"), 9000); }
      lastReportAt = lr.at;
    }
    applyState();
  });
  api.onError((d) => {
    errorCode = (d && d.code) || "fetch";
    errorDetail = (d && d.message) || "";
    applyState();
  });
  api.onCelebrate(() => {
    celebrateUntil = performance.now() + 2600;
    sayTemp(RESET_LINE, 2600);
    let n = 0;
    const tick = setInterval(() => {
      spawnFx(["✦", "★", "♥"][n % 3]);
      if (++n > 7) clearInterval(tick);
    }, 300);
  });
  api.onCharacter((c) => {
    if (charsNow().includes(c)) {
      character = c;
      window.__petCharacter = c;
      frameIdx = 0;
      refreshHud();
    }
  });
  api.onCustomPets((list) => {
    mergeCustomPets(list);
    if (!charsNow().includes(character)) { character = "cat"; frameIdx = 0; }
    refreshHud();
  });
  api.onPetSize((n) => {
    wrap.style.width = n + "px";
    wrap.style.height = n + "px";
  });
  api.onOpenGame((k) => { if (window.PetGames) window.PetGames.open(k); });
  api.onI18n((d) => {
    window.I18N = d.dict; window.__lang = d.lang;
    if (d.lines) {
      CLICK_LINES = d.lines.click; FEED_LINES = d.lines.feed; QUIPS = d.lines.quips;
      COMBO = d.lines.combo; BEG = d.lines.beg;
      if (d.lines.reset) RESET_LINE = d.lines.reset;
      if (d.lines.micro) MICRO_LINES = d.lines.micro;
      if (d.lines.buddy) BUDDY_LINES = d.lines.buddy;
      if (d.lines.weather) WEATHER_LINES = d.lines.weather;
      if (d.lines.harvest) HARVEST_LINES = d.lines.harvest;
      if (d.lines.context) CONTEXT_LINES = d.lines.context;
    }
    if (window.applyI18n) window.applyI18n();
    refreshHud(); refreshBubble();
  });
  api.onFeatures((f) => {
    const g = document.getElementById("game");
    if (g) g.style.display = (f && f.games) ? "" : "none";
    gardenOn = !(f && f.garden === false);
    if (window.SFX) window.SFX.setEnabled(!!(f && f.sound));
    refreshGarden();
  });

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

  refreshHud();
  refreshBubble();
  requestAnimationFrame(rafLoop);
  // watchdog: if rAF gets suspended (occluded/unfocused window), keep ticking
  setInterval(() => {
    const t = performance.now();
    if (t - lastT > 900) tick(t);
  }, 1000);
})();
