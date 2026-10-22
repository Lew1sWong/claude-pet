// Boss key — triple-tap Esc (globally) to slam a full-screen fake "work" screen
// over everything, hiding the pet (and whatever you were actually doing).
// Triple-Esc again dismisses it.
//
// Detecting triple-Esc *globally without swallowing the normal Esc key* needs a
// passive keyboard hook (node-global-key-listener), which on macOS requires
// Accessibility permission. If that hook is unavailable (not installed / no
// permission), we degrade gracefully: a global chord (⌘⇧B) always toggles, and
// once a disguise is showing the focused window catches triple-Esc locally.
const { BrowserWindow, screen, globalShortcut } = require("electron");
const path = require("path");

const DEFAULT_DISGUISES = ["terminal", "excel", "word", "code"];
const FALLBACK_CHORD = "CommandOrControl+Shift+B";

function createBossController(opts) {
  // opts: { rendererDir, preloadPath, getPetWindow, onShownChange }
  let bossWin = null;
  let shown = false;
  let petWasVisible = false;   // so we don't un-hide a pet the user hid on purpose
  let listener = null;
  let escTimes = [];
  let disguises = DEFAULT_DISGUISES.slice();
  let disguiseIdx = -1;
  let escCount = 3;
  let escWindow = 650;

  function buildBossWindow() {
    const b = screen.getPrimaryDisplay().bounds;
    bossWin = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false,
      backgroundColor: "#000000",
      resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, show: false,
      webPreferences: {
        preload: opts.preloadPath,
        backgroundThrottling: false,
      },
    });
    bossWin.setAlwaysOnTop(true, "screen-saver");
    bossWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    bossWin.loadFile(path.join(opts.rendererDir, "boss.html"));
    bossWin.on("closed", () => { bossWin = null; });
  }

  function show() {
    if (shown) return;
    if (!bossWin) buildBossWindow();
    // cover the (possibly changed) primary display
    const b = screen.getPrimaryDisplay().bounds;
    bossWin.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });

    const pet = opts.getPetWindow && opts.getPetWindow();
    petWasVisible = !!(pet && !pet.isDestroyed() && pet.isVisible());
    if (petWasVisible) pet.hide();

    disguiseIdx = (disguiseIdx + 1) % Math.max(1, disguises.length);
    const payload = {
      disguise: disguises[disguiseIdx] || "terminal", escCount, escWindow,
      exitHint: opts.getHint ? opts.getHint() : "",
    };
    const send = () => { if (bossWin && !bossWin.isDestroyed()) bossWin.webContents.send("boss-show", payload); };
    if (bossWin.webContents.isLoading()) bossWin.webContents.once("did-finish-load", send);
    else send();

    bossWin.show();
    bossWin.focus();
    bossWin.setAlwaysOnTop(true, "screen-saver");
    shown = true;
    if (opts.onShow) opts.onShow();   // achievement: count this activation
    if (opts.onShownChange) opts.onShownChange(true);
  }

  function hide() {
    if (!shown) return;
    if (bossWin && !bossWin.isDestroyed()) bossWin.hide();
    const pet = opts.getPetWindow && opts.getPetWindow();
    // only restore the pet if the boss screen is what hid it
    if (petWasVisible && pet && !pet.isDestroyed()) pet.show();
    shown = false;
    if (opts.onShownChange) opts.onShownChange(false);
  }

  function toggle() { shown ? hide() : show(); }

  function onEsc() {
    const now = Date.now();
    escTimes.push(now);
    escTimes = escTimes.filter((t) => now - t <= escWindow);
    if (escTimes.length >= escCount) { escTimes = []; toggle(); }
  }

  function startHook() {
    try {
      const { GlobalKeyboardListener } = require("node-global-key-listener");
      listener = new GlobalKeyboardListener();
      const started = listener.addListener((e) => {
        if (e && e.state === "DOWN" && e.name === "ESCAPE") onEsc();
      });
      // the helper binary is spawned lazily, so a spawn failure rejects here
      // asynchronously (e.g. EBADARCH: the stock x86_64 MacKeyServer on an
      // Apple-Silicon Mac without Rosetta) — never let it become an
      // unhandled rejection; ⌘⇧B keeps working
      if (started && typeof started.catch === "function") {
        started.catch((err) => {
          console.warn("[bossKey] global key hook failed to start — using ⌘⇧B fallback:", err && err.message);
          try { listener && listener.kill(); } catch { /* ignore */ }
          listener = null;
        });
      }
      return true;
    } catch (err) {
      console.warn("[bossKey] global key hook unavailable — using ⌘⇧B fallback:", err && err.message);
      listener = null;
      return false;
    }
  }

  function applySettings(s) {
    if (!s) return;
    if (Array.isArray(s.bossDisguises) && s.bossDisguises.length) disguises = s.bossDisguises.slice();
    if (Number.isFinite(s.bossEscCount) && s.bossEscCount >= 2) escCount = s.bossEscCount;
    if (Number.isFinite(s.bossEscWindow) && s.bossEscWindow >= 200) escWindow = s.bossEscWindow;
  }

  function start(settings) {
    applySettings(settings);
    const hookOk = startHook();
    try { globalShortcut.register(FALLBACK_CHORD, toggle); } catch { /* ignore */ }
    return hookOk;
  }

  function stop() {
    try { listener && listener.kill(); } catch { /* ignore */ }
    listener = null;
    try { globalShortcut.unregister(FALLBACK_CHORD); } catch { /* ignore */ }
    if (bossWin && !bossWin.isDestroyed()) bossWin.destroy();
    bossWin = null;
    shown = false;
  }

  return {
    start, stop, toggle, show, hide, applySettings,
    isShown: () => shown,
    hookActive: () => !!listener,
    fallbackChord: FALLBACK_CHORD,
  };
}

module.exports = { createBossController, DEFAULT_DISGUISES };
