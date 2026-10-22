# Changelog

## 0.2.0 — 2026-10-22 · "跟上 Claude 的新额度体系"

Verified against Claude Code 2.1.280 and a live capture of the usage endpoint
(`desktop/test/fixtures/usage-2026-10.json`). Highlights, in order of impact:

### Usage data (desktop + web)
- **Fable ✦ bar works again.** The usage API now lists model-scoped weekly
  windows inside a structured `limits[]` array (`kind: weekly_scoped`,
  `scope.model.display_name: "Fable"`) instead of a top-level key, so the old
  key-name match silently found nothing. The parser now reads `limits[]` first
  (session / weekly_all / weekly_scoped) and keeps the legacy
  `five_hour` / `seven_day` / `seven_day_opus` keys as a fallback.
- **Every scoped window gets a row**, labelled from the API (violet for Fable,
  teal for anything else), with its share of the weekly allowance on hover
  (`weekly_scoped_shares`). The tray tooltip lists all of them.
- **Extra usage 💸** (`extra_usage` + `spend`, i.e. usage credits past the plan
  limits): gold bar with the share of the monthly cap and the amount spent.
- **New mood: overage.** Plan limits dry but credits carrying the load → the pet
  keeps working, paces, nags about the bill (quips in zh/en), tray shows 💸.
  Notifications when credits kick in and at 80% / 95% of the cap.
- **Weekly breakdown** one-liner ("This week: Claude Code 79% · Cowork 19% …",
  `seven_day_breakdown`).
- **Locked windows** (`locked_reason`) count as exhausted and are explained in
  the HUD instead of a bogus countdown. Dollar-denominated windows
  (`limit_dollars` / `used_dollars`) derive a percentage.
- **Weekly reset celebration** (previously only the 5h reset celebrated).
- The depleted message now counts down the window that actually blocks you
  (latest reset of the exhausted ones), not always the 5h one.
- Cached usage no longer includes the raw payload (smaller `settings.json`,
  less IPC traffic).
- **First poll is immediate** when the cached data is older than one poll
  interval; previously the pet showed stale numbers for ~5 minutes after launch.
- Web PWA: same parser, Fable ✦ / scoped rows, extra-usage row, breakdown line,
  manual Fable %, demo data shows the new rows. Service-worker cache bumped.

### Boss key on Apple Silicon
- `node-global-key-listener` ships an **x86_64-only** `MacKeyServer`; on an
  arm64 Mac without Rosetta it failed to spawn (`EBADARCH`, "Unknown system
  error -86") as an *unhandled promise rejection*, so global triple-Esc never
  worked there. The postinstall step now rebuilds it natively with `swiftc`
  from the vendored source (`desktop/vendor/MacKeyServer`), and the spawn
  failure is caught with a clear warning (⌘⇧B keeps working).

### Platform
- **Electron 33 → 45** (33 has been end-of-life since April 2025 and lacks
  the macOS Tahoe/27 fixes); electron-builder 26.15 → 26.18. Electron ≥42 no
  longer downloads its binary at `npm install` — the first `npm start` does.
  Electron 44+ requires **macOS 13+** and no longer ships Windows 32-bit
  builds (the app only targets x64 anyway). The double-click launchers
  (`启动桌宠.command` / `.bat`) now download the binary explicitly and visibly
  (`npx install-electron`) instead of letting a detached first launch stall.
- Notifications register a `failed` listener (Electron ≥42 uses
  UNNotification on macOS, which wants a code-signed app) and Dock show/hide
  around the Settings window respects the documented 1-second no-op rule.
- `npm run dist:mac` no longer aborts on the 256px icon: `tools/sprites.py`
  now emits a 1024px `assets/icon.png`. Verified with an unsigned arm64
  `--dir` build (native key-server lands in `app.asar.unpacked`).

### Quality
- `npm test` (plain `node --test`): parser tests on the captured payload and
  legacy shapes, mood tests (renderer logic vs main-process helpers kept in
  lock-step), and a parity test that extracts the web app's copy of the
  parser and compares it with the desktop one.
- i18n: rate-limit messages, pause/resume lines and the reset celebration in
  the floating pet now go through the string table.
- Dynamic Island: the message box is now counted when sizing the expanded
  capsule; host window grown to 420px for the extra rows. Floating window grown
  to 260px (saved positions are shifted so the pet's feet stay put); the HUD
  scrolls instead of clipping when many sources are enabled.
- Dev env vars: `CLAUDE_PET_FIXTURE=<payload.json>` replays a captured usage
  payload instead of calling the API (no credentials / network — the live
  endpoint rate-limits quickly); `CLAUDE_PET_SMOKE=1` prints what the HUD
  rendered + the normalized usage 15 s after boot. Both used to verify this
  release headlessly in float and island mode.

## 0.1.0
- Initial desktop pet (Electron, macOS / Windows), Dynamic Island, mini-games,
  boss key, settings / i18n, achievements, multi-agent usage sources, pixel
  buddies, mobile PWA.
