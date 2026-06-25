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

  function updateConditional() {
    $("sec-boss").classList.toggle("hidden", !$("feat-boss").checked);
    $("sec-size").classList.toggle("hidden", segVal("mode-seg") !== "float");
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
        patch({ character: ch });
      });
      grid.appendChild(btn);
    });
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
    $("autostart").checked = d.autostart;
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
  $("autostart").addEventListener("change", (e) => patch({ autostart: e.target.checked }));
  $("done").addEventListener("click", () => { patch({ onboarded: true }); api.closeSettings(); });

  api.onSettingsInit(render);
  // live medal progress while settings is open
  api.onStats((s) => { if (state) { state.settings.stats = s; buildAchievements(s, (state.settings && state.settings.achGoal) || 10); } });
  // also pull on load in case the init event already fired
  api.getSettings().then((d) => { if (!state) render({ ...d, onboarding: false }); });
})();
