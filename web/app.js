/* Claude Pet — web / PWA edition. Same pixel pets as the desktop app, but the
   pet walks inside an on-screen stage instead of moving an OS window.
   Everything that isn't DOM glue comes from the shared modules generated from
   desktop/ (shared/*.js): the usage parser + mood (PetUsage), the history &
   forecast (PetHistory), the pixel garden with its crow (PetGarden), the
   weekly report card (PetReport), zh/en strings (PetStrings), sprites, the
   8-bit synth (SFX) and the HUD renderers (PetCore).
   Usage data comes from (in order): an OAuth token fetch (optionally via a
   CORS-friendly relay), manual percentages, or a lively demo. */
(function () {
  "use strict";

  // ------------------------------------------------------------- storage
  const LS = {
    token: "cp_token", proxy: "cp_proxy", five: "cp_five", week: "cp_week", fable: "cp_fable",
    char: "cp_char", lang: "cp_lang", sound: "cp_sound", notify: "cp_notify",
    history: "cp_history", garden: "cp_garden", weekGarden: "cp_weekgarden", lastReport: "cp_lastreport",
    paceAlarm: "cp_pacealarm", prev: "cp_prev", crowNotified: "cp_crownotified", lossNotified: "cp_lossnotified",
  };
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { if (v === null || v === "" || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
  const getJSON = (k, fb) => { try { const v = JSON.parse(get(k)); return v == null ? fb : v; } catch { return fb; } };
  const setJSON = (k, v) => set(k, JSON.stringify(v));

  // ------------------------------------------------------------- shared modules
  const STR = window.PetStrings, U = window.PetUsage, H = window.PetHistory, G = window.PetGarden, R = window.PetReport, SEASON = window.PetSeason;
  const {
    computeMode, fmtCd, drawPet, frameCount, blockingWindow, lockedReason,
    renderScoped, renderExtra, renderBreakdown, renderTrend, renderGarden, renderReport, setWeatherFx,
  } = window.PetCore;
  const sfx = (n) => { if (window.SFX) window.SFX.play(n); };

  // ------------------------------------------------------------- i18n (shared strings + a few web-only ones)
  const W = {
    zh: {
      demoTag: "演示模式",
      demoMode: "当前是演示数据。点 ⚙ 填入「手动 %」或 Token 看你的真实用量。",
      errAuth: "Token 已过期或无效 — 在设置里更新，或改用「手动 %」",
      errCors: "🚦 浏览器拦截了直连请求（CORS）。建议填「手动 %」，或在设置里配置中转地址。",
      errFetch: "获取失败 — ", updated: "已更新 · ", manual: "手动模式 · ",
      hint: "点 ⚙ 设置你的用量来源", install: "可「添加到主屏幕」像 App 一样用 →", cameIn: " 来啦~",
      "btn.feed": "🍖 投喂", "btn.pause": "⏸ 休息", "btn.refresh": "↻ 刷新",
      "set.title": "设置", "set.token": "Claude OAuth Token", "set.tokenSub": "（可选，自动获取实时用量）",
      "set.proxy": "代理 / 中转地址", "set.proxySub": "（可选，绕过浏览器 CORS）",
      "set.manual5": "手动 5H %", "set.manualW": "手动 周 %", "set.manualF": "手动 Fable ✦ %",
      "set.notify": "系统通知", "set.test": "测试自动获取", "set.clear": "清空", "set.save": "保存",
      "set.help": "手机浏览器直接调用 Anthropic 接口通常会被 CORS 拦截。最稳的方式是填「手动 %」让宠物反映你的状态；想自动获取就配一个中转地址（详见 README）。Token 只存在本机浏览器，不上传。",
      needToken: "请先填入 Token", testing: "请求中…", ok: "✅ 成功！", corsFail: "❌ 被 CORS 拦截。需要配置中转地址（见 README），或改用手动 %。",
      badToken: "❌ Token 无效或过期。", fail: "❌ 失败：", cleared: "已清空（点保存生效）", notifyDenied: "通知权限被拒绝，系统通知已关闭",
    },
    en: {
      demoTag: "demo",
      demoMode: "Demo data. Tap ⚙ to enter manual % or a token to see your real usage.",
      errAuth: "Token expired or invalid — update it in Settings, or use manual %",
      errCors: "🚦 The browser blocked the direct request (CORS). Use manual %, or set a relay URL in Settings.",
      errFetch: "Fetch failed — ", updated: "Updated · ", manual: "Manual · ",
      hint: "Tap ⚙ to set your usage source", install: "Add to Home Screen to use it like an app →", cameIn: " is here~",
      "btn.feed": "🍖 Feed", "btn.pause": "⏸ Rest", "btn.refresh": "↻ Refresh",
      "set.title": "Settings", "set.token": "Claude OAuth Token", "set.tokenSub": " (optional, fetches live usage)",
      "set.proxy": "Relay / proxy URL", "set.proxySub": " (optional, bypasses browser CORS)",
      "set.manual5": "Manual 5H %", "set.manualW": "Manual weekly %", "set.manualF": "Manual Fable ✦ %",
      "set.notify": "System notifications", "set.test": "Test fetch", "set.clear": "Clear", "set.save": "Save",
      "set.help": "Phone browsers usually get CORS-blocked when calling Anthropic directly. The most reliable option is manual %; for live data set up a small relay (see README). The token stays in this browser only.",
      needToken: "Enter a token first", testing: "Fetching…", ok: "✅ OK!", corsFail: "❌ Blocked by CORS. Set a relay URL (see README) or use manual %.",
      badToken: "❌ Invalid or expired token.", fail: "❌ Failed: ", cleared: "Cleared (save to apply)", notifyDenied: "Notification permission denied — system notifications stay off",
    },
  };
  let lang = "zh";
  let LINES = STR.lines.zh;
  const wt = (k) => (W[lang][k] != null ? W[lang][k] : W.zh[k] != null ? W.zh[k] : k);
  function resolveLang() {
    const l = get(LS.lang) || "system";
    if (l === "zh" || l === "en") return l;
    return String(navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  }
  function applyLang() {
    lang = resolveLang();
    window.__lang = lang;
    window.I18N = STR.pick(lang);
    window.t = (k) => (window.I18N[k] != null ? window.I18N[k] : k);
    LINES = STR.lines[lang] || STR.lines.zh;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = window.t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = window.t(el.getAttribute("data-i18n-title")); });
    document.querySelectorAll("[data-w]").forEach((el) => { el.textContent = wt(el.getAttribute("data-w")); });
    document.querySelectorAll("[data-w-title]").forEach((el) => { el.title = wt(el.getAttribute("data-w-title")); });
  }
  applyLang();
  const t = (k) => window.t(k);

  // ------------------------------------------------------------- dom
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const bubble = document.getElementById("bubble");
  const demoTag = document.getElementById("demo-tag");
  const nameEl = document.getElementById("pet-name");
  const msgEl = document.getElementById("msg");
  const panel = document.getElementById("panel");
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
  const footHint = document.getElementById("foot-hint");
  const toastEl = document.getElementById("toast");

  const charsNow = () => Object.keys(SPRITES.frames);
  let character = get(LS.char) || "cat";
  if (!charsNow().includes(character)) character = "cat";

  // ------------------------------------------------------------- state
  let usage = null;
  let demo = false;
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
  let petX = 0;
  let curAnim = "idle";
  let season = SEASON.currentSeason(new Date());   // 🎃 hat, fx, quips, seasonal crop
  let microState = null;
  let microUntil = 0;
  let nextMicro = performance.now() + 12000 + Math.random() * 15000;

  const PARAMS = {
    happy:    { anim: "walk",  frameMs: 280, speed: 26 },
    calm:     { anim: "auto",  frameMs: 550, speed: 18 },
    sleepy:   { anim: "idle",  frameMs: 900, speed: 0 },
    anxious:  { anim: "walk",  frameMs: 150, speed: 55 },
    overage:  { anim: "walk",  frameMs: 170, speed: 48 },
    depleted: { anim: "sleep", frameMs: 1100, speed: 0 },
    lost:     { anim: "sleep", frameMs: 1300, speed: 0 },
    unknown:  { anim: "auto",  frameMs: 550, speed: 18 },
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ------------------------------------------------------------- pet animation
  function pet() { return canvas.offsetWidth || 96; }
  function clampX() {
    const maxX = Math.max(4, stage.clientWidth - pet() - 4);
    if (petX < 4) petX = 4;
    if (petX > maxX) petX = maxX;
    canvas.style.left = petX + "px";
  }

  function tick(tNow) {
    const dt = Math.min(0.05, (tNow - lastT) / 1000);
    lastT = tNow;
    const p = PARAMS[mode] || PARAMS.unknown;

    // idle micro-animations: every so often the pet stops to yawn or stretch
    const canMicro = !dragging && mode !== "depleted" && mode !== "lost" && tNow >= celebrateUntil;
    if (canMicro && tNow > nextMicro) {
      microState = Math.random() < (mode === "sleepy" ? 0.72 : 0.42) ? "yawn" : "stretch";
      microUntil = tNow + 2800;
      nextMicro = tNow + 20000 + Math.random() * 30000;
      frameIdx = 0;
      const ml = LINES.micro && LINES.micro[microState];
      if (ml && Math.random() < 0.35) sayTemp(ml, 2400);
    }
    const microing = canMicro && tNow < microUntil && microState;
    if (!microing) microState = null;

    if (microing) walkActive = false;
    else if (p.anim === "auto") {
      if (tNow > nextWalkDecision) { walkActive = Math.random() < 0.45; nextWalkDecision = tNow + 3500 + Math.random() * 3000; }
    } else walkActive = p.anim === "walk";
    if (paused || dragging) walkActive = false;

    curAnim = microing ? microState : (p.anim === "auto" || p.anim === "walk") ? (walkActive ? "walk" : "idle") : p.anim;

    if (!dragging && walkActive && p.speed > 0) {
      const maxX = stage.clientWidth - pet() - 4;
      petX += dir * p.speed * dt;
      if (petX <= 4) { petX = 4; dir = 1; }
      if (petX >= maxX) { petX = maxX; dir = -1; }
      canvas.style.left = petX + "px";
    }

    let jumpY = 0;
    if (tNow < celebrateUntil) jumpY = Math.abs(Math.sin(tNow / 85)) * 14;
    let tf = "";
    if (dir < 0 && walkActive) tf += "scaleX(-1) ";
    if (jumpY) tf += `translateY(${-jumpY}px)`;
    canvas.style.transform = tf;
    if (!bubble.classList.contains("hidden")) bubble.style.left = (petX + pet() / 2) + "px";

    const swapMs = microing ? 700 : p.frameMs;
    if (tNow - lastSwap > swapMs) { frameIdx = (frameIdx + 1) % frameCount(character, curAnim); lastSwap = tNow; }
    if (tNow > nextBlink) { blinkUntil = tNow + 160; nextBlink = tNow + 2200 + Math.random() * 3500; }
    drawPet(ctx, character, curAnim, frameIdx, tNow < blinkUntil, season ? season.hat : null);
  }
  function rafLoop(tNow) { tick(tNow); requestAnimationFrame(rafLoop); }

  // ------------------------------------------------------------- bubble / fx / toast
  let bubbleTimer = null;
  function refreshBubble() {
    clearTimeout(bubbleTimer);
    if (mode === "depleted" || mode === "lost" || mode === "overage") {
      bubble.textContent = mode === "lost" ? "?" : mode === "overage" ? "💸" : t("bubble.zzz");
      bubble.classList.remove("hidden");
      bubble.style.left = (petX + pet() / 2) + "px";
    } else {
      bubble.classList.add("hidden");
    }
  }
  function sayTemp(text, ms) {
    bubble.textContent = text;
    bubble.classList.remove("hidden");
    bubble.style.left = (petX + pet() / 2) + "px";
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(refreshBubble, ms || 1600);
  }
  function spawnFx(emoji) {
    const fx = document.createElement("div");
    fx.className = "float-fx";
    fx.textContent = emoji;
    fx.style.left = (petX + pet() / 2 - 9 + (Math.random() * 20 - 10)) + "px";
    fx.style.bottom = (pet() + 18 + Math.random() * 8) + "px";
    stage.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }
  let toastTimer = null;
  // in-page toast + (opt-in) a system notification when the tab is hidden
  function notifyUser(body) {
    toastEl.textContent = body;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 5000);
    try {
      if (get(LS.notify) === "1" && "Notification" in window && Notification.permission === "granted" && document.hidden) {
        new Notification("Claude Pet", { body, icon: "icons/icon-192.png" });
      }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------- hud
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
  function show(el, text) { el.textContent = text; el.classList.remove("hidden"); }

  let reportOpen = false;
  let currentSamples = [];   // the series the open card is graded from (real history or the demo's)
  function refreshReport() {
    reportEl.classList.toggle("hidden", !reportOpen);
    panel.classList.toggle("report-mode", reportOpen);
    if (!reportOpen) return;
    // re-grade on open so a harvest / shoo made since the last poll shows up
    if (usage) usage.report = R.computeReport(currentSamples, weekGardenOpts(), Date.now());
    renderReport(reportEl, usage && usage.report, usage && usage.lastReport);
  }
  function refreshWeather() {
    const tr = usage && usage.trend;
    const wx = tr ? (tr.worst === "w" ? tr.week : tr.five) : null;
    setWeatherFx(wxEl, wx ? wx.weather : "unknown", () => { if (!document.hidden) sfx("thunder"); });
  }

  function refreshHud() {
    setBar(bar5, pct5, reset5, usage && usage.fiveHour);
    setBar(barw, pctw, resetw, usage && usage.week);
    renderScoped(scopedEl, usage);
    renderExtra(extraEl, usage);
    renderBreakdown(breakdownEl, usage);
    renderTrend(trendEl, usage);
    refreshGarden();
    refreshReport();
    refreshWeather();
    nameEl.textContent = ((SPRITES.names && SPRITES.names[character]) || character) + (season ? " " + season.fx[0] : "");
    demoTag.classList.toggle("hidden", !demo);

    msgEl.classList.add("hidden");
    if (errorCode === "auth") show(msgEl, wt("errAuth"));
    else if (errorCode === "cors") show(msgEl, wt("errCors"));
    else if (errorCode === "fetch") show(msgEl, wt("errFetch") + (errorDetail || ""));
    else if (mode === "overage") show(msgEl, t("msg.overage"));
    else if (mode === "depleted" && usage) {
      const lock = lockedReason(usage);
      const win = blockingWindow(usage);
      if (lock) show(msgEl, t("msg.locked").replace("{reason}", lock));
      else show(msgEl, t("msg.depleted") + " " + ((win && fmtCd(win.resetsAt)) || "") + (usage.extra && usage.extra.enabled ? " · " + t("hud.extraCapped") : ""));
    } else if (demo) show(msgEl, wt("demoMode"));
  }

  function applyState() {
    const prev = mode;
    mode = computeMode(usage, errorCode);
    if (prev !== mode) { frameIdx = 0; refreshBubble(); }
    refreshHud();
  }

  // ------------------------------------------------------------- 🌱 garden (the page plays "main process")
  let garden = G.sanitize(getJSON(LS.garden, null));
  const saveGarden = () => setJSON(LS.garden, garden);
  const CROP_EMOJI = { carrot: "🥕", tomato: "🍅", sunflower: "🌻", pumpkin: "🎃" };
  function gardenTick() {
    const now = Date.now();
    G.tick(garden, computeMode(usage, errorCode), now);
    // 🐦‍⬛ one toast per crow visit / per loss
    const ci = G.crowAt(garden);
    if (ci >= 0) {
      const since = garden.plots[ci].crow.since;
      if (Number(get(LS.crowNotified)) !== since) {
        set(LS.crowNotified, String(since));
        notifyUser(t("crow.notify").replace("{crop}", t("crop." + garden.plots[ci].crop)));
        sfx("crow");
      }
    }
    if (garden.lastLoss && Number(get(LS.lossNotified)) !== garden.lastLoss.at) {
      set(LS.lossNotified, String(garden.lastLoss.at));
      notifyUser(t("crow.lost").replace("{crop}", t("crop." + garden.lastLoss.crop)));
      spawnFx("🐦‍⬛");
    }
    saveGarden();
  }
  function celebrateHarvest(crop) {
    sfx("harvest");
    sayTemp(pick(LINES.harvest || ["♥"]), 2600);
    celebrateUntil = performance.now() + 1500;
    let n = 0;
    const tk = setInterval(() => { spawnFx(n % 2 ? "♥" : (CROP_EMOJI[crop] || "🌱")); if (++n > 4) clearInterval(tk); }, 220);
  }
  function onPlot(i, plot) {
    const now = Date.now();
    gardenTick();
    plot = garden.plots[i];
    if (plot && plot.crow) {
      if (G.shoo(garden, i, now)) { sfx("shoo"); sayTemp(t("garden.shooed"), 1800); spawnFx("🐦‍⬛"); spawnFx("💨"); }
    } else if (!plot) {
      if (G.plant(garden, i, null, now, season ? season.crop : null)) sfx("plant");
    } else if (plot.progress >= 1) {
      const crop = G.harvest(garden, i);
      if (crop) celebrateHarvest(crop);
    } else {
      sayTemp((plot.wilt >= 0.5 ? t("garden.thirsty") : t("garden.growing"))
        .replace("{crop}", t("crop." + plot.crop)).replace("{pct}", String(Math.round(plot.progress * 100))), 2000);
    }
    saveGarden();
    refreshGarden();
  }
  function refreshGarden() { renderGarden(gardenEl, garden, onPlot); }
  setInterval(() => { gardenTick(); refreshGarden(); }, 60 * 1000);

  // ------------------------------------------------------------- 📈 history · forecast · 📋 report · ⛈ alarms
  let history = Array.isArray(getJSON(LS.history, [])) ? getJSON(LS.history, []) : [];
  function weekGardenOpts() {
    let snap = getJSON(LS.weekGarden, null);
    if (!snap) { snap = { harvested: garden.harvested, lost: garden.lost, shooed: garden.shooed }; setJSON(LS.weekGarden, snap); }
    return {
      harvested: Math.max(0, garden.harvested - snap.harvested),
      lost: Math.max(0, garden.lost - snap.lost),
      shooed: Math.max(0, garden.shooed - snap.shooed),
      breakdown: usage && usage.breakdown ? usage.breakdown.rows : null,
    };
  }
  function decorate(u, samples) {
    const now = Date.now();
    currentSamples = samples;
    u.trend = H.trendOf(samples, u, now);
    u.report = R.computeReport(samples, weekGardenOpts(), now);
    u.lastReport = getJSON(LS.lastReport, null);
    return u;
  }
  // resets (celebrate + water), weekly grading, pace alarms — mirrors desktop/main.js
  function onFreshUsage(u, samples) {
    const prev = getJSON(LS.prev, {});
    const f = u.fiveHour ? u.fiveHour.pct : null, w = u.week ? u.week.pct : null;
    const wr = u.week ? u.week.resetsAt || null : null;
    if (prev.f != null && f !== null && prev.f >= 80 && f <= prev.f - 50) {
      celebrate(LINES.reset); sfx("reset"); notifyUser(t("celebrate.reset")); G.water(garden); saveGarden();
    }
    // a new weekly window (15-point drop or a new resets_at) → grade the old week
    const newWeek = (prev.w != null && w !== null && w < prev.w - 15) ||
      (prev.wr && wr && Date.parse(wr) - Date.parse(prev.wr) > 24 * 3600e3);
    let graded = false;
    if (newWeek) {
      const rep = R.computeReport(samples.slice(0, -1), weekGardenOpts(), Date.now());
      if (rep && rep.grade) {
        setJSON(LS.lastReport, { ...rep, at: Date.now() });
        notifyUser(t("report.notify").replace("{grade}", rep.grade).replace("{title}", t("title." + rep.title))
          .replace("{pct}", String(Math.round(rep.usedPct || 0))).replace("{n}", String(rep.depletions)));
        reportOpen = true;
        graded = true;
      }
      setJSON(LS.weekGarden, { harvested: garden.harvested, lost: garden.lost, shooed: garden.shooed });
    }
    if (prev.w != null && w !== null && prev.w >= 50 && w <= prev.w - 40) {
      celebrate(LINES.reset); sfx("reset");
      if (!graded) notifyUser(t("celebrate.weekReset"));
      G.water(garden); saveGarden();
    }
    setJSON(LS.prev, { f, w, wr: wr || prev.wr || null });
    // ⛈ pace alarm, once per window instance
    const tr = H.trendOf(samples, u, Date.now());
    const al = getJSON(LS.paceAlarm, {});
    for (const key of ["f", "w"]) {
      const o = key === "f" ? tr.five : tr.week;
      const win = key === "f" ? u.fiveHour : u.week;
      const id = win && win.resetsAt ? String(win.resetsAt) : null;
      if (!o || !id) continue;
      const bad = key === "f" ? o.weather === "storm" : (o.weather === "storm" || o.weather === "rain");
      const underway = key === "f" || win.pct >= 30;
      if (bad && underway && typeof o.etaMs === "number" && al[key] !== id) {
        al[key] = id;
        notifyUser(t(`trend.alarm.${key}`).replace("{eta}", window.PetCore.fmtEta(o.etaMs)).replace("{reset}", window.PetCore.fmtEta(o.resetMs)));
        sfx("warn");
      }
    }
    setJSON(LS.paceAlarm, al);
  }
  function celebrate(line) {
    celebrateUntil = performance.now() + 2600;
    sayTemp(line || "✦", 2600);
    let n = 0;
    const tk = setInterval(() => { spawnFx((season ? season.fx : ["✦", "★", "♥"])[n % 3]); if (++n > 7) clearInterval(tk); }, 300);
  }

  // ------------------------------------------------------------- interactions
  let comboCount = 0, comboTimer = null;
  function onPetClick() {
    comboCount++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => (comboCount = 0), 2500);
    if (comboCount >= 5) { comboCount = 0; sayTemp(LINES.combo, 2200); celebrateUntil = performance.now() + 1200; let n = 0; const tk = setInterval(() => { spawnFx("♥"); if (++n > 7) clearInterval(tk); }, 120); return; }
    const lines = (LINES.click && LINES.click[character]) || (LINES.buddy && LINES.buddy.click) || ["♥"];
    sayTemp(pick(lines));
    spawnFx("♥");
  }
  function feedPet() {
    const lines = (LINES.feed && LINES.feed[character]) || (LINES.buddy && LINES.buddy.feed) || ["♥"];
    sayTemp(pick(lines), 2200);
    celebrateUntil = performance.now() + 1100;
    let n = 0;
    const tk = setInterval(() => { spawnFx(n === 0 ? "🍖" : "♥"); if (++n > 3) clearInterval(tk); }, 250);
  }
  function togglePause() { paused = !paused; sayTemp(paused ? t("pet.pause") : t("pet.resume"), 1500); }

  let down = null;
  canvas.addEventListener("pointerdown", (e) => { dragging = true; down = { x: e.clientX, sx: petX, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (!dragging || !down) return; const dx = e.clientX - down.x; if (Math.abs(dx) > 4) down.moved = true; petX = down.sx + dx; clampX(); });
  canvas.addEventListener("pointerup", () => { if (down && !down.moved) onPetClick(); dragging = false; down = null; });
  canvas.addEventListener("pointercancel", () => { dragging = false; down = null; });

  // occasional self-talk: mood quips, weather nags, context lines
  function contextPool() {
    const now = new Date(), h = now.getHours(), d = now.getDay();
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
    return k && LINES.context && LINES.context[k] && LINES.context[k].length ? LINES.context[k] : null;
  }
  let nextQuip = performance.now() + 30000;
  setInterval(() => {
    const tNow = performance.now();
    if (tNow < nextQuip || dragging || paused) return;
    if (mode === "depleted" || mode === "lost" || mode === "unknown") return;
    if (bubble.classList.contains("hidden")) {
      let pool = (LINES.quips && LINES.quips[mode]) || (LINES.quips && LINES.quips.calm) || ["♪"];
      const tr = usage && usage.trend;
      const wx = tr && (tr.worst === "w" ? tr.week : tr.five);
      if (wx && LINES.weather && LINES.weather[wx.weather] && Math.random() < 0.5) pool = LINES.weather[wx.weather];
      else if (season && LINES.season && LINES.season[season.id] && Math.random() < 0.35) pool = LINES.season[season.id];
      else if (Math.random() < 0.45) { const cp = contextPool(); if (cp) pool = cp; }
      sayTemp(pick(pool), 2800);
    }
    nextQuip = tNow + 60000 + Math.random() * 120000;
  }, 12000);

  function switchCharacter(step) {
    const chars = charsNow();
    character = chars[(chars.indexOf(character) + step + chars.length) % chars.length];
    set(LS.char, character);
    frameIdx = 0;
    refreshHud();
    sayTemp((SPRITES.names[character] || character) + wt("cameIn"), 1400);
  }
  document.getElementById("prev").onclick = () => switchCharacter(-1);
  document.getElementById("next").onclick = () => switchCharacter(1);
  document.getElementById("feed").onclick = feedPet;
  document.getElementById("pause").onclick = togglePause;
  document.getElementById("refresh").onclick = () => { sayTemp(t("game.refresh"), 1000); refresh(true); };
  document.getElementById("report").onclick = () => { reportOpen = !reportOpen; sfx("click"); refreshReport(); };
  // mobile browsers need a gesture before audio can start — resume on the first tap
  document.addEventListener("pointerdown", () => { if (window.SFX) window.SFX.setEnabled(get(LS.sound) === "1"); }, { once: true });

  // ------------------------------------------------------------- data
  const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
  async function fetchUsage(token, proxy) {
    const url = (proxy && proxy.trim()) || ENDPOINT;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" },
    });
    if (!res.ok) { const e = new Error("HTTP " + res.status); e.status = res.status; throw e; }
    return U.normalize(await res.json());
  }
  function manualUsage(m5, mw, mf) {
    const w = (v) => (v === null || v === "" || !isFinite(+v) ? null : { pct: Math.max(0, Math.min(100, +v)), resetsAt: null });
    const fable = w(mf) ? { ...w(mf), key: "fable", label: "Fable", sharePct: null } : null;
    return { fiveHour: w(m5), week: w(mw), scoped: fable ? [fable] : [], fable, extra: null, breakdown: null };
  }
  // a lively demo: a 2-day history with resets, a Fable window and a breakdown
  let demoHistory = null;
  function demoData() {
    const now = Date.now(), H1 = 3600e3;
    if (!demoHistory) {
      demoHistory = [];
      for (let i = 0; i < 576; i++) {
        const tt = now - (576 - i) * 5 * 60e3, hrs = (576 - i) * 5 / 60;
        const f = hrs <= 1.5 ? 32 - hrs * 20 : 100 - ((hrs * 23) % 100);
        const w = Math.max(3, 48 - hrs * 0.9);
        demoHistory.push({ t: tt, f: Math.round(Math.max(0, Math.min(100, f)) * 10) / 10, w: Math.round(w * 10) / 10 });
      }
    }
    const fable = { pct: 12, resetsAt: new Date(now + 3 * 86400e3).toISOString(), key: "fable", label: "Fable", sharePct: 50 };
    const u = {
      fiveHour: { pct: 32, resetsAt: new Date(now + 2 * H1).toISOString() },
      week: { pct: 48, resetsAt: new Date(now + 4 * 86400e3).toISOString() },
      scoped: [fable], fable, extra: null,
      breakdown: { rows: [{ key: "claude_code", label: "Claude Code", pct: 79 }, { key: "cowork", label: "Cowork", pct: 19 }, { key: "chat", label: "Chats", pct: 2 }] },
    };
    return decorate(u, demoHistory);
  }

  function setFoot(s) { footHint.textContent = s || ""; }
  const nowStr = () => new Date().toLocaleTimeString(lang === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });

  // 🎃 one greeting per season and year
  function maybeGreetSeason() {
    season = SEASON.currentSeason(new Date());
    const key = SEASON.seasonKey(season);
    if (!key || get("cp_seasongreeted") === key) return;
    set("cp_seasongreeted", key);
    notifyUser(t("season." + season.id));
    sfx("level");
  }

  async function refresh() {
    maybeGreetSeason();
    const token = (get(LS.token) || "").trim();
    const proxy = (get(LS.proxy) || "").trim();
    const m5 = get(LS.five), mw = get(LS.week), mf = get(LS.fable);

    if (token) {
      try {
        const u = await fetchUsage(token, proxy);
        const now = Date.now();
        history = H.pushSample(history, { t: now, f: u.fiveHour ? u.fiveHour.pct : null, w: u.week ? u.week.pct : null }, now);
        setJSON(LS.history, history);
        usage = decorate(u, history);
        demo = false; errorCode = null; errorDetail = "";
        onFreshUsage(u, history);
        gardenTick();
        setFoot(wt("updated") + nowStr());
        applyState();
        return;
      } catch (e) {
        if (e && e.status === 401) errorCode = "auth";
        else if (e instanceof TypeError) errorCode = "cors";
        else { errorCode = "fetch"; errorDetail = String((e && e.message) || e); }
        // fall through to manual / demo so the pet still has something to show
      }
    }
    if (m5 !== null || mw !== null || mf !== null) {
      usage = decorate(manualUsage(m5, mw, mf), history); demo = false;
      if (!token) errorCode = null;
      gardenTick();
      applyState();
      setFoot(wt("manual") + nowStr());
      return;
    }
    usage = demoData(); demo = true;
    if (!token) errorCode = null;
    gardenTick();
    applyState();
  }

  // ------------------------------------------------------------- settings ui
  const overlay = document.getElementById("overlay");
  const fToken = document.getElementById("f-token");
  const fProxy = document.getElementById("f-proxy");
  const fFive = document.getElementById("f-five");
  const fWeek = document.getElementById("f-week");
  const fFable = document.getElementById("f-fable");
  const fLang = document.getElementById("f-lang");
  const fSound = document.getElementById("f-sound");
  const fNotify = document.getElementById("f-notify");
  const sStatus = document.getElementById("settings-status");

  function openSettings() {
    fToken.value = get(LS.token) || "";
    fProxy.value = get(LS.proxy) || "";
    fFive.value = get(LS.five) || "";
    fWeek.value = get(LS.week) || "";
    fFable.value = get(LS.fable) || "";
    fLang.value = get(LS.lang) || "system";
    fSound.checked = get(LS.sound) === "1";
    fNotify.checked = get(LS.notify) === "1";
    sStatus.textContent = "";
    overlay.classList.remove("hidden");
  }
  function closeSettings() { overlay.classList.add("hidden"); }
  document.getElementById("gear").onclick = openSettings;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });

  document.getElementById("s-save").onclick = async () => {
    set(LS.token, fToken.value.trim());
    set(LS.proxy, fProxy.value.trim());
    set(LS.five, fFive.value.trim());
    set(LS.week, fWeek.value.trim());
    set(LS.fable, fFable.value.trim());
    set(LS.lang, fLang.value === "system" ? "" : fLang.value);
    set(LS.sound, fSound.checked ? "1" : "");
    if (window.SFX) window.SFX.setEnabled(fSound.checked);
    if (fNotify.checked && "Notification" in window && Notification.permission !== "granted") {
      try { await Notification.requestPermission(); } catch { /* ignore */ }
      if (Notification.permission !== "granted") { fNotify.checked = false; notifyUser(wt("notifyDenied")); }
    }
    set(LS.notify, fNotify.checked ? "1" : "");
    applyLang();
    closeSettings();
    refresh();
  };
  document.getElementById("s-clear").onclick = () => {
    fToken.value = fProxy.value = fFive.value = fWeek.value = fFable.value = "";
    sStatus.textContent = wt("cleared");
  };
  document.getElementById("s-test").onclick = async () => {
    const token = fToken.value.trim();
    if (!token) { sStatus.textContent = wt("needToken"); return; }
    sStatus.textContent = wt("testing");
    try {
      const u = await fetchUsage(token, fProxy.value.trim());
      const f = u.fiveHour ? Math.round(u.fiveHour.pct) + "%" : "—";
      const w = u.week ? Math.round(u.week.pct) + "%" : "—";
      const sc = (u.scoped || []).map((s) => ` · ${s.label} ${Math.round(s.pct)}%`).join("");
      sStatus.textContent = `${wt("ok")} 5h ${f} · ${t("hud.week")} ${w}${sc}`;
    } catch (e) {
      if (e instanceof TypeError) sStatus.textContent = wt("corsFail");
      else if (e && e.status === 401) sStatus.textContent = wt("badToken");
      else sStatus.textContent = wt("fail") + ((e && e.message) || e);
    }
  };

  // ------------------------------------------------------------- boot
  function onResize() { clampX(); }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
  function placePet() { petX = Math.max(4, (stage.clientWidth - pet()) / 2); canvas.style.left = petX + "px"; }

  // live countdowns, flapping crow, trend redraw every second
  setInterval(() => {
    if (usage) { setBar(bar5, pct5, reset5, usage.fiveHour); setBar(barw, pctw, resetw, usage.week); renderScoped(scopedEl, usage); renderExtra(extraEl, usage); }
    if (garden.plots.some((p) => p && p.crow)) refreshGarden();
  }, 1000);
  setInterval(() => { if ((get(LS.token) || "").trim()) refresh(); }, 5 * 60 * 1000);
  if (window.SFX) window.SFX.setEnabled(get(LS.sound) === "1");

  placePet();
  refreshHud();
  refreshBubble();
  refresh();
  requestAnimationFrame(rafLoop);
  if (!(get(LS.token) || get(LS.five) || get(LS.week) || get(LS.fable))) setFoot(wt("hint"));

  // ------------------------------------------------------------- pwa
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); setFoot(wt("install")); });
})();
