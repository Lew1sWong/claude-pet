/* Settings / onboarding window. Reads a snapshot from main (settings-init or
   get-settings), reflects every change live via settingsUpdate patches, and
   re-renders itself when the language changes. */
(function () {
  "use strict";
  const api = window.petAPI;
  let state = null;

  const $ = (id) => document.getElementById(id);
  const segButtons = (id) => Array.from(document.querySelectorAll("#" + id + " button"));
  function setSeg(id, val) { segButtons(id).forEach((b) => b.classList.toggle("on", b.dataset.val === String(val))); }
  function segVal(id) { const b = document.querySelector("#" + id + " button.on"); return b ? b.dataset.val : null; }
  function patch(p) { api.settingsUpdate(p); }

  function featuresNow() {
    return {
      usage: $("feat-usage").checked,
      games: $("feat-games").checked,
      boss: $("feat-boss").checked,
    };
  }

  function providersNow() {
    return {
      claude: $("prov-claude").checked,
      codex: $("prov-codex").checked,
      openclaw: $("prov-openclaw").checked,
      custom: $("prov-custom").checked,
      customPath: $("prov-custom-path").value.trim(),
    };
  }

  function updateConditional() {
    $("sec-boss").classList.toggle("hidden", !$("feat-boss").checked);
    $("sec-size").classList.toggle("hidden", segVal("mode-seg") !== "float");
    $("sec-sources").classList.toggle("hidden", !$("feat-usage").checked);
    $("custom-src").classList.toggle("hidden", !$("prov-custom").checked);
  }

  function applyDynamicLabels() {
    const onb = state && state.onboarding;
    $("title").textContent = window.t(onb ? "set.welcome" : "set.title");
    $("welcome-sub").classList.toggle("hidden", !onb);
    $("done").textContent = window.t(onb ? "set.start" : "set.done");
  }

  function buildChars(current) {
    const grid = $("char-grid");
    grid.innerHTML = "";
    Object.keys(SPRITES.frames).forEach((ch) => {
      const btn = document.createElement("button");
      btn.className = "char" + (ch === current ? " on" : "");
      const cv = document.createElement("canvas");
      cv.width = 16; cv.height = 16;
      PetCore.drawPet(cv.getContext("2d"), ch, "idle", 0, false);
      btn.appendChild(cv);
      const nm = document.createElement("span");
      nm.textContent = (SPRITES.names && SPRITES.names[ch]) || ch;
      btn.appendChild(nm);
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".char").forEach((x) => x.classList.remove("on"));
        btn.classList.add("on");
        if (state) state.settings.character = ch;   // keep local copy in sync
        patch({ character: ch });
      });
      if (ch.startsWith("buddy-")) {
        const del = document.createElement("span");
        del.className = "char-del";
        del.textContent = "✕";
        del.title = window.t("set.buddyDel");
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          const next = ((state && state.settings.customPets) || []).filter((p) => p.id !== ch);
          if (state) state.settings.customPets = next;
          patch({ customPets: next });   // main re-broadcasts to the pet window
          PetCore.mergeCustomPets(next);
          const cur = (state && state.settings.character) || current;
          const fallback = cur === ch ? "cat" : cur;
          if (state) state.settings.character = fallback;
          buildChars(fallback);
        });
        btn.appendChild(del);
      }
      grid.appendChild(btn);
    });
  }

  // ---- pixel buddy maker: photo → 16×16 pixel companion -------------------
  // pipeline: center-crop → downscale to 16×16 → flood-fill background away
  // from the borders → median-cut quantize to ≤8 colours → letter grid →
  // synthesize idle (breathe) / walk (waddle) / sleep (lie down) frames.
  const GRID = 16;
  const EMPTY_ROW = ".".repeat(GRID);
  let pendingBuddy = null;

  const shiftDownG = (g) => [EMPTY_ROW].concat(g.slice(0, GRID - 1));
  const shiftXG = (g, dx) => g.map((row) =>
    dx > 0 ? ".".repeat(dx) + row.slice(0, GRID - dx) : row.slice(-dx) + ".".repeat(-dx));
  const rotateG = (g) => {   // clockwise → lying on its side for sleep
    const out = [];
    for (let y = 0; y < GRID; y++) {
      let row = "";
      for (let x = 0; x < GRID; x++) row += g[GRID - 1 - x][y];
      out.push(row);
    }
    return out;
  };
  const dropToFloor = (g) => {   // stand the art on row 14 like built-in pets
    let last = -1;
    for (let y = 0; y < GRID; y++) if (g[y] !== EMPTY_ROW) last = y;
    const shift = 14 - last;
    if (last < 0 || shift <= 0) return g;
    return Array(shift).fill(EMPTY_ROW).concat(g.slice(0, GRID - shift));
  };

  function removeBackground(px) {
    const idx = (x, y) => (y * GRID + x) * 4;
    const bg = [0, 0, 0];
    [[0, 0], [15, 0], [0, 15], [15, 15]].forEach(([x, y]) => {
      const i = idx(x, y);
      bg[0] += px[i] / 4; bg[1] += px[i + 1] / 4; bg[2] += px[i + 2] / 4;
    });
    const isBg = (i) => {
      if (px[i + 3] < 60) return true;   // already transparent
      const dr = px[i] - bg[0], dg = px[i + 1] - bg[1], db = px[i + 2] - bg[2];
      return dr * dr + dg * dg + db * db < 52 * 52;
    };
    // flood from the borders only, so a same-coloured shirt in the middle stays
    const transparent = new Array(GRID * GRID).fill(false);
    const seen = new Set();
    const stack = [];
    for (let x = 0; x < GRID; x++) stack.push([x, 0], [x, GRID - 1]);
    for (let y = 0; y < GRID; y++) stack.push([0, y], [GRID - 1, y]);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const key = y * GRID + x;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isBg(idx(x, y))) continue;
      transparent[key] = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return transparent;
  }

  function quantize(pixels, k) {
    let boxes = [pixels];
    while (boxes.length < k) {
      let bi = -1, bch = 0, brange = 0;
      boxes.forEach((box, i) => {
        if (box.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let mn = 255, mx = 0;
          for (const p of box) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch]; }
          if (mx - mn > brange) { brange = mx - mn; bi = i; bch = ch; }
        }
      });
      if (bi < 0 || brange === 0) break;
      const box = boxes[bi].slice().sort((a, b) => a[bch] - b[bch]);
      const mid = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.map((box) => {
      const s = [0, 0, 0];
      box.forEach((p) => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
      const n = Math.max(1, box.length);
      return [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
    });
  }

  function gridFromImage(px) {
    const transparent = removeBackground(px);
    const pts = [], map = [];
    for (let i = 0; i < GRID * GRID; i++) {
      if (!transparent[i] && px[i * 4 + 3] >= 60) {
        map.push(pts.length);
        pts.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
      } else map.push(-1);
    }
    if (pts.length < 24) return null;   // nothing survived — unusable photo
    const palette = quantize(pts, 8);
    const letters = "abcdefgh";
    const nearest = (p) => {
      let bi = 0, bd = Infinity;
      palette.forEach((c, i) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      return bi;
    };
    const rows = [];
    for (let y = 0; y < GRID; y++) {
      let row = "";
      for (let x = 0; x < GRID; x++) {
        const k = y * GRID + x;
        row += map[k] < 0 ? "." : letters[nearest(pts[map[k]])];
      }
      rows.push(row);
    }
    const pal = {};
    palette.forEach((c, i) => {
      pal[letters[i]] = "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
    });
    return { rows, pal };
  }

  function buddyFrames(rows) {
    const stand = dropToFloor(rows);
    const bob = shiftDownG(stand);
    const lie = dropToFloor(rotateG(stand));
    return {
      idle: [stand, bob],
      walk: [stand, shiftXG(bob, 1), stand, shiftXG(bob, -1)],
      sleep: [lie, shiftDownG(lie)],
    };
  }

  function drawBuddyPreview() {
    const cv = $("buddy-canvas");
    const c = cv.getContext("2d");
    c.clearRect(0, 0, GRID, GRID);
    if (!pendingBuddy) return;
    pendingBuddy.rows.forEach((row, y) => {
      for (let x = 0; x < GRID; x++) {
        if (row[x] !== ".") { c.fillStyle = pendingBuddy.pal[row[x]]; c.fillRect(x, y, 1, 1); }
      }
    });
  }

  function showBuddyMsg(key) {
    const el = $("buddy-msg");
    el.textContent = window.t(key);
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 3200);
  }

  // achievements (彩蛋): two medals with progress
  function buildAchievements(stats, goal) {
    const grid = $("ach-grid");
    if (!grid) return;
    grid.innerHTML = "";
    const defs = [
      { cls: "m-boss", emoji: "🕶️", count: stats.bossUses || 0, titleKey: "ach.boss.title", descKey: "ach.boss.desc" },
      { cls: "m-game", emoji: "🎮", count: stats.gameClears || 0, titleKey: "ach.game.title", descKey: "ach.game.desc" },
    ];
    defs.forEach((d) => {
      const unlocked = d.count >= goal;
      const pct = Math.min(100, Math.round((d.count / goal) * 100));
      const el = document.createElement("div");
      el.className = "medal " + d.cls + (unlocked ? " unlocked" : " locked");
      el.innerHTML =
        '<div class="badge">' + (unlocked ? d.emoji : "🔒") + "</div>" +
        '<div class="m-title">' + window.t(d.titleKey) + "</div>" +
        '<div class="m-desc">' + window.t(d.descKey) + "</div>" +
        '<div class="m-prog"><div class="m-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="m-num">' + Math.min(d.count, goal) + " / " + goal +
          (unlocked ? "　" + window.t("ach.unlocked") : "") + "</div>";
      grid.appendChild(el);
    });
  }

  function render(d) {
    state = d;
    window.I18N = d.dict;
    window.applyI18n();
    applyDynamicLabels();
    setSeg("lang-seg", d.langPref);
    setSeg("mode-seg", d.settings.uiMode);
    setSeg("prof-seg", d.settings.profession);
    setSeg("size-seg", String(d.settings.petSize));
    $("feat-usage").checked = d.settings.features.usage;
    $("feat-games").checked = d.settings.features.games;
    $("feat-boss").checked = d.settings.features.boss;
    const prov = d.settings.providers || {};
    $("prov-claude").checked = prov.claude !== false;
    $("prov-codex").checked = !!prov.codex;
    $("prov-openclaw").checked = !!prov.openclaw;
    $("prov-custom").checked = !!prov.custom;
    $("prov-custom-path").value = prov.customPath || "";
    $("autostart").checked = d.autostart;
    PetCore.mergeCustomPets(d.settings.customPets || []);
    buildChars(d.settings.character);
    buildAchievements(d.settings.stats || { bossUses: 0, gameClears: 0 }, d.settings.achGoal || 10);
    updateConditional();
  }

  async function refetch() {
    const d = await api.getSettings();
    render({ ...d, onboarding: state && state.onboarding });
  }

  // ---- wiring (done once; controls persist across re-render) ----
  function wireSeg(id, key, transform) {
    segButtons(id).forEach((b) => b.addEventListener("click", () => {
      setSeg(id, b.dataset.val);
      patch({ [key]: transform ? transform(b.dataset.val) : b.dataset.val });
      if (id === "mode-seg") updateConditional();
      if (id === "lang-seg") refetch(); // re-render the whole UI in the new language
    }));
  }
  wireSeg("lang-seg", "lang");
  wireSeg("mode-seg", "uiMode");
  wireSeg("prof-seg", "profession");
  wireSeg("size-seg", "petSize", (v) => Number(v));

  ["feat-usage", "feat-games", "feat-boss"].forEach((id) =>
    $(id).addEventListener("change", () => { patch({ features: featuresNow() }); updateConditional(); }));
  ["prov-claude", "prov-codex", "prov-openclaw", "prov-custom"].forEach((id) =>
    $(id).addEventListener("change", () => { patch({ providers: providersNow() }); updateConditional(); }));
  $("prov-custom-path").addEventListener("change", () => patch({ providers: providersNow() }));
  $("autostart").addEventListener("change", (e) => patch({ autostart: e.target.checked }));
  $("done").addEventListener("click", () => { patch({ onboarded: true }); api.closeSettings(); });

  // ---- pixel buddy wiring ----
  $("buddy-pick").addEventListener("click", () => $("buddy-file").click());
  $("buddy-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";   // allow re-picking the same file
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const cv = document.createElement("canvas");
      cv.width = cv.height = GRID;
      const c = cv.getContext("2d");
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = "high";
      c.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, GRID, GRID);
      const g = gridFromImage(c.getImageData(0, 0, GRID, GRID).data);
      if (!g) { pendingBuddy = null; $("buddy-preview").classList.add("hidden"); showBuddyMsg("set.buddyErr"); return; }
      pendingBuddy = g;
      drawBuddyPreview();
      $("buddy-preview").classList.remove("hidden");
    };
    img.onerror = () => { URL.revokeObjectURL(url); showBuddyMsg("set.buddyErr"); };
    img.src = url;
  });
  $("buddy-add").addEventListener("click", () => {
    if (!pendingBuddy || !state) return;
    const existing = state.settings.customPets || [];
    if (existing.length >= 8) { showBuddyMsg("set.buddyFull"); return; }
    const pet = {
      id: "buddy-" + Date.now().toString(36) + Math.floor(Math.random() * 36).toString(36),
      name: ($("buddy-name").value.trim() || "❤").slice(0, 12),
      palette: pendingBuddy.pal,
      frames: buddyFrames(pendingBuddy.rows),
    };
    const next = existing.concat([pet]);
    state.settings.customPets = next;
    patch({ customPets: next });   // main sanitizes, saves & pushes to the pet
    PetCore.mergeCustomPets(next);
    buildChars(state.settings.character);
    pendingBuddy = null;
    $("buddy-preview").classList.add("hidden");
    $("buddy-name").value = "";
    showBuddyMsg("set.buddyDone");
  });

  api.onSettingsInit(render);
  // live medal progress while settings is open
  api.onStats((s) => { if (state) { state.settings.stats = s; buildAchievements(s, (state.settings && state.settings.achGoal) || 10); } });
  // also pull on load in case the init event already fired
  api.getSettings().then((d) => { if (!state) render({ ...d, onboarding: false }); });
})();
