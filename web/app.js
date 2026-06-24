/* Claude Pet — web / PWA edition. Same pixel pets as the desktop app, but
   the pet walks inside an on-screen stage instead of moving an OS window.
   Usage data comes from (in order): an OAuth token fetch (optionally via a
   CORS-friendly proxy), manual percentages, or a gentle demo. */
(function () {
  "use strict";

  // ------------------------------------------------------------- storage
  const LS = {
    token: "cp_token", proxy: "cp_proxy",
    five: "cp_five", week: "cp_week", char: "cp_char",
  };
  const get = (k) => localStorage.getItem(k);
  const set = (k, v) => (v === null || v === "" ? localStorage.removeItem(k) : localStorage.setItem(k, v));

  const CHARS = Object.keys(SPRITES.frames);
  let character = get(LS.char) || "cat";
  if (!CHARS.includes(character)) character = "cat";

  // ------------------------------------------------------------- dom
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("pet");
  const ctx = canvas.getContext("2d");
  const bubble = document.getElementById("bubble");
  const demoTag = document.getElementById("demo-tag");
  const nameEl = document.getElementById("pet-name");
  const msgEl = document.getElementById("msg");
  const bar5 = document.getElementById("bar5");
  const barw = document.getElementById("barw");
  const pct5 = document.getElementById("pct5");
  const pctw = document.getElementById("pctw");
  const reset5 = document.getElementById("reset5");
  const resetw = document.getElementById("resetw");
  const footHint = document.getElementById("foot-hint");

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

  const PARAMS = {
    happy:    { anim: "walk",  frameMs: 280, speed: 26 },
    calm:     { anim: "auto",  frameMs: 550, speed: 18 },
    sleepy:   { anim: "idle",  frameMs: 900, speed: 0 },
    anxious:  { anim: "walk",  frameMs: 150, speed: 55 },
    depleted: { anim: "sleep", frameMs: 1100, speed: 0 },
    lost:     { anim: "sleep", frameMs: 1300, speed: 0 },
    unknown:  { anim: "auto",  frameMs: 550, speed: 18 },
  };

  const CLICK_LINES = {
    cat: ["喵~", "(=^･ω･^=)", "呼噜呼噜…", "摸摸!"],
    dog: ["汪!", "尾巴摇摇~", "(´･ᴥ･`)", "一起加油!"],
    bear: ["吼~", "抱抱!", "ʕ•ᴥ•ʔ", "蜂蜜呢?"],
    rabbit: ["蹦蹦~", "(•ㅅ•)", "耳朵不要拉啦!", "一起蹦跶!"],
    fox: ["嗷呜~", "(◡ ω ◡)", "尾巴毛茸茸的!", "嘿嘿~"],
    penguin: ["企~", "ʕ•ᴥ•ʔ 摇摇摆", "滑一个!", "(°ㅂ°)"],
    star: ["✦ 闪!", "我是小克~", "充能中…", "(★ω★)"],
  };
  const FEED_LINES = {
    cat: ["啊呜啊呜~ 小鱼干!", "喵呜~ 好吃!"],
    dog: ["啊呜! 肉骨头!", "汪汪! 谢谢投喂!"],
    bear: ["啊呜~ 是蜂蜜味的!", "吧唧吧唧…"],
    rabbit: ["咔哧咔哧~ 胡萝卜!", "嫩嫩的菜叶子!"],
    fox: ["啊呜! 这是给我的?", "嗷呜~ 真香!"],
    penguin: ["啊呜~ 小鱼!", "新鲜的鱼鱼!"],
    star: ["✦ 吸收能量中…", "嗯! 满电啦!"],
  };
  const QUIPS = {
    happy: ["今天 bug 一定很少!", "额度满满, 冲鸭!", "陪你写代码~", "记得喝水哦"],
    calm: ["悠哉悠哉…", "嗯哼~ ♪", "伸个懒腰…", "今天也要加油"],
    sleepy: ["有点困了…", "额度有点紧张了哦", "省着点问 Claude 呀…"],
    anxious: ["额度快没啦!!", "💦 要不要歇一会?", "快到极限了…"],
  };

  // ------------------------------------------------------------- pet brain
  function computeMode() {
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

  function drawFrame(t) {
    const pal = SPRITES.palettes[character];
    const p = PARAMS[mode];
    const animState =
      p.anim === "auto" || p.anim === "walk"
        ? (walkActive ? "walk" : "idle")
        : p.anim;
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
    if (animState !== "sleep" && t < blinkUntil) {
      const dy = animState === "idle" && fi === 1 ? 1 : 0;
      ctx.fillStyle = pal.d;
      for (const [ex, ey] of SPRITES.eyes[character]) {
        ctx.fillRect(ex, ey + dy, 1, 1);
      }
    }
  }

  function pet() { return canvas.offsetWidth || 96; }
  function clampX() {
    const maxX = Math.max(4, stage.clientWidth - pet() - 4);
    if (petX < 4) petX = 4;
    if (petX > maxX) petX = maxX;
    canvas.style.left = petX + "px";
  }

  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const p = PARAMS[mode];

    if (p.anim === "auto") {
      if (t > nextWalkDecision) {
        walkActive = Math.random() < 0.45;
        nextWalkDecision = t + 3500 + Math.random() * 3000;
      }
    } else {
      walkActive = p.anim === "walk";
    }
    if (paused || dragging) walkActive = false;

    if (!dragging && walkActive && p.speed > 0) {
      const petW = pet();
      const maxX = stage.clientWidth - petW - 4;
      petX += dir * p.speed * dt;
      if (petX <= 4) { petX = 4; dir = 1; }
      if (petX >= maxX) { petX = maxX; dir = -1; }
      canvas.style.left = petX + "px";
    }

    let jumpY = 0;
    if (t < celebrateUntil) jumpY = Math.abs(Math.sin(t / 85)) * 14;
    let tf = "";
    if (dir < 0 && walkActive) tf += "scaleX(-1) ";
    if (jumpY) tf += `translateY(${-jumpY}px)`;
    canvas.style.transform = tf;

    if (!bubble.classList.contains("hidden")) {
      bubble.style.left = (petX + pet() / 2) + "px";
    }

    if (t - lastSwap > p.frameMs) {
      frameIdx = (frameIdx + 1) % 2;
      lastSwap = t;
    }
    if (t > nextBlink) {
      blinkUntil = t + 160;
      nextBlink = t + 2200 + Math.random() * 3500;
    }
    drawFrame(t);
  }

  function rafLoop(t) { tick(t); requestAnimationFrame(rafLoop); }

  // ------------------------------------------------------------- hud
  function fmtCd(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return null;
    if (ms <= 0) return "即将重置…";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const local = new Date(iso).toLocaleString("zh-CN", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const cd = h >= 24 ? `${Math.floor(h / 24)} 天 ${h % 24} 小时`
             : h > 0 ? `${h} 小时 ${String(m).padStart(2, "0")} 分`
             : `${m} 分钟`;
    return `${cd}后重置 · ${local}`;
  }

  function setBar(fill, pctEl, lineEl, win) {
    if (!win) {
      fill.style.width = "0%"; pctEl.textContent = "--%"; lineEl.textContent = "";
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
    nameEl.textContent = (SPRITES.names && SPRITES.names[character]) || character;
    demoTag.classList.toggle("hidden", !demo);

    msgEl.classList.add("hidden");
    if (errorCode === "auth") {
      show(msgEl, "Token 已过期或无效 — 在设置里更新，或改用「手动 %」");
    } else if (errorCode === "cors") {
      show(msgEl, "🚦 浏览器拦截了直连请求（CORS）。建议填「手动 %」，或在设置里配置中转地址。");
    } else if (errorCode === "fetch") {
      show(msgEl, "获取失败 — " + (errorDetail || "稍后再试") );
    } else if (mode === "depleted" && usage && usage.fiveHour) {
      show(msgEl, "额度用完啦 💤 " + (fmtCd(usage.fiveHour.resetsAt) || ""));
    } else if (demo) {
      show(msgEl, "当前是演示数据。点 ⚙ 填入「手动 %」或 Token 看你的真实用量。");
    }
  }
  function show(el, text) { el.textContent = text; el.classList.remove("hidden"); }

  let bubbleTimer = null;
  function refreshBubble() {
    clearTimeout(bubbleTimer);
    if (mode === "depleted" || mode === "lost") {
      bubble.textContent = mode === "lost" ? "?" : "Zzz…";
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

  function applyState() {
    const prev = mode;
    mode = computeMode();
    if (prev !== mode) { frameIdx = 0; refreshBubble(); }
    refreshHud();
  }

  // ------------------------------------------------------------- interactions
  function onPetClick() {
    const lines = CLICK_LINES[character] || ["♥"];
    sayTemp(lines[Math.floor(Math.random() * lines.length)]);
    spawnFx("♥");
  }
  function feedPet() {
    const lines = FEED_LINES[character] || ["啊呜~"];
    sayTemp(lines[Math.floor(Math.random() * lines.length)], 2200);
    celebrateUntil = performance.now() + 1100;
    let n = 0;
    const t = setInterval(() => { spawnFx(n === 0 ? "🍖" : "♥"); if (++n > 3) clearInterval(t); }, 250);
  }
  function togglePause() {
    paused = !paused;
    sayTemp(paused ? "⏸ 原地休息~" : "▶ 继续散步!", 1500);
  }

  // pointer drag / tap on the pet
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    down = { x: e.clientX, sx: petX, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging || !down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 4) down.moved = true;
    petX = down.sx + dx;
    clampX();
  });
  canvas.addEventListener("pointerup", () => {
    if (down && !down.moved) onPetClick();
    dragging = false; down = null;
  });
  canvas.addEventListener("pointercancel", () => { dragging = false; down = null; });

  // occasional self-talk
  let nextQuip = performance.now() + 30000;
  setInterval(() => {
    const t = performance.now();
    if (t < nextQuip || dragging || paused) return;
    if (mode === "depleted" || mode === "lost" || mode === "unknown") return;
    if (bubble.classList.contains("hidden")) {
      const pool = QUIPS[mode] || QUIPS.calm;
      sayTemp(pool[Math.floor(Math.random() * pool.length)], 2800);
    }
    nextQuip = t + 60000 + Math.random() * 120000;
  }, 12000);

  // ------------------------------------------------------------- buttons
  function switchCharacter(step) {
    const i = (CHARS.indexOf(character) + step + CHARS.length) % CHARS.length;
    character = CHARS[i];
    set(LS.char, character);
    frameIdx = 0;
    refreshHud();
    sayTemp((SPRITES.names[character] || character) + " 来啦~", 1400);
  }
  document.getElementById("prev").onclick = () => switchCharacter(-1);
  document.getElementById("next").onclick = () => switchCharacter(1);
  document.getElementById("feed").onclick = feedPet;
  document.getElementById("pause").onclick = togglePause;
  document.getElementById("refresh").onclick = () => { sayTemp("刷新中…", 1000); refresh(true); };

  // ------------------------------------------------------------- data
  const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";

  function pctOf(v) {
    if (typeof v !== "number" || !isFinite(v)) return null;
    const pct = v > 0 && v < 1 ? v * 100 : v;
    return Math.max(0, Math.min(100, pct));
  }
  function pickWindow(obj) {
    if (!obj || typeof obj !== "object") return null;
    const pct = pctOf(obj.utilization ?? obj.used_percent ?? obj.percent);
    let resetsAt = obj.resets_at ?? obj.resetsAt ?? obj.reset_at ?? null;
    if (typeof resetsAt === "number") {
      resetsAt = new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt).toISOString();
    }
    if (pct === null && !resetsAt) return null;
    return { pct: pct ?? 0, resetsAt };
  }
  function normalize(raw) {
    const out = { fiveHour: null, week: null };
    if (raw && typeof raw === "object") {
      out.fiveHour = pickWindow(raw.five_hour ?? raw.fiveHour ?? raw.session);
      out.week = pickWindow(raw.seven_day ?? raw.sevenDay ?? raw.weekly);
      if (!out.fiveHour && !out.week) {
        const nest = raw.usage || raw.limits || raw.data;
        if (nest && typeof nest === "object" && !Array.isArray(nest)) {
          out.fiveHour = pickWindow(nest.five_hour ?? nest.session);
          out.week = pickWindow(nest.seven_day ?? nest.weekly);
        }
      }
    }
    return out;
  }

  async function fetchUsage(token, proxy) {
    const url = (proxy && proxy.trim()) || ENDPOINT;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const e = new Error("HTTP " + res.status);
      e.status = res.status;
      throw e;
    }
    return normalize(await res.json());
  }

  function manualUsage(m5, mw) {
    const w = (v) => (v === null || v === "" ? null : { pct: Math.max(0, Math.min(100, +v)), resetsAt: null });
    return { fiveHour: w(m5), week: w(mw) };
  }
  function demoUsage() {
    return {
      fiveHour: { pct: 32, resetsAt: new Date(Date.now() + 2 * 3600e3).toISOString() },
      week: { pct: 48, resetsAt: new Date(Date.now() + 4 * 86400e3).toISOString() },
    };
  }

  function setFoot(t) { footHint.textContent = t || ""; }
  function nowStr() {
    return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }

  async function refresh() {
    const token = (get(LS.token) || "").trim();
    const proxy = (get(LS.proxy) || "").trim();
    const m5 = get(LS.five);
    const mw = get(LS.week);

    if (token) {
      try {
        usage = await fetchUsage(token, proxy);
        demo = false; errorCode = null; errorDetail = "";
        setFoot("已更新 · " + nowStr());
        applyState();
        return;
      } catch (e) {
        if (e && e.status === 401) { errorCode = "auth"; }
        else if (e instanceof TypeError) { errorCode = "cors"; }
        else { errorCode = "fetch"; errorDetail = String((e && e.message) || e); }
        // fall through to manual / demo so the pet still has something to show
      }
    }

    if (m5 !== null || mw !== null) {
      usage = manualUsage(m5, mw); demo = false;
      if (!token) errorCode = null;
      applyState();
      setFoot("手动模式 · " + nowStr());
      return;
    }

    usage = demoUsage(); demo = true;
    if (!token) { errorCode = null; }
    applyState();
  }

  // ------------------------------------------------------------- settings ui
  const overlay = document.getElementById("overlay");
  const fToken = document.getElementById("f-token");
  const fProxy = document.getElementById("f-proxy");
  const fFive = document.getElementById("f-five");
  const fWeek = document.getElementById("f-week");
  const sStatus = document.getElementById("settings-status");

  function openSettings() {
    fToken.value = get(LS.token) || "";
    fProxy.value = get(LS.proxy) || "";
    fFive.value = get(LS.five) || "";
    fWeek.value = get(LS.week) || "";
    sStatus.textContent = "";
    overlay.classList.remove("hidden");
  }
  function closeSettings() { overlay.classList.add("hidden"); }

  document.getElementById("gear").onclick = openSettings;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });

  document.getElementById("s-save").onclick = () => {
    set(LS.token, fToken.value.trim());
    set(LS.proxy, fProxy.value.trim());
    set(LS.five, fFive.value.trim());
    set(LS.week, fWeek.value.trim());
    closeSettings();
    refresh();
  };
  document.getElementById("s-clear").onclick = () => {
    fToken.value = fProxy.value = fFive.value = fWeek.value = "";
    sStatus.textContent = "已清空（点保存生效）";
  };
  document.getElementById("s-test").onclick = async () => {
    const token = fToken.value.trim();
    if (!token) { sStatus.textContent = "请先填入 Token"; return; }
    sStatus.textContent = "请求中…";
    try {
      const u = await fetchUsage(token, fProxy.value.trim());
      const f = u.fiveHour ? Math.round(u.fiveHour.pct) + "%" : "—";
      const w = u.week ? Math.round(u.week.pct) + "%" : "—";
      sStatus.textContent = `✅ 成功！5h ${f} · 周 ${w}`;
    } catch (e) {
      if (e instanceof TypeError) sStatus.textContent = "❌ 被 CORS 拦截。需要配置中转地址（见 README），或改用手动 %。";
      else if (e && e.status === 401) sStatus.textContent = "❌ Token 无效或过期。";
      else sStatus.textContent = "❌ 失败：" + ((e && e.message) || e);
    }
  };

  // ------------------------------------------------------------- boot
  function onResize() { clampX(); }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));

  // place pet in the centre once layout is known
  function placePet() {
    const petW = pet();
    petX = Math.max(4, (stage.clientWidth - petW) / 2);
    canvas.style.left = petX + "px";
  }

  // periodic live tick for countdowns; refetch every 5 min when a token is set
  setInterval(() => {
    if (usage) {
      setBar(bar5, pct5, reset5, usage.fiveHour);
      setBar(barw, pctw, resetw, usage.week);
    }
  }, 1000);
  setInterval(() => { if ((get(LS.token) || "").trim()) refresh(); }, 5 * 60 * 1000);

  placePet();
  refreshHud();
  refreshBubble();
  refresh();
  requestAnimationFrame(rafLoop);
  // first-load helper text
  if (!(get(LS.token) || get(LS.five) || get(LS.week))) {
    setFoot("点 ⚙ 设置你的用量来源");
  }

  // ------------------------------------------------------------- pwa
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
  // android install hint
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setFoot("可「添加到主屏幕」像 App 一样用 →");
  });
})();
