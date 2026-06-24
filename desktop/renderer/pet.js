/* Claude Pet — floating desktop renderer. The pet stays centered in its
   small transparent window; "walking" moves the whole window across the
   screen via IPC. Transparent areas are click-through. */
(function () {
  "use strict";
  const api = window.petAPI;

  const CHARS = Object.keys(SPRITES.frames);
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

  const PARAMS = {
    happy:    { anim: "walk",  frameMs: 280, speed: 26 },
    calm:     { anim: "auto",  frameMs: 550, speed: 18 },
    sleepy:   { anim: "idle",  frameMs: 900, speed: 0 },
    anxious:  { anim: "walk",  frameMs: 150, speed: 55 },
    depleted: { anim: "sleep", frameMs: 1100, speed: 0 },
    lost:     { anim: "sleep", frameMs: 1300, speed: 0 },
    unknown:  { anim: "auto",  frameMs: 550, speed: 18 }, // no data yet: stroll like calm
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
    calm: ["悠哉悠哉…", "代码和我, 你先看谁?", "嗯哼~ ♪", "伸个懒腰…"],
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
    if (paused) walkActive = false;

    // walking = move the whole window
    if (!dragging && walkActive && p.speed > 0) {
      moveAcc += dir * p.speed * dt;
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
    wrap.style.bottom = 2 + jumpY + "px";
    canvas.classList.toggle("flip", dir < 0 && walkActive);

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

  function rafLoop(t) {
    tick(t);
    requestAnimationFrame(rafLoop);
  }

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
    nameEl.textContent = (SPRITES.names && SPRITES.names[character]) || character;

    msgEl.classList.add("hidden");
    if (errorCode === "no-credentials") {
      show(msgEl, "未找到 Claude Code 凭证 — 终端运行 claude 登录后点 ↻");
    } else if (errorCode === "auth") {
      show(msgEl, "凭证过期 — 终端跑一条 claude 命令后点 ↻");
    } else if (errorCode === "rate-limit") {
      show(msgEl, "🚦 " + (errorDetail || "请求太频繁，稍后自动重试"));
    } else if (errorCode) {
      show(msgEl, "获取失败，稍后自动重试" + (errorDetail ? " · " + errorDetail.slice(0, 90) : ""));
    } else if (mode === "depleted" && usage && usage.fiveHour) {
      const cd = fmtCd(usage.fiveHour.resetsAt);
      show(msgEl, "额度用完啦 💤 " + (cd || ""));
    }
  }
  function show(el, text) {
    el.textContent = text;
    el.classList.remove("hidden");
  }

  let bubbleTimer = null;
  function refreshBubble() {
    clearTimeout(bubbleTimer);
    if (mode === "depleted" || mode === "lost") {
      bubble.textContent = mode === "lost" ? "?" : "Zzz…";
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

  function applyState() {
    const prev = mode;
    mode = computeMode();
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
    if (dragging) return;
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
  function onPetClick() {
    comboCount++;
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => (comboCount = 0), 2500);
    if (comboCount >= 5) {
      comboCount = 0;
      sayTemp("别 rua 了别 rua 了!!", 2200);
      celebrateUntil = performance.now() + 1200;
      let n = 0;
      const t = setInterval(() => {
        spawnFx("♥");
        if (++n > 7) clearInterval(t);
      }, 120);
      return;
    }
    const lines = CLICK_LINES[character] || ["♥"];
    sayTemp(lines[Math.floor(Math.random() * lines.length)]);
    spawnFx("♥");
  }

  function feedPet() {
    const lines = FEED_LINES[character] || ["啊呜~"];
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
      const pool = QUIPS[mode] || QUIPS.calm;
      sayTemp(pool[Math.floor(Math.random() * pool.length)], 2800);
    }
    nextQuip = t + 70000 + Math.random() * 170000;
  }, 15000);

  function togglePause() {
    paused = !paused;
    sayTemp(paused ? "⏸ 原地休息~" : "▶ 继续散步!", 1600);
  }

  // ------------------------------------------------------------- buttons
  function switchCharacter(step) {
    const i = (CHARS.indexOf(character) + step + CHARS.length) % CHARS.length;
    api.setCharacter(CHARS[i]); // main saves & broadcasts back
  }
  document.getElementById("prev").addEventListener("click", () => switchCharacter(-1));
  document.getElementById("next").addEventListener("click", () => switchCharacter(1));
  document.getElementById("menu").addEventListener("click", () => api.showMenu());
  document.getElementById("feed").addEventListener("click", feedPet);
  document.getElementById("refresh").addEventListener("click", () => {
    sayTemp("刷新中…", 1200);
    api.refresh();
  });
  document.getElementById("quit").addEventListener("click", () => api.quit());

  // ------------------------------------------------------------- host events
  api.onUsage((d) => { usage = d; errorCode = null; applyState(); });
  api.onError((d) => {
    errorCode = (d && d.code) || "fetch";
    errorDetail = (d && d.message) || "";
    applyState();
  });
  api.onCelebrate(() => {
    celebrateUntil = performance.now() + 2600;
    sayTemp("额度重置啦!! ✦", 2600);
    let n = 0;
    const tick = setInterval(() => {
      spawnFx(["✦", "★", "♥"][n % 3]);
      if (++n > 7) clearInterval(tick);
    }, 300);
  });
  api.onCharacter((c) => {
    if (CHARS.includes(c)) {
      character = c;
      frameIdx = 0;
      refreshHud();
    }
  });
  api.onPetSize((n) => {
    wrap.style.width = n + "px";
    wrap.style.height = n + "px";
  });

  setInterval(() => {
    if (usage) {
      setBar(bar5, pct5, reset5, usage.fiveHour);
      setBar(barw, pctw, resetw, usage.week);
    }
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
