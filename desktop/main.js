// Claude Pet — floating desktop pet (Electron main process)
const {
  app, BrowserWindow, Tray, Menu, screen, ipcMain, Notification, nativeImage,
  globalShortcut,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { readCredentials } = require("./lib/credentials");
const { fetchUsage, normalize, pickClaude, isOverage, computeMood } = require("./lib/usageClient");
const { pushSample, trendOf } = require("./lib/history");
const G = require("./lib/garden");
const { computeReport } = require("./lib/report");
const { currentSeason, seasonKey } = require("./lib/season");
const { collectOthers } = require("./lib/providers");
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
const WIN_H = 380;            // taller HUD: scoped limits / extra usage / breakdown / trend / garden
const LEGACY_WIN_H = 215;     // height before 0.2.0 — keeps a saved y stable across the bump
// Dynamic Island window — bigger than the pill itself so the expanded panel
// and drop-shadow have room; the actual capsule is sized/animated in CSS.
const ISLAND_W = 420;
const ISLAND_H = 500;
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
let prevFablePct = null;     // Fable gets its own threshold reminders
let prevWeekPct = null;      // weekly reset celebration
let prevWeekReset = null;    // weekly window's resets_at — a new one means a new week
let prevExtraPct = null;     // extra-usage (credits) threshold reminders
let prevOverage = null;      // plan limits hit while credits carry the load
const FABLE_THRESHOLDS = [80, 95];
const EXTRA_THRESHOLDS = [80, 95];
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
let garden = null;           // 🌱 pixel garden state (lib/garden.js), persisted in settings
let gardenTimer = null;      // grows between polls too

// ---------------------------------------------------------------- settings
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); }
  catch { settings = {}; }
  settingsLoaded = true;
  // restore rate-limit state so a restart can't bypass an active cooldown
  cooldownUntil = Number(settings.cooldownUntil) || 0;
  backoffLevel = Number(settings.backoffLevel) || 0;
  garden = G.sanitize(settings.garden);
  settings.history = Array.isArray(settings.history) ? settings.history : [];
  if (settings.lastUsage && settings.lastUsageAt) {
    // pre-0.2.0 caches carry `raw` and a bare `fable` (no label/key, no
    // `scoped`) — normalise once so every consumer sees the 0.2.0 contract
    lastUsage = { ...pickClaude(settings.lastUsage), others: settings.lastUsage.others || [] };
    prevFiveHourPct = lastUsage.fiveHour ? lastUsage.fiveHour.pct : null;
    prevFablePct = lastUsage.fable ? lastUsage.fable.pct : null;
    prevWeekPct = lastUsage.week ? lastUsage.week.pct : null;
    prevWeekReset = lastUsage.week ? lastUsage.week.resetsAt || null : null;
    prevExtraPct = lastUsage.extra && typeof lastUsage.extra.pct === "number" ? lastUsage.extra.pct : null;
    prevOverage = isOverage(lastUsage);
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
// default: usage tracking + garden ON, games + boss OFF (chosen at onboarding)
function featureFlags() {
  const f = settings.features || {};
  return { usage: f.usage !== false, games: !!f.games, boss: !!f.boss, garden: f.garden !== false, sound: !!f.sound };
}

// "1 天 3 小时" / "1 d 3 h" for notifications
function fmtDur(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "?";
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  if (h >= 24) return `${Math.floor(h / 24)} ${tr("cd.day")} ${h % 24} ${tr("cd.hour")}`;
  if (h > 0) return `${h} ${tr("cd.hour")} ${m} ${tr("cd.min")}`;
  return `${Math.max(1, m)} ${tr("cd.minute")}`;
}

// 📋 this week's report card (garden counters are relative to the snapshot
// taken at the last weekly reset)
function weekGardenOpts() {
  const snap = settings.weekGarden || null;
  const g = garden || G.newGarden();
  if (!snap) settings.weekGarden = { harvested: g.harvested, lost: g.lost, shooed: g.shooed };
  const s = settings.weekGarden;
  return {
    harvested: Math.max(0, g.harvested - s.harvested),
    lost: Math.max(0, g.lost - s.lost),
    shooed: Math.max(0, g.shooed - s.shooed),
    breakdown: lastUsage && lastUsage.breakdown ? lastUsage.breakdown.rows : null,
  };
}
function reportPayload(samples) {
  return computeReport(samples || settings.history, weekGardenOpts(), Date.now());
}

// ⛈ pace alarm: once per window instance when the forecast says the window
// runs dry before its reset (5h: only "storm"; weekly: "rain" or "storm")
function checkPaceAlarms(u, trend) {
  if (!u || !trend) return;
  const al = settings.paceAlarm || (settings.paceAlarm = {});
  for (const key of ["f", "w"]) {
    const o = key === "f" ? trend.five : trend.week;
    const win = key === "f" ? u.fiveHour : u.week;
    const id = win && win.resetsAt ? String(win.resetsAt) : null;
    if (!o || !id) continue;
    const bad = key === "f" ? o.weather === "storm" : (o.weather === "storm" || o.weather === "rain");
    // an already-dry window has no ETA (the depleted/overage moods cover it);
    // a weekly window only alarms once it's meaningfully underway
    const underway = key === "f" || (win.pct >= 30);
    if (bad && underway && typeof o.etaMs === "number" && al[key] !== id) {
      al[key] = id;
      notify(tr(`trend.alarm.${key}`).replace("{eta}", fmtDur(o.etaMs)).replace("{reset}", fmtDur(o.resetMs)));
      sendToWin("sfx", "warn");
    }
  }
}

// ---- 🌱 garden: grows at the pace of the current mood, persisted in settings ----
function gardenPayload() {
  return { ...garden, lastHarvest: settings.gardenLastHarvest || null };
}
function gardenTick(send) {
  if (!garden || !featureFlags().garden) return;
  const before = JSON.stringify(garden.plots);
  G.tick(garden, computeMood(lastUsage), Date.now());
  settings.garden = garden;
  // 🐦‍⬛ a crow landed → one toast per visit; a crop got eaten → one toast per loss
  const ci = G.crowAt(garden);
  if (ci >= 0) {
    const since = garden.plots[ci].crow.since;
    if (settings.crowNotified !== since) {
      settings.crowNotified = since;
      notify(tr("crow.notify").replace("{crop}", tr("crop." + garden.plots[ci].crop)));
      sendToWin("sfx", "crow");
    }
  }
  if (garden.lastLoss && settings.lossNotified !== garden.lastLoss.at) {
    settings.lossNotified = garden.lastLoss.at;
    notify(tr("crow.lost").replace("{crop}", tr("crop." + garden.lastLoss.crop)));
  }
  if (send && JSON.stringify(garden.plots) !== before) sendToWin("garden", gardenPayload());
}
function saveGarden() {
  settings.garden = garden;
  saveSettings();
  sendToWin("garden", gardenPayload());
  // the report card counts harvests / losses / shoos — refresh it right away
  // instead of waiting for the next poll
  if (lastUsage) sendToWin("usage", { ...usagePayload(lastUsage), fetchedAt: settings.lastUsageAt || Date.now() });
}
// usage + the trend computed from the persisted history, as the renderer expects it
function usagePayload(u) {
  return {
    ...u,
    trend: trendOf(settings.history, u, Date.now()),
    report: reportPayload(),
    lastReport: settings.lastReport || null,
    season: currentSeason(new Date()),
  };
}

// 🎃 one greeting per season (and per year), with a little fanfare
function maybeGreetSeason() {
  const s = currentSeason(new Date());
  const key = seasonKey(s);
  if (!key || settings.seasonGreeted === key) return;
  settings.seasonGreeted = key;
  saveSettings();
  notify(tr("season." + s.id));
  sendToWin("sfx", "level");
}

// which usage sources to poll: Claude on by default; Codex / OpenClaw(龙虾) /
// custom JSON are opt-in from Settings
function providerFlags() {
  const p = settings.providers || {};
  return {
    claude: p.claude !== false,
    codex: !!p.codex,
    openclaw: !!p.openclaw,
    custom: !!p.custom,
    customPath: typeof p.customPath === "string" ? p.customPath.trim() : "",
  };
}

// ---- custom pixel buddies (loved ones pixelated in Settings) ----
const BUDDY_MAX = 8;
function sanitizeCustomPets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list.slice(0, BUDDY_MAX)) {
    try {
      if (!p || typeof p !== "object") continue;
      if (!/^buddy-[a-z0-9]{1,24}$/.test(String(p.id))) continue;
      const name = String(p.name || "❤").slice(0, 12);
      const palette = {};
      let ok = true;
      const entries = Object.entries(p.palette || {}).slice(0, 12);
      if (!entries.length) continue;
      for (const [k, v] of entries) {
        if (!/^[a-z]$/.test(k) || !/^#[0-9a-fA-F]{6}$/.test(String(v))) { ok = false; break; }
        palette[k] = String(v);
      }
      if (!ok) continue;
      const frames = {};
      for (const st of ["idle", "walk", "sleep"]) {
        const fr = p.frames && p.frames[st];
        if (!Array.isArray(fr) || fr.length < 1 || fr.length > 8) { ok = false; break; }
        for (const f of fr) {
          if (!Array.isArray(f) || f.length !== 16) { ok = false; break; }
          for (const row of f) {
            if (typeof row !== "string" || row.length !== 16 ||
                ![...row].every((c) => c === "." || palette[c])) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) break;
        frames[st] = fr;
      }
      if (ok) out.push({ id: p.id, name, palette, frames });
    } catch { /* drop invalid buddy */ }
  }
  return out;
}

// ---- achievements (彩蛋): 10 boss uses → 潜行大师, 10 game clears → 游戏达人,
// 10 harvests → 丰收达人
const ACH_GOAL = 10;
function statsNow() {
  const s = settings.stats || {};
  return { bossUses: s.bossUses || 0, gameClears: s.gameClears || 0, harvests: s.harvests || 0, shoos: s.shoos || 0 };
}
function bumpStat(kind) {
  const map = { boss: "bossUses", game: "gameClears", harvest: "harvests", crow: "shoos" };
  const k = map[kind];
  if (!k) return;
  const st = statsNow();
  const before = st[k];
  st[k] = before + 1;
  settings.stats = st;
  saveSettings();
  if (before < ACH_GOAL && st[k] >= ACH_GOAL) {
    // newly unlocked → toast + the pet celebrates
    const title = tr({ boss: "ach.boss.title", harvest: "ach.harvest.title", crow: "ach.crow.title" }[kind] || "ach.game.title");
    sendToWin("sfx", "level");
    notify(tr("ach.toast") + title);
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
    // the window grew in 0.2.0; shift a saved y so the pet's feet stay put,
    // clamping against the display the pet was parked on (not the primary —
    // external monitors can sit above/below it with their own y-range)
    const savedH = Number.isFinite(settings.winH) ? settings.winH : LEGACY_WIN_H;
    const x = Number.isFinite(settings.x) ? settings.x : wa.x + 120;
    let y = Number.isFinite(settings.y) ? settings.y + (savedH - WIN_H) : wa.y + wa.height - WIN_H;
    const own = screen.getDisplayMatching({ x, y, width: WIN_W, height: WIN_H }).workArea;
    y = Math.max(own.y, Math.min(y, own.y + own.height - WIN_H));
    geom = { width: WIN_W, height: WIN_H, x, y };
    if (Number.isFinite(settings.y)) { settings.y = y; settings.winH = WIN_H; }
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
      // 🔊 8-bit sfx (opt-in) play without a click on the never-focused window
      autoplayPolicy: "no-user-gesture-required",
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
    // custom pixel buddies must merge into SPRITES before the character is set
    sendToWin("custom-pets", settings.customPets || []);
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
    sendToWin("garden", gardenPayload());
    if (lastUsage) {
      sendToWin("usage", { ...usagePayload(lastUsage), fetchedAt: settings.lastUsageAt || Date.now() });
    } else if (Date.now() < cooldownUntil) {
      sendToWin("usage-error", {
        code: "rate-limit",
        message: tr("err.rateIn").replace("{min}", String(Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000)))),
      });
    }
    // fetch right away when the cache is older than one poll interval (poll()
    // still honours the rate-limit cooldown and the MIN_REFRESH floor);
    // otherwise just arm the regular timer
    const stale = !settings.lastUsageAt || Date.now() - settings.lastUsageAt > POLL_SECONDS * 1000;
    if (stale && featureFlags().usage) poll();
    else scheduleNextPoll();
    maybeGreetSeason();
    // CLAUDE_PET_SMOKE=1: after the first poll, print what the HUD rendered
    // and the normalized usage, so a headless boot can prove the renderer works
    if (process.env.CLAUDE_PET_SMOKE) {
      setTimeout(async () => {
        try {
          const txt = await win.webContents.executeJavaScript(
            "(function(){const h=document.getElementById('hud')||document.querySelector('.body');return h?h.textContent.replace(/\\s+/g,' ').trim():'(no hud)';})()");
          console.log("SMOKE HUD:", JSON.stringify(txt));
          console.log("SMOKE usage:", JSON.stringify(lastUsage ? pickClaude(lastUsage) : null));
          // CLAUDE_PET_SMOKE_SHOT=/path.png: force the HUD open and capture it
          if (process.env.CLAUDE_PET_SMOKE_SHOT) {
            await win.webContents.executeJavaScript(
              "(function(){const h=document.getElementById('hud');if(h)h.classList.remove('hidden');const i=document.getElementById('island');if(i){i.classList.remove('collapsed');i.classList.add('expanded');}const r=document.getElementById('report');if(r&&process_env_report)r.click();})()".replace("process_env_report", process.env.CLAUDE_PET_SMOKE_REPORT ? "true" : "false"));
            await new Promise((r) => setTimeout(r, 700));
            const img = await win.webContents.capturePage();
            fs.writeFileSync(process.env.CLAUDE_PET_SMOKE_SHOT, img.toPNG());
            console.log("SMOKE shot:", process.env.CLAUDE_PET_SMOKE_SHOT, img.getSize());
          }
        } catch (e) { console.log("SMOKE error:", String((e && e.message) || e)); }
      }, 15000);
    }
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
    providers: providerFlags(),
    customPets: settings.customPets || [],
    onboarded: !!settings.onboarded,
    stats: statsNow(),
    achGoal: ACH_GOAL,
  };
}

