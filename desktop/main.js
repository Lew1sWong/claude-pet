// Claude Pet — floating desktop pet (Electron main process)
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, Notification, nativeImage,
  globalShortcut,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { readCredentials } = require("./lib/credentials");
const { fetchUsage } = require("./lib/usageClient");
const { createBossController, DEFAULT_DISGUISES } = require("./lib/bossKey");
const { readNotch } = require("./lib/notch");
const STR = require("./lib/strings");

// boss-key profession presets → which disguise screens cycle on each trigger
const PROFESSIONS = [
  ["dev", "👨‍💻 程序员", ["terminal", "code"]],
  ["office", "💼 文员 / 行政", ["word", "excel"]],
  ["all", "🎛️ 全部混合", DEFAULT_DISGUISES],
];

const WIN_W = 230;
const WIN_H = 215;
// Dynamic Island window — bigger than the pill itself so the expanded panel
// and drop-shadow have room; the actual capsule is sized/animated in CSS.
const ISLAND_W = 420;
const ISLAND_H = 360;
// single source of truth for the character menus (tray + right-click on pet)
const CHARACTERS = [
  ["cat", "🐱 小橘"],
  ["dog", "🐶 柴柴"],
  ["bear", "🐻 布朗"],
  ["rabbit", "🐰 团子"],
  ["fox", "🦊 小狐"],
  ["penguin", "🐧 QQ"],
  ["star", "✦ 小克"],
];
const POLL_SECONDS = 300;          // 5 min — usage changes slowly, stay gentle
const MIN_REFRESH_MS = 20 * 1000;  // hard floor between any two requests
const BACKOFF_MIN_MS = 5 * 60 * 1000;   // first rate-limit cooldown
const BACKOFF_MAX_MS = 30 * 60 * 1000;  // cap

let win = null;
let tray = null;
let lastUsage = null;
let dragTimer = null;
let pollTimer = null;
let prevFiveHourPct = null;
let settings = {};
let cooldownUntil = 0;       // persisted across restarts
let lastRequestAt = 0;       // wall-clock of last actual network hit
let backoffLevel = 0;        // consecutive rate-limit count
let isQuitting = false;      // set on quit so timers/IPC never re-arm or fire
let boss = null;             // boss-key controller (when wired); stopped on quit
let gameSavedBounds = null;  // window bounds saved while a mini-game resizes it
let islandNotch = null;      // native notch geometry for the Dynamic Island
let settingsLoaded = false;  // guard: never persist {} if we quit before loading
let settingsWin = null;      // the Settings / onboarding window
let bossStarted = false;     // whether the boss-key hook is currently running

// ---------------------------------------------------------------- settings
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); }
  catch { settings = {}; }
  settingsLoaded = true;
  // restore rate-limit state so a restart can't bypass an active cooldown
  cooldownUntil = Number(settings.cooldownUntil) || 0;
  backoffLevel = Number(settings.backoffLevel) || 0;
  if (settings.lastUsage && settings.lastUsageAt) {
    lastUsage = settings.lastUsage;
    prevFiveHourPct = lastUsage.fiveHour ? lastUsage.fiveHour.pct : null;
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch { /* ignore */ }
}

// guarded IPC: never throw if the window is gone or we're shutting down.
// matters because an in-flight poll() can resolve right as the window dies.
function sendToWin(channel, payload) {
  if (isQuitting || !win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, payload);
}

// ---------------------------------------------------------------- i18n / features
function resolveLang() {
  const l = settings.lang || "system";
  if (l === "zh" || l === "en") return l;
  const loc = (app.getLocale() || "en").toLowerCase();
  return loc.startsWith("zh") ? "zh" : "en";
}
function tr(key) { return STR.t(key, resolveLang()); }
function broadcastI18n() {
  const lang = resolveLang();
  sendToWin("i18n", { lang, dict: STR.pick(lang), lines: STR.lines[lang] });
}
// default: usage tracking ON, games + boss OFF (chosen at onboarding)
function featureFlags() {
  const f = settings.features || {};
  return { usage: f.usage !== false, games: !!f.games, boss: !!f.boss };
}

