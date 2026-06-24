// Claude Pet — floating desktop pet (Electron main process)
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, Notification, nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { readCredentials } = require("./lib/credentials");
const { fetchUsage } = require("./lib/usageClient");

const WIN_W = 230;
const WIN_H = 215;
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

// ---------------------------------------------------------------- settings
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); }
  catch { settings = {}; }
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

// ---------------------------------------------------------------- window
function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  const x = Number.isFinite(settings.x) ? settings.x : wa.x + 120;
  const y = Number.isFinite(settings.y) ? settings.y : wa.y + wa.height - WIN_H;
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x, y,
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
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (process.env.CLAUDE_PET_DEBUG) {
    win.webContents.openDevTools({ mode: "detach" });
  }
  win.webContents.on("did-finish-load", () => {
    win.webContents.send("character", settings.character || "cat");
    win.webContents.send("pet-size", settings.petSize || 64);
    // show cached data instantly so the pet isn't blank while we wait
    if (lastUsage) {
      win.webContents.send("usage", { ...lastUsage, fetchedAt: settings.lastUsageAt || Date.now() });
    } else if (Date.now() < cooldownUntil) {
      win.webContents.send("usage-error", {
        code: "rate-limit",
        message: `被限流恢复中，约 ${Math.ceil((cooldownUntil - Date.now()) / 60000)} 分钟后自动重试`,
      });
    }
    scheduleNextPoll();
  });
}

// ---------------------------------------------------------------- polling
function persistRateState() {
  settings.cooldownUntil = cooldownUntil;
  settings.backoffLevel = backoffLevel;
  saveSettings();
}

// schedule the next automatic poll, always respecting cooldown
function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const now = Date.now();
  let wait = POLL_SECONDS * 1000;
  if (now < cooldownUntil) wait = Math.max(wait, cooldownUntil - now + 1000);
  // jitter ±15% so multiple clients (and restarts) don't sync up and hammer
  wait = Math.round(wait * (0.85 + Math.random() * 0.3));
  pollTimer = setTimeout(() => poll(), wait);
}

// manual=true comes from the refresh button / menu
async function poll(manual = false) {
  if (!win) return;
  const now = Date.now();

  // still cooling down from a rate-limit? don't even try
  if (now < cooldownUntil) {
    const mins = Math.max(1, Math.ceil((cooldownUntil - now) / 60000));
    win.webContents.send("usage-error", {
      code: "rate-limit",
      message: `被限流了，约 ${mins} 分钟后自动重试`,
    });
    scheduleNextPoll();
    return;
  }
  // hard floor between requests — protects against spamming ↻
  if (now - lastRequestAt < MIN_REFRESH_MS) {
    if (manual && lastUsage) {
      win.webContents.send("usage", { ...lastUsage, fetchedAt: settings.lastUsageAt || now });
    }
    scheduleNextPoll();
    return;
  }

  lastRequestAt = now;
  try {
    const creds = await readCredentials();
    if (!creds) {
      win.webContents.send("usage-error", { code: "no-credentials" });
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
      win.webContents.send("celebrate");
      new Notification({
        title: "Claude Pet",
        body: "🎉 5 小时额度已重置，宠物精神满满！",
      }).show();
    }
    if (pct !== null) prevFiveHourPct = pct;
    win.webContents.send("usage", { ...usage, fetchedAt: Date.now() });
  } catch (e) {
    if (e && e.status === 429) {
      // exponential backoff: 5 → 10 → 20 → 30(max) min
      const base = e.retryAfter ? e.retryAfter * 1000 : BACKOFF_MIN_MS;
      const backoff = Math.min(BACKOFF_MAX_MS, base * Math.pow(2, backoffLevel));
      backoffLevel = Math.min(backoffLevel + 1, 4);
      cooldownUntil = Date.now() + backoff;
      persistRateState();
      win.webContents.send("usage-error", {
        code: "rate-limit",
        message: `被限流了，约 ${Math.max(1, Math.ceil(backoff / 60000))} 分钟后自动重试`,
      });
    } else {
      win.webContents.send("usage-error", {
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

function buildTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "assets", "icon.png"))
    .resize({ width: 18, height: 18 });
  if (!tray) tray = new Tray(icon);
  updateTrayTitle();
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: win && win.isVisible() ? "隐藏宠物" : "显示宠物",
      click: () => { if (win.isVisible()) win.hide(); else win.show(); buildTray(); },
    },
    { type: "separator" },
    ...characterMenuItems(),
    { type: "separator" },
    {
      label: "宠物大小",
      submenu: [48, 64, 96].map((n, i) => ({
        label: ["小", "中", "大"][i],
        type: "radio",
        checked: (settings.petSize || 64) === n,
        click: () => setPetSize(n),
      })),
    },
    { label: "立即刷新用量", click: () => poll(true) },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
}

function setPetSize(n) {
  settings.petSize = n;
  saveSettings();
  if (win) win.webContents.send("pet-size", n);
  buildTray();
}

function setCharacter(ch) {
  settings.character = ch;
  saveSettings();
  if (win) win.webContents.send("character", ch);
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

// right-click menu on the pet itself (tray icons can hide under the notch)
ipcMain.on("show-menu", () => {
  if (!win) return;
  Menu.buildFromTemplate([
    ...characterMenuItems(),
    { type: "separator" },
    {
      label: "宠物大小",
      submenu: [48, 64, 96].map((n, i) => ({
        label: ["小", "中", "大"][i],
        type: "radio",
        checked: (settings.petSize || 64) === n,
        click: () => setPetSize(n),
      })),
    },
    { label: "立即刷新用量", click: () => poll(true) },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
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
    buildTray();
    // first poll is scheduled from did-finish-load (after cache is shown);
    // no fixed interval — poll() chains the next one via scheduleNextPoll()
  });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (pollTimer) clearTimeout(pollTimer);
  if (dragTimer) clearInterval(dragTimer);
});