// macOS: dock.hide() within ~1 s of dock.show() is a documented no-op
// (Electron ≥45 dock.md), so a quick open/close of Settings would leave the
// accessory app stuck in the Dock — defer the hide past that window
let dockShownAt = 0;
function dockShow() {
  if (process.platform !== "darwin" || !app.dock) return;
  app.dock.show();
  dockShownAt = Date.now();
}
function dockHide() {
  if (process.platform !== "darwin" || !app.dock) return;
  const wait = Math.max(0, 1100 - (Date.now() - dockShownAt));
  setTimeout(() => {
    if (isQuitting) return;
    if (!settingsWin || settingsWin.isDestroyed()) app.dock.hide();
  }, wait);
}

function openSettings(opts) {
  const onboarding = !!(opts && opts.onboarding);
  // mark onboarded immediately so it only ever auto-pops once
  if (onboarding && !settings.onboarded) { settings.onboarded = true; saveSettings(); }
  // this is a dock-hidden accessory app; show the dock so the settings window
  // can come to the front and take focus over whatever app is active
  dockShow();
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
    dockHide(); // back to accessory
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
  if (p.providers !== undefined) {
    settings.providers = { ...providerFlags(), ...p.providers };
    // reflect the new sources promptly (Claude itself stays behind its
    // MIN_REFRESH floor, so toggling checkboxes can't hammer the API)
    if (featureFlags().usage && win) poll(true);
  }
  if (p.customPets !== undefined) {
    settings.customPets = sanitizeCustomPets(p.customPets);
    const ids = new Set(settings.customPets.map((x) => x.id));
    if (String(settings.character || "").startsWith("buddy-") && !ids.has(settings.character)) {
      settings.character = "cat";
      sendToWin("character", "cat");
    }
    sendToWin("custom-pets", settings.customPets);
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

function notify(body) {
  try {
    const n = new Notification({ title: tr("app.name"), body });
    // Electron ≥42 uses UNNotification on macOS, which needs a code-signed app;
    // an unsigned dev build emits "failed" instead of throwing — log, don't die
    n.on("failed", (_e, err) => console.warn("[notify] notification failed:", err));
    n.show();
  } catch { /* ignore */ }
}
// highest threshold crossed upward between two readings (or null)
function crossed(prev, cur, thresholds) {
  if (prev === null || cur === null) return null;
  for (const th of thresholds.slice().reverse()) if (prev < th && cur >= th) return th;
  return null;
}

// reset celebrations (5h / weekly), Fable's dedicated threshold reminders
// (80% / 95%) and extra-usage (credits) alerts; runs only on a FRESH Claude
// fetch so cached re-sends can't re-toast
function checkClaudeNotifications(usage) {
  const pct = usage.fiveHour ? usage.fiveHour.pct : null;
  if (prevFiveHourPct !== null && pct !== null && prevFiveHourPct >= 80 && pct <= prevFiveHourPct - 50) {
    sendToWin("celebrate");
    sendToWin("sfx", "reset");
    notify(tr("celebrate.reset"));
    if (garden) { G.water(garden); saveGarden(); }   // a reset waters the garden
  }
  if (pct !== null) prevFiveHourPct = pct;

  const wk = usage.week ? usage.week.pct : null;
  const wkReset = usage.week ? usage.week.resetsAt || null : null;
  // a new weekly window: the % dropped like report.js detects it, or the
  // reset time jumped by more than a day (catches resets the app slept through)
  const newWeek = (prevWeekPct !== null && wk !== null && wk < prevWeekPct - 15) ||
    (prevWeekReset && wkReset && Date.parse(wkReset) - Date.parse(prevWeekReset) > 24 * 3600e3);
  if (newWeek) {
    // 📋 grade the week that just ended (history minus the post-reset sample)
    const rep = reportPayload(settings.history.slice(0, -1));
    if (rep && rep.grade) {
      settings.lastReport = { ...rep, at: Date.now() };
      notify(tr("report.notify").replace("{grade}", rep.grade).replace("{title}", tr("title." + rep.title))
        .replace("{pct}", String(Math.round(rep.usedPct || 0))).replace("{n}", String(rep.depletions)));
    }
    const g = garden || G.newGarden();
    settings.weekGarden = { harvested: g.harvested, lost: g.lost, shooed: g.shooed };
  }
  if (prevWeekPct !== null && wk !== null && prevWeekPct >= 50 && wk <= prevWeekPct - 40) {
    // a big reset is worth a party (and waters the garden)
    sendToWin("celebrate");
    sendToWin("sfx", "reset");
    if (!(newWeek && settings.lastReport && Date.now() - settings.lastReport.at < 5000)) notify(tr("celebrate.weekReset"));
    if (garden) { G.water(garden); saveGarden(); }
  }
  if (wk !== null) prevWeekPct = wk;
  if (wkReset) prevWeekReset = wkReset;

  const f = usage.fable ? usage.fable.pct : null;
  if (f !== null && prevFablePct !== null) {
    const th = crossed(prevFablePct, f, FABLE_THRESHOLDS); // one Fable toast per poll
    if (th !== null) notify(tr(th >= 95 ? "fable.warn95" : "fable.warn80").replace("{pct}", String(Math.round(f))));
    if (prevFablePct >= 80 && f <= prevFablePct - 50) {
      sendToWin("celebrate");
      notify(tr("fable.reset"));
    }
  }
  if (f !== null) prevFablePct = f;

  // extra usage: one toast when credits start carrying the load, then at
  // 80% / 95% of the monthly cap
  const over = isOverage(usage);
  if (prevOverage === false && over) {
    const ex = usage.extra;
    notify(tr("extra.on") + (ex && typeof ex.pct === "number" ? ` (${Math.round(ex.pct)}%)` : ""));
  }
  prevOverage = over;
  const ex = usage.extra && usage.extra.enabled && typeof usage.extra.pct === "number" ? usage.extra.pct : null;
  if (ex !== null && prevExtraPct !== null) {
    const th = crossed(prevExtraPct, ex, EXTRA_THRESHOLDS);
    if (th !== null) notify(tr(th >= 95 ? "extra.warn95" : "extra.warn80").replace("{pct}", String(Math.round(ex))));
  }
  prevExtraPct = ex;
}

// manual=true comes from the refresh button / menu
async function poll(manual = false) {
  if (isQuitting || !win || win.isDestroyed()) return;
  const flags = providerFlags();
  // other agents (Codex / OpenClaw 龙虾 / custom JSON) poll in parallel with
  // Claude; collectOthers never rejects and times out internally
  const othersPromise = collectOthers(flags);
  const now = Date.now();

  let fresh = null;          // fresh Claude usage from THIS round
  let claudeError = false;   // an error was already reported to the renderer

  // CLAUDE_PET_FIXTURE=/path/to/payload.json — dev/offline mode: replay a
  // captured usage payload instead of calling the API (no credentials needed)
  const fixture = process.env.CLAUDE_PET_FIXTURE || "";
  if (flags.claude) {
    if (!fixture && now < cooldownUntil) {
      // still cooling down from a rate-limit? don't even try
      const mins = Math.max(1, Math.ceil((cooldownUntil - now) / 60000));
      sendToWin("usage-error", {
        code: "rate-limit",
        message: tr("err.rateIn").replace("{min}", String(mins)),
      });
      claudeError = true;
    } else if (fixture || now - lastRequestAt >= MIN_REFRESH_MS) {
      lastRequestAt = now;
      try {
        const creds = fixture ? null : await readCredentials();
        if (!creds && !fixture) {
          sendToWin("usage-error", { code: "no-credentials" });
          claudeError = true;
        } else {
          fresh = fixture
            ? normalize(JSON.parse(fs.readFileSync(fixture, "utf8")))
            : await fetchUsage(creds.accessToken);
          // success — clear any backoff
          backoffLevel = 0;
          cooldownUntil = 0;
        }
      } catch (e) {
        claudeError = true;
        if (e && e.status === 429) {
          // exponential backoff: 5 → 10 → 20 → 30(max) min
          const base = e.retryAfter ? e.retryAfter * 1000 : BACKOFF_MIN_MS;
          const backoff = Math.min(BACKOFF_MAX_MS, base * Math.pow(2, backoffLevel));
          backoffLevel = Math.min(backoffLevel + 1, 4);
          cooldownUntil = Date.now() + backoff;
          persistRateState();
          sendToWin("usage-error", {
            code: "rate-limit",
            message: tr("err.rateIn").replace("{min}", String(Math.max(1, Math.ceil(backoff / 60000)))),
          });
        } else {
          sendToWin("usage-error", {
            code: e && e.status === 401 ? "auth" : "fetch",
            message: String((e && e.message) || e),
          });
        }
      }
    }
    // else: under the manual-refresh floor — reuse cached Claude numbers below
  }

  const others = await othersPromise;

  if (!claudeError && !isQuitting) {
    // never persist / forward the raw payload — only the renderer contract
    const base = pickClaude(fresh || (flags.claude && lastUsage ? lastUsage : {}));
    const merged = { ...base, others };
    lastUsage = merged;
    settings.lastUsage = merged;
    settings.lastUsageAt = Date.now();
    if (fresh) {
      // 📈 one history sample per fresh fetch (feeds the sparklines + forecast)
      settings.history = pushSample(settings.history, {
        t: Date.now(),
        f: fresh.fiveHour ? fresh.fiveHour.pct : null,
        w: fresh.week ? fresh.week.pct : null,
      }, Date.now());
    }
    gardenTick(false);
    persistRateState();
    updateTrayTitle();
    if (fresh) checkClaudeNotifications(fresh);
    const payload = usagePayload(merged);
    if (fresh) checkPaceAlarms(merged, payload.trend);
    sendToWin("usage", { ...payload, fetchedAt: Date.now() });
    sendToWin("garden", gardenPayload());
    maybeGreetSeason();   // a season that starts while the app is running
  }
  scheduleNextPoll();
}

// ---------------------------------------------------------------- tray
function updateTrayTitle() {
  if (!tray) return;
  const u = lastUsage;
  const pctTxt = u && u.fiveHour ? `${Math.round(u.fiveHour.pct)}%` : null;
  const over = isOverage(u);
  // macOS shows text beside the tray icon; Windows/Linux only have a tooltip
  if (process.platform === "darwin") {
    tray.setTitle(over ? " 🐾💸" : pctTxt ? ` 🐾${pctTxt}` : " 🐾", { fontType: "monospacedDigit" });
  }
  const season = currentSeason(new Date());
  const parts = ["Claude Pet" + (season ? " " + season.fx[0] : "")];
  if (pctTxt) parts.push(`5h ${pctTxt}`);
  if (u && u.week) parts.push(`${tr("hud.week")} ${Math.round(u.week.pct)}%`);
  for (const s of (u && Array.isArray(u.scoped) ? u.scoped : [])) parts.push(`${s.label || "?"}✦ ${Math.round(s.pct)}%`);
  if (u && u.extra && u.extra.enabled) {
    parts.push(`💸 ${typeof u.extra.pct === "number" ? Math.round(u.extra.pct) + "%" : tr("hud.extra")}`);
  }
  tray.setToolTip(parts.join(" · "));
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
    settings.winH = WIN_H;
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
  if (win && !win.isDestroyed() && gameSavedBounds) {
    win.setBounds(gameSavedBounds);
    // island lives at y=0 over the menu bar; re-assert so it isn't re-clamped
    if (uiMode() === "island") win.setBounds(gameSavedBounds);
  }
  gameSavedBounds = null;
});

// boss-key: renderer fallbacks (local triple-Esc inside the disguise window)
ipcMain.on("boss-dismiss", () => { if (boss) boss.hide(); });
ipcMain.on("boss-toggle", () => { if (boss) boss.toggle(); });

// achievements: a mini-game was cleared
ipcMain.on("stat-bump", (_e, kind) => bumpStat(kind));

// 🌱 garden: plant an empty plot / harvest a ripe one
ipcMain.on("garden-plant", (_e, i, crop) => {
  if (!garden) return;
  gardenTick(false);
  const season = currentSeason(new Date());
  if (G.plant(garden, Number(i), typeof crop === "string" ? crop : null, Date.now(), season ? season.crop : null)) saveGarden();
});
ipcMain.on("garden-shoo", (_e, i) => {
  if (!garden) return;
  if (G.shoo(garden, Number(i), Date.now())) {
    saveGarden();
    bumpStat("crow");
  }
});
ipcMain.on("garden-harvest", (_e, i) => {
  if (!garden) return;
  gardenTick(false);
  const crop = G.harvest(garden, Number(i));
  if (!crop) return;
  settings.gardenLastHarvest = { crop, at: Date.now() };
  saveGarden();
  bumpStat("harvest");
});

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
    // 🌱 the garden keeps growing between polls (mood is stable in between)
    gardenTimer = setInterval(() => gardenTick(true), 60 * 1000);
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
  if (gardenTimer) { clearInterval(gardenTimer); gardenTimer = null; }
  try { gardenTick(false); } catch { /* ignore */ }
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