// ---- achievements (彩蛋): 10 boss uses → 潜行大师, 10 game clears → 游戏达人
const ACH_GOAL = 10;
function statsNow() {
  const s = settings.stats || {};
  return { bossUses: s.bossUses || 0, gameClears: s.gameClears || 0 };
}
function bumpStat(kind) {
  const map = { boss: "bossUses", game: "gameClears" };
  const k = map[kind];
  if (!k) return;
  const st = statsNow();
  const before = st[k];
  st[k] = before + 1;
  settings.stats = st;
  saveSettings();
  if (before < ACH_GOAL && st[k] >= ACH_GOAL) {
    // newly unlocked → toast + the pet celebrates
    const title = tr(kind === "boss" ? "ach.boss.title" : "ach.game.title");
    try { new Notification({ title: tr("app.name"), body: tr("ach.toast") + title }).show(); } catch { /* ignore */ }
    sendToWin("celebrate");
  }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("stats", statsNow());
}

// ---------------------------------------------------------------- window
function uiMode() {
  return settings.uiMode === "island" ? "island" : "float";
}

function createWindow() {
  const mode = uiMode();
  const disp = screen.getPrimaryDisplay();
  const wa = disp.workArea;
  let geom;
  if (mode === "island") {
    // macOS clamps the window just below the menu bar (it can't sit ON the
    // notch without a native NSWindow subclass), so the pill hangs directly
    // under the notch — centered on the real notch center, sized to it.
    const b = disp.bounds;
    islandNotch = readNotch();
    const cx = b.x + (islandNotch.notchCenter || b.width / 2);
    geom = { width: ISLAND_W, height: ISLAND_H, x: Math.round(cx - ISLAND_W / 2), y: b.y };
  } else {
    geom = {
      width: WIN_W,
      height: WIN_H,
      x: Number.isFinite(settings.x) ? settings.x : wa.x + 120,
      y: Number.isFinite(settings.y) ? settings.y : wa.y + wa.height - WIN_H,
    };
  }
  win = new BrowserWindow({
    ...geom,
    ...(mode === "island" ? { enableLargerThanScreen: true } : {}),
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // critical: this window is never focused while you work elsewhere —
      // without this Chromium throttles/pauses rAF & timers and the pet freezes
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (mode === "island") {
    // the window is clamped below the menu bar at creation; with
    // enableLargerThanScreen + the screen-saver level now set, re-asserting the
    // bounds lands it at y=0 so the pill can sit ON the notch
    win.setBounds({ x: geom.x, y: disp.bounds.y, width: geom.width, height: geom.height });
  }
  win.loadFile(path.join(__dirname, "renderer", mode === "island" ? "island.html" : "index.html"));
  if (process.env.CLAUDE_PET_DEBUG) {
    win.webContents.openDevTools({ mode: "detach" });
  }
  win.webContents.on("did-finish-load", () => {
    broadcastI18n();
    sendToWin("features", featureFlags());
    sendToWin("character", settings.character || "cat");
    sendToWin("pet-size", settings.petSize || 64);
    if (mode === "island") {
      // feed the renderer the REAL notch width/height so the pill snaps to it;
      // fall back to the menu-bar height when there's no notch
      const n = islandNotch || readNotch();
      sendToWin("island-geometry", {
        hasNotch: !!n.hasNotch,
        notchTop: n.hasNotch ? n.notchTop : Math.max(34, wa.y - disp.bounds.y),
        notchW: n.hasNotch ? n.notchW : 0,
      });
    }
    // show cached data instantly so the pet isn't blank while we wait
    if (lastUsage) {
      sendToWin("usage", { ...lastUsage, fetchedAt: settings.lastUsageAt || Date.now() });
    } else if (Date.now() < cooldownUntil) {
      sendToWin("usage-error", {
        code: "rate-limit",
        message: `被限流恢复中，约 ${Math.ceil((cooldownUntil - Date.now()) / 60000)} 分钟后自动重试`,
      });
    }
    scheduleNextPoll();
  });
}

// swap between Dynamic Island and floating pet by rebuilding the window.
// create the new one BEFORE destroying the old so "window-all-closed" (which
// quits the app) never fires in the gap.
function setUiMode(m) {
  const next = m === "island" ? "island" : "float";
  if (uiMode() === next) return;
  settings.uiMode = next;
  saveSettings();
  // drop the old window's pending poll; the new window re-arms it on load
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  gameSavedBounds = null;  // old window is going away; its game bounds are moot
  const old = win;
  const wasHidden = old && !old.isVisible();
  win = null;
  createWindow();
  if (wasHidden && win) win.hide();
  if (old) old.destroy();
  buildTray();
}

// ---------------------------------------------------------------- settings window
function publicSettings() {
  return {
    uiMode: uiMode(),
    character: settings.character || "cat",
    petSize: settings.petSize || 64,
    profession: settings.profession || "all",
    features: featureFlags(),
    onboarded: !!settings.onboarded,
    stats: statsNow(),
    achGoal: ACH_GOAL,
  };
}

function openSettings(opts) {
  const onboarding = !!(opts && opts.onboarding);
  // mark onboarded immediately so it only ever auto-pops once
  if (onboarding && !settings.onboarded) { settings.onboarded = true; saveSettings(); }
  // this is a dock-hidden accessory app; show the dock so the settings window
  // can come to the front and take focus over whatever app is active
  if (process.platform === "darwin" && app.dock) app.dock.show();
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); app.focus({ steal: true }); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 640,
    resizable: false, fullscreenable: false, maximizable: false,
    title: tr("set.title"), show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.once("ready-to-show", () => { settingsWin.show(); settingsWin.focus(); app.focus({ steal: true }); });
  settingsWin.webContents.on("did-finish-load", () => {
    const lang = resolveLang();
    settingsWin.webContents.send("settings-init", {
      onboarding,
      lang, langPref: settings.lang || "system",
      dict: STR.pick(lang),
      settings: publicSettings(),
      autostart: app.getLoginItemSettings().openAtLogin,
    });
  });
  settingsWin.on("closed", () => {
    settingsWin = null;
    if (process.platform === "darwin" && app.dock) app.dock.hide(); // back to accessory
  });
}

// boss-key hook lifecycle (gated by the feature toggle)
function startBossIfEnabled() {
  if (featureFlags().boss && boss && !bossStarted) { boss.start(settings); bossStarted = true; }
}
function stopBoss() {
  if (boss && bossStarted) { boss.stop(); bossStarted = false; }
}

function applyFeatureChanges() {
  const f = featureFlags();
  if (f.boss) startBossIfEnabled(); else stopBoss();
  if (f.usage) { if (!pollTimer && win) scheduleNextPoll(); }
  else if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

// apply a patch from the Settings window, persist, and reflect live
function applySettingsPatch(p) {
  if (!p) return;
  let i18nChanged = false, trayChanged = false;
  if (p.character !== undefined) setCharacter(p.character);
  if (p.petSize !== undefined) setPetSize(p.petSize);
  if (p.profession !== undefined) {
    const pr = PROFESSIONS.find((x) => x[0] === p.profession);
    settings.profession = p.profession;
    if (pr) settings.bossDisguises = pr[2].slice();
    if (boss) boss.applySettings(settings);
  }
  if (p.autostart !== undefined) app.setLoginItemSettings({ openAtLogin: !!p.autostart });
  if (p.onboarded !== undefined) settings.onboarded = !!p.onboarded;
  if (p.lang !== undefined) { settings.lang = p.lang; i18nChanged = true; trayChanged = true; }
  if (p.features !== undefined) {
    settings.features = { ...featureFlags(), ...p.features };
    applyFeatureChanges();
    sendToWin("features", featureFlags());
    trayChanged = true;
  }
  saveSettings();
  if (p.uiMode !== undefined) setUiMode(p.uiMode); // recreates window + tray
  if (i18nChanged) broadcastI18n();
  if (trayChanged) buildTray();
}

// ---------------------------------------------------------------- polling
function persistRateState() {
  settings.cooldownUntil = cooldownUntil;
  settings.backoffLevel = backoffLevel;
  saveSettings();
}

// schedule the next automatic poll, always respecting cooldown
function scheduleNextPoll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (isQuitting || !win || !featureFlags().usage) return;
  const now = Date.now();
  let wait = POLL_SECONDS * 1000;
  if (now < cooldownUntil) wait = Math.max(wait, cooldownUntil - now + 1000);
  // jitter ±15% so multiple clients (and restarts) don't sync up and hammer
  wait = Math.round(wait * (0.85 + Math.random() * 0.3));
  pollTimer = setTimeout(() => poll(), wait);
}

// manual=true comes from the refresh button / menu
async function poll(manual = false) {
  if (isQuitting || !win || win.isDestroyed()) return;
  const now = Date.now();

  // still cooling down from a rate-limit? don't even try
  if (now < cooldownUntil) {
    const mins = Math.max(1, Math.ceil((cooldownUntil - now) / 60000));
    sendToWin("usage-error", {
      code: "rate-limit",
      message: `被限流了，约 ${mins} 分钟后自动重试`,
    });
    scheduleNextPoll();
    return;
  }
  // hard floor between requests — protects against spamming ↻
  if (now - lastRequestAt < MIN_REFRESH_MS) {
    if (manual && lastUsage) {
      sendToWin("usage", { ...lastUsage, fetchedAt: settings.lastUsageAt || now });
    }
    scheduleNextPoll();
    return;
  }

  lastRequestAt = now;
  try {
    const creds = await readCredentials();
    if (!creds) {
      sendToWin("usage-error", { code: "no-credentials" });
      scheduleNextPoll();
      return;
    }
    const usage = await fetchUsage(creds.accessToken);

    // success — clear any backoff
    backoffLevel = 0;
    cooldownUntil = 0;
    lastUsage = usage;
    settings.lastUsage = usage;
    settings.lastUsageAt = Date.now();
    persistRateState();
    updateTrayTitle();

    const pct = usage.fiveHour ? usage.fiveHour.pct : null;
    if (
      prevFiveHourPct !== null && pct !== null &&
      prevFiveHourPct >= 80 && pct <= prevFiveHourPct - 50
    ) {
      sendToWin("celebrate");
      new Notification({
        title: "Claude Pet",
        body: "🎉 5 小时额度已重置，宠物精神满满！",
      }).show();
    }
    if (pct !== null) prevFiveHourPct = pct;
    sendToWin("usage", { ...usage, fetchedAt: Date.now() });
  } catch (e) {
    if (e && e.status === 429) {
      // exponential backoff: 5 → 10 → 20 → 30(max) min
      const base = e.retryAfter ? e.retryAfter * 1000 : BACKOFF_MIN_MS;
      const backoff = Math.min(BACKOFF_MAX_MS, base * Math.pow(2, backoffLevel));
      backoffLevel = Math.min(backoffLevel + 1, 4);
      cooldownUntil = Date.now() + backoff;
      persistRateState();
      sendToWin("usage-error", {
        code: "rate-limit",
        message: `被限流了，约 ${Math.max(1, Math.ceil(backoff / 60000))} 分钟后自动重试`,
      });
    } else {
      sendToWin("usage-error", {
        code: e && e.status === 401 ? "auth" : "fetch",
        message: String((e && e.message) || e),
      });
    }
  }
  scheduleNextPoll();
}

// ---------------------------------------------------------------- tray
function updateTrayTitle() {
  if (!tray) return;
  const pctTxt = lastUsage && lastUsage.fiveHour
    ? `${Math.round(lastUsage.fiveHour.pct)}%` : null;
  // macOS shows text beside the tray icon; Windows/Linux only have a tooltip
  if (process.platform === "darwin") {
    tray.setTitle(pctTxt ? ` 🐾${pctTxt}` : " 🐾", { fontType: "monospacedDigit" });
  }
  tray.setToolTip(pctTxt ? `Claude Pet · 5h ${pctTxt}` : "Claude Pet");
}

// build the radio list of characters, shared by both menus
function characterMenuItems() {
  const ch = settings.character || "cat";
  return CHARACTERS.map(([id, label]) => ({
    label, type: "radio", checked: ch === id,
    click: () => setCharacter(id),
  }));
}

// display-mode radio (灵动岛 / 悬浮桌宠), shared by both menus
function uiModeMenuItems() {
  const m = uiMode();
  return [
    { label: "🏝️ 灵动岛", type: "radio", checked: m === "island", click: () => setUiMode("island") },
    { label: "🐾 悬浮桌宠", type: "radio", checked: m === "float", click: () => setUiMode("float") },
  ];
}

// pet-size submenu — only meaningful for the floating pet; the island pet is a
// fixed size that blends with the notch, so this is omitted in island mode
function sizeMenuItem() {
  return {
    label: "宠物大小",
    submenu: [48, 64, 96].map((n, i) => ({
      label: ["小", "中", "大"][i],
      type: "radio",
      checked: (settings.petSize || 64) === n,
      click: () => setPetSize(n),
    })),
  };
}

// 🎮 mini-games submenu (shared). Opening a game shows the window first.
function openGame(key) {
  if (!win) return;
  if (!win.isVisible()) win.show();
  sendToWin("open-game", key);
}
function gamesMenuItem() {
  return {
    label: "🎮 玩游戏",
    submenu: [
      { label: "🍖 接食物", click: () => openGame("catch") },
      { label: "⚡ 反应力测试", click: () => openGame("reaction") },
      { label: "🃏 记忆翻牌", click: () => openGame("memory") },
    ],
  };
}

// 🕶️ boss-key submenu (shared): test trigger + profession/disguise presets
function professionItems() {
  const cur = settings.profession || "all";
  return PROFESSIONS.map(([id, label, ds]) => ({
    label, type: "radio", checked: cur === id,
    click: () => setProfession(id, ds),
  }));
}
function setProfession(id, ds) {
  settings.profession = id;
  settings.bossDisguises = ds.slice();
  saveSettings();
  if (boss) boss.applySettings(settings);
  buildTray();
}
function bossMenuItem() {
  return {
    label: "🕶️ 老板键",
    submenu: [
      { label: "试一下（显示伪装画面）", click: () => { if (boss) boss.toggle(); } },
      { type: "separator" },
      { label: "职业 / 伪装组合", submenu: professionItems() },
      { type: "separator" },
      { label: "触发：连按三下 Esc　或　⌘⇧B", enabled: false },
      { label: "（全局 Esc 需在 系统设置→隐私→辅助功能 授权）", enabled: false },
    ],
  };
}

function buildTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "assets", "icon.png"))
    .resize({ width: 18, height: 18 });
  if (!tray) tray = new Tray(icon);
  updateTrayTitle();
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? tr("menu.hide") : tr("menu.show"),
      click: () => { if (win.isVisible()) win.hide(); else win.show(); buildTray(); },
    },
    ...(featureFlags().usage ? [{ label: tr("menu.refresh"), click: () => poll(true) }] : []),
    { label: tr("menu.settings"), click: () => openSettings() },
    { type: "separator" },
    { label: tr("menu.quit"), click: () => app.quit() },
  ]));
}

