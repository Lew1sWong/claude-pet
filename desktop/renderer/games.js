/* Claude Pet — mini-games, played inside the pet/island window. While a game
   runs the host window is temporarily resized (enter/exit-game-mode) and the
   pet's click-through is disabled (window.__petGameActive). Shared by both the
   floating pet and the Dynamic Island renderers. */
(function () {
  "use strict";
  const api = window.petAPI;
  const PC = window.PetCore;
  const T = window.t;   // i18n lookup (capital: the game loops use `t` for time)
  const GW = 300, GH = 400;

  let overlay = null, stageEl = null, titleEl = null, scoreEl = null, footEl = null, backBtn = null;
  let active = null;   // { stop() }
  let rafId = 0;

  // ---------------------------------------------------------- helpers
  const curChar = () => window.__petCharacter || "cat";
  function best(key) { return Number(localStorage.getItem("petgame_best_" + key)) || 0; }
  function saveBest(key, v, lower) {
    const cur = Number(localStorage.getItem("petgame_best_" + key));
    if (!cur || (lower ? v < cur : v > cur)) { localStorage.setItem("petgame_best_" + key, String(v)); return true; }
    return false;
  }
  function petTile(char) {
    const off = document.createElement("canvas");
    off.width = 16; off.height = 16;
    PC.drawPet(off.getContext("2d"), char, "idle", 0, false);
    return off;
  }
  function loop(fn) {
    function tick(t) { fn(t); rafId = requestAnimationFrame(tick); }
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "game-overlay";
    overlay.innerHTML =
      '<div class="g-top">' +
      '  <button class="g-back" title="返回">←</button>' +
      '  <span class="g-title">游戏</span>' +
      '  <span class="g-score"></span>' +
      '  <button class="g-close" title="关闭">✕</button>' +
      '</div>' +
      '<div class="g-stage"></div>' +
      '<div class="g-foot"></div>';
    document.body.appendChild(overlay);
    stageEl = overlay.querySelector(".g-stage");
    titleEl = overlay.querySelector(".g-title");
    scoreEl = overlay.querySelector(".g-score");
    footEl = overlay.querySelector(".g-foot");
    backBtn = overlay.querySelector(".g-back");
    backBtn.addEventListener("click", showChooser);
    overlay.querySelector(".g-close").addEventListener("click", close);
  }

  function setHud(title, score) { titleEl.textContent = title; scoreEl.textContent = score || ""; }
  function clearStage() { stopActive(); stageEl.innerHTML = ""; footEl.innerHTML = ""; }
  function stopActive() { if (active && active.stop) { try { active.stop(); } catch {} } active = null; stopLoop(); }

  function overPanel(title, lines, retryLabel, onRetry) {
    const over = document.createElement("div");
    over.className = "g-over";
    over.innerHTML = `<div class="t">${title}</div><div class="s">${lines}</div>`;
    const btn = document.createElement("button");
    btn.className = "g-btn primary"; btn.textContent = retryLabel || "再来一次";
    btn.addEventListener("click", () => { over.remove(); onRetry(); });
    over.appendChild(btn);
    stageEl.appendChild(over);
  }

  // ---------------------------------------------------------- chooser
  function showChooser() {
    clearStage();
    backBtn.style.visibility = "hidden";
    setHud(T("game.menuTitle"), "");
    const menu = document.createElement("div");
    menu.className = "g-menu";
    menu.innerHTML =
      '<button class="g-card" data-g="catch">🍖<span>' + T("game.catch") + '</span></button>' +
      '<button class="g-card" data-g="reaction">⚡<span>' + T("game.reaction") + '</span></button>' +
      '<button class="g-card" data-g="memory">🃏<span>' + T("game.memory") + '</span></button>';
    menu.querySelectorAll(".g-card").forEach((b) =>
      b.addEventListener("click", () => startGame(b.dataset.g)));
    stageEl.appendChild(menu);
  }

  function startGame(key) {
    clearStage();
    backBtn.style.visibility = "visible";
    if (key === "catch") active = catchGame();
    else if (key === "reaction") active = reactionGame();
    else if (key === "memory") active = memoryGame();
    else showChooser();
  }

  // ---------------------------------------------------------- 接食物
  function catchGame() {
    const CT = T("game.catch"), SC = T("game.score");
    setHud(CT, "");
    const cv = document.createElement("canvas");
    // fixed board size (window resize is async, so clientHeight may be stale);
    // the window becomes GW wide, so 1px:1px maps cleanly for pointer math
    cv.width = GW; cv.height = 322;
    stageEl.appendChild(cv);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const W = cv.width, H = cv.height;
    const tile = petTile(curChar());
    const FOODS = ["🐟", "🥕", "🍖", "✦", "🍓", "🍙"];
    const basket = { x: W / 2, w: 46, y: H - 40 };
    let items = [], score = 0, lives = 3, spawnAt = 0, speed = 1, over = false;

    function onMove(e) {
      const r = cv.getBoundingClientRect();
      basket.x = Math.max(basket.w / 2, Math.min(W - basket.w / 2, e.clientX - r.left));
    }
    function onKey(e) {
      if (e.key === "ArrowLeft") basket.x = Math.max(basket.w / 2, basket.x - 24);
      if (e.key === "ArrowRight") basket.x = Math.min(W - basket.w / 2, basket.x + 24);
    }
    cv.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);

    function endGame() {
      if (over) return;          // never end (and stack a result panel) twice
      over = true; stopLoop();
      if (api.gameClear) api.gameClear();   // achievement: a round was completed
      const isBest = saveBest("catch", score, false);
      overPanel(score + " " + SC, (isBest ? T("game.newRecord") + "<br>" : T("game.bestScore") + " " + best("catch") + " " + SC + "<br>") + T("game.full"), T("game.againCatch"), () => startGame("catch"));
    }

    let last = performance.now();
    loop((t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (over) return;
      speed = 1 + score * 0.04;
      if (t > spawnAt) {
        items.push({ x: 18 + Math.random() * (W - 36), y: -10, vy: 60 + Math.random() * 50, e: FOODS[(Math.random() * FOODS.length) | 0] });
        spawnAt = t + Math.max(420, 950 - score * 18) * (0.7 + Math.random() * 0.6);
      }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#1b1b2b"; ctx.fillRect(0, 0, W, H);
      ctx.font = "22px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const it of items) {
        it.y += it.vy * speed * dt;
        ctx.fillText(it.e, it.x, it.y);
      }
      // basket = the pet
      const bs = 40;
      ctx.drawImage(tile, basket.x - bs / 2, basket.y - bs / 2, bs, bs);
      // collisions
      items = items.filter((it) => {
        if (over) return false;   // stop processing the rest of this frame once ended
        if (it.y >= basket.y - 16 && it.y <= basket.y + 12 && Math.abs(it.x - basket.x) < basket.w / 2 + 6) {
          score++; setHud("接食物", score + " 分　❤×" + lives); return false;
        }
        if (it.y > H + 14) {
          lives = Math.max(0, lives - 1);
          setHud(CT, score + " " + SC + "　❤×" + lives);
          if (lives <= 0) endGame();
          return false;
        }
        return true;
      });
    });

    setHud(CT, "0 " + SC + "　❤×3");
    footEl.innerHTML = "<span class='g-score'>" + T("game.catchHint") + "</span>";
    return { stop() { cv.removeEventListener("mousemove", onMove); window.removeEventListener("keydown", onKey); } };
  }

  // ---------------------------------------------------------- 反应力
  function reactionGame() {
    setHud(T("game.reaction"), "");
    const panel = document.createElement("div");
    panel.className = "g-react idle";
    panel.innerHTML = '<div class="big">' + T("game.reactTitle") + '</div><div class="sm">' + T("game.reactStart") + '</div>';
    stageEl.appendChild(panel);
    let state = "idle", t0 = 0, timer = null;

    function arm() {
      state = "wait"; panel.className = "g-react wait";
      panel.innerHTML = '<div class="big">' + T("game.reactReady") + '</div><div class="sm">' + T("game.reactWait") + '</div>';
      timer = setTimeout(() => {
        state = "go"; t0 = performance.now();
        panel.className = "g-react go";
        panel.innerHTML = '<div class="big">' + T("game.reactGo") + '</div>';
      }, 1100 + Math.random() * 2600);
    }
    function result(ms) {
      state = "idle";
      if (api.gameClear) api.gameClear();   // achievement: a measurement completed
      const isBest = saveBest("reaction", ms, true);
      panel.className = "g-react idle";
      panel.innerHTML = `<div class="big">${ms} ${T("game.reactMs")}</div><div class="sm">${isBest ? T("game.newRecord") : T("game.best") + " " + best("reaction") + " " + T("game.reactMs")}<br>${T("game.reactStart")}</div>`;
    }
    function onClick() {
      if (state === "idle") { arm(); return; }
      if (state === "wait") {
        clearTimeout(timer); state = "early";
        panel.className = "g-react early";
        panel.innerHTML = '<div class="big">' + T("game.reactTooFast") + '</div><div class="sm">' + T("game.reactRetry") + '</div>';
        state = "idle"; return;
      }
      if (state === "go") result(Math.round(performance.now() - t0));
    }
    panel.addEventListener("click", onClick);
    return { stop() { clearTimeout(timer); panel.removeEventListener("click", onClick); } };
  }

  // ---------------------------------------------------------- 记忆翻牌
  function memoryGame() {
    const MT = T("game.memory"), MV = T("game.moves");
    setHud(MT, "");
    const chars = Object.keys(SPRITES.frames).slice();
    // 6 pairs
    const pick = chars.sort(() => Math.random() - 0.5).slice(0, 6);
    let deck = pick.concat(pick).sort(() => Math.random() - 0.5);
    const grid = document.createElement("div");
    grid.className = "g-grid";
    stageEl.appendChild(grid);
    let flipped = [], matched = 0, moves = 0, lock = false, startT = performance.now(), flipTimer = null;

    deck.forEach((ch) => {
      const cell = document.createElement("button");
      cell.className = "g-cell";
      cell.textContent = "🐾";
      cell._char = ch;
      cell.addEventListener("click", () => onFlip(cell));
      grid.appendChild(cell);
    });
    setHud(MT, MV + " 0");

    function reveal(cell) {
      cell.classList.add("up"); cell.textContent = "";
      const c = petTile(cell._char);
      const shown = document.createElement("canvas");
      shown.width = 16; shown.height = 16;
      shown.getContext("2d").drawImage(c, 0, 0);
      cell.appendChild(shown);
    }
    function hide(cell) { cell.classList.remove("up"); cell.innerHTML = ""; cell.textContent = "🐾"; }

    function onFlip(cell) {
      if (lock || cell.classList.contains("up") || cell.classList.contains("done")) return;
      reveal(cell); flipped.push(cell);
      if (flipped.length === 2) {
        moves++; setHud(MT, MV + " " + moves);
        lock = true;
        const [a, b] = flipped;
        if (a._char === b._char) {
          flipTimer = setTimeout(() => {
            if (!grid.isConnected) return;   // game was torn down mid-flip
            a.classList.add("done"); b.classList.add("done");
            flipped = []; lock = false; matched++;
            if (matched === 6) win();
          }, 360);
        } else {
          flipTimer = setTimeout(() => {
            if (!grid.isConnected) return;
            hide(a); hide(b); flipped = []; lock = false;
          }, 760);
        }
      }
    }
    function win() {
      const secs = ((performance.now() - startT) / 1000).toFixed(1);
      if (api.gameClear) api.gameClear();   // achievement: cleared the board
      const isBest = saveBest("memory", moves, true);
      overPanel(T("game.memWin"), `${secs}s · ${moves} ${MV}<br>${isBest ? T("game.memRecord") : T("game.best") + " " + best("memory") + " " + MV}`, T("game.againCatch"), () => startGame("memory"));
    }
    return { stop() { clearTimeout(flipTimer); } };
  }

  // ---------------------------------------------------------- open / close
  function open(key) {
    ensureOverlay();
    window.__petGameActive = true;
    if (api.enterGameMode) api.enterGameMode(GW, GH);
    if (api.setIgnore) api.setIgnore(false);
    overlay.classList.add("show");
    if (key && key !== "menu") startGame(key); else showChooser();
  }
  function close() {
    stopActive();
    if (overlay) overlay.classList.remove("show");
    window.__petGameActive = false;
    // open() forced setIgnore(false), bypassing the renderer's click-through
    // tracker; reset it so transparent areas don't keep swallowing clicks
    if (window.__petResetIgnore) window.__petResetIgnore();
    if (api.exitGameMode) api.exitGameMode();
  }

  window.PetGames = { open, close, isOpen: () => !!(overlay && overlay.classList.contains("show")) };
})();