function setPetSize(n) {
  settings.petSize = n;
  saveSettings();
  if (win) sendToWin("pet-size", n);
  buildTray();
}

function setCharacter(ch) {
  settings.character = ch;
  saveSettings();
  if (win) sendToWin("character", ch);
  buildTray();
}

// ---------------------------------------------------------------- ipc
ipcMain.handle("move-by", (_e, dx) => {
  if (!win) return { atLeft: false, atRight: false };
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const minX = wa.x;
  const maxX = wa.x + wa.width - b.width;
  let nx = Math.round(b.x + dx);
  const atLeft = nx <= minX;
  const atRight = nx >= maxX;
  nx = Math.max(minX, Math.min(maxX, nx));
  win.setPosition(nx, b.y);
  return { atLeft, atRight };
});

ipcMain.on("drag-start", (_e, offX, offY) => {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    win.setPosition(Math.round(p.x - offX), Math.round(p.y - offY));
  }, 16);
});

ipcMain.on("drag-end", () => {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  if (win) {
    const [x, y] = win.getPosition();
    settings.x = x;
    settings.y = y;
    saveSettings();
  }
});

ipcMain.on("set-ignore", (_e, v) => {
  if (win) win.setIgnoreMouseEvents(!!v, { forward: true });
});

ipcMain.on("set-character", (_e, ch) => setCharacter(ch));
ipcMain.on("set-ui-mode", (_e, m) => setUiMode(m));

// mini-games temporarily grow the host window to a comfy board, then restore
ipcMain.on("enter-game-mode", (_e, w, h) => {
  if (!win || win.isDestroyed()) return;
  if (!gameSavedBounds) gameSavedBounds = win.getBounds();
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const W = Math.min(w || 300, wa.width - 20);
  const H = Math.min(h || 400, wa.height - 20);
  win.setBounds({
    x: Math.round(wa.x + (wa.width - W) / 2),
    y: Math.round(wa.y + (wa.height - H) / 2),
    width: W, height: H,
  });
});
ipcMain.on("exit-game-mode", () => {
  if (win && !win.isDestroyed() && gameSavedBounds) win.setBounds(gameSavedBounds);
  gameSavedBounds = null;
});

// boss-key: renderer fallbacks (local triple-Esc inside the disguise window)
ipcMain.on("boss-dismiss", () => { if (boss) boss.hide(); });
ipcMain.on("boss-toggle", () => { if (boss) boss.toggle(); });

// achievements: a mini-game was cleared
ipcMain.on("stat-bump", (_e, kind) => bumpStat(kind));

// settings window
ipcMain.on("settings-update", (_e, patch) => applySettingsPatch(patch));
ipcMain.on("open-settings", () => openSettings());
ipcMain.on("close-settings", () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); });
ipcMain.handle("get-settings", () => {
  const lang = resolveLang();
  return {
    lang, langPref: settings.lang || "system",
    dict: STR.pick(lang),
    settings: publicSettings(),
    autostart: app.getLoginItemSettings().openAtLogin,
  };
});

// right-click menu on the pet itself (tray icons can hide under the notch)
ipcMain.on("show-menu", () => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: tr("menu.settings"), click: () => openSettings() },
    ...(featureFlags().usage ? [{ label: tr("menu.refresh"), click: () => poll(true) }] : []),
    { label: win.isVisible() ? tr("menu.hide") : tr("menu.show"), click: () => { if (win.isVisible()) win.hide(); else win.show(); buildTray(); } },
    { type: "separator" },
    { label: tr("menu.quit"), click: () => app.quit() },
  ]).popup({ window: win });
});
ipcMain.on("refresh", () => poll(true));
ipcMain.on("quit", () => app.quit());

// ---------------------------------------------------------------- app
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadSettings();
    if (process.platform === "darwin" && app.dock) app.dock.hide();
    createWindow();
    // boss key: passive global triple-Esc (needs Accessibility permission) plus
    // an always-works ⌘⇧B fallback. Safe if the native hook is unavailable.
    boss = createBossController({
      rendererDir: path.join(__dirname, "renderer"),
      preloadPath: path.join(__dirname, "preload.js"),
      getPetWindow: () => win,
      getHint: () => tr("boss.exit"),
      onShow: () => bumpStat("boss"),   // achievement: count boss-key uses
    });
    startBossIfEnabled();   // only if the boss feature is on
    buildTray();
    // first run: pop the onboarding (pick language + features)
    if (!settings.onboarded) openSettings({ onboarding: true });
    // first poll is scheduled from did-finish-load (after cache is shown);
    // no fixed interval — poll() chains the next one via scheduleNextPoll()
  });
}

// ---------------------------------------------------------------- shutdown
// one idempotent teardown, run on every quit path, so nothing is left behind:
// timers, the global key-listener subprocess (boss key), hotkeys, the tray.
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  isQuitting = true;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  // boss.stop() kills the node-global-key-listener native subprocess; without
  // this it would survive as an orphan still holding Accessibility access
  try { if (boss) boss.stop(); } catch { /* ignore */ }
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  try { if (settingsLoaded) saveSettings(); } catch { /* ignore */ }
  try { if (tray) { tray.destroy(); tray = null; } } catch { /* ignore */ }
}

app.on("before-quit", cleanup);
app.on("will-quit", cleanup);
app.on("window-all-closed", () => app.quit());
