# Changelog

## 0.8.0 — 2026-10-27 · "晒成绩单 + 好周有奖"

### 📤 Shareable report card
- A 📤 button on the weekly report card renders a 600×340 pixel card (the
  pet with its hat, grade, title, stats, a tip and the weekly quota line)
  as a PNG. Desktop: saved to Downloads and copied to the clipboard. Web:
  the Web Share sheet with the image on phones, a download elsewhere.

### 🌟 Good week, faster garden
- An **S** grade on the weekly report gives the garden ×1.3 growth for the
  next 7 days, an **A** ×1.15 (shown in the garden hint). No penalty for
  worse weeks. Desktop + web.

## 0.7.0 — 2026-10-27 · "灵动岛一眼看懂 + 可测试的提醒"

### 🏝 Dynamic Island pill badge
- The collapsed pill used to show only the 5h %. It now carries a badge
  left of the number: 🐦‍⬛ when a crow is on a crop (shakes; click to
  expand and shoo), otherwise the quota weather (🌤 🌧 ⛈) when it isn't
  sunny, otherwise the season's emoji. Nothing when all is calm.

### 🔔 Alert logic extracted and tested
- Every notification decision — 5h / weekly / Fable resets, the weekly
  grading trigger, Fable 80 / 95, usage-credit on / 80 / 95, pace alarms
  with their once-per-window gating — now lives in `lib/alerts.js` as a
  pure `evaluate(prev, usage, trend)` returning events + next state, with
  a test suite covering restarts (state restored from the cached payload),
  threshold jumps, slept-through resets and alarm de-duplication. The main
  process and the PWA only perform the side effects.
- The PWA now also gets the Fable reminders, the Fable reset celebration
  and the usage-credit alerts (it only had resets and pace alarms before);
  its alert state persists in `cp_alerts` (older keys migrated).

## 0.6.0 — 2026-10-26 · "应季彩蛋"

### 🎃🎄🎆🧧 Seasons (desktop + web)
- `lib/season.js` knows four seasons: Halloween (Oct 20 – Nov 2), Christmas
  (Dec 18 – 27), New Year (Dec 31 – Jan 2) and Lunar New Year (除夕 → 初六,
  per-year table through 2030). While one is on:
  - the pet wears a hat 🎩 — witch / santa / party (hand-drawn overlays that
    bob with the idle breath and come off while asleep)
  - a greeting notification once per season (with the achievement fanfare if
    sounds are on), seasonal quips in the bubble, seasonal celebration emoji,
    the season's emoji next to the pet's name and in the tray tooltip
  - **Halloween adds a 🎃 pumpkin** to the garden rotation (7 h at full pace).
    Pumpkins planted during the season keep growing after it ends.
- Everything flows through the shared modules, so the PWA gets it too.

## 0.5.0 — 2026-10-26 · "手机版补齐"

### 📱 Web / PWA parity
- The PWA now runs the **same code** as the desktop app: `desktop/scripts/sync-web.js`
  (`npm run sync-web`) generates `web/shared/*.js` from the desktop modules —
  usage parser + mood, history & forecast, garden + crow, weekly report
  card, zh/en strings, sprites, the 8-bit synth and the HUD renderers. A test
  fails when the generated files are stale. `web/app.js` is page glue only.
- Everything the desktop got in 0.3.0 / 0.4.0 is on the phone: scoped-limit
  and usage-credit rows, the weekly breakdown, 📈 sparklines + ⛈ quota
  weather with pixel rain and lightning, pace alarms, 🌱 garden with the
  🐦‍⬛ crow, 📋 report cards with titles (graded at the weekly reset),
  context-aware quips, yawn/stretch micro-animations.
- New in Settings: language (follow system / 中文 / English), 8-bit sounds,
  and opt-in system notifications (crow, losses, alarms, resets, report
  cards — delivered when the tab is in the background).
- Demo mode ships a two-day synthetic history so the sparklines, weather and
  report card show without any setup. Service-worker cache bumped (v4).

## 0.4.0 — 2026-10-24 · "乌鸦、天气和成绩单"

### 🐦‍⬛ The crow
- Leave a ripe crop unharvested for 8 h and a crow lands on it (animated,
  the plot shakes, a notification + caw). Ignore it for 4 more hours and it
  flies off with the crop. Click the crow to shoo it (new 🐦‍⬛ *Scarecrow*
  medal at 10 shoos). Losses and shoos show up on the weekly report card.
  The crow's clocks only run while the app is running — a sleeping laptop
  or a closed app never costs you a crop.

### ⛈ Live quota weather
- The forecast now has visuals: pixel rain over the HUD when the window is
  going to run dry before the reset, heavier rain + lightning flashes (and
  thunder, if sounds are on) when it's running dry fast, floating sparkles
  when you're fine.
- **Pace alarm**: one notification per window instance when the forecast
  turns bad ("⛈ 照这速度 5h 额度 1 小时 12 分 后见底，离重置还有 3 小时").
  The weekly forecast averages over up to 48 h (nights and weekends count)
  and waits for 12 h of data after a reset; the weekly alarm also waits
  until the window is ≥30 % used. Thunder plays at most once a minute (in
  the Dynamic Island only while it's expanded).

### 📋 Weekly report card + titles
- 📋 button in the HUD opens the card: grade S/A/B/C (score from
  depletions, close calls, late-night share, evenness, crow losses), a
  playful title — 烧 token 狂魔 / 夜猫子 / 周末战士 / 佛系用户 / 周一冲刺手 /
  节奏大师 / 种田能手 / 稳健开发者 — heaviest day, late-night share, garden
  stats and up to two tips. At every weekly reset the finished week is
  graded (light weeks too, and resets that happened while the app slept),
  pushed as a notification and the card pops open.

### 🔊 8-bit sounds (off by default)
- WebAudio-synthesized blips, no asset files: plant, harvest, shoo, crow,
  reset jingle, warning, thunder, achievement. Settings → Features → Sound.

### 🗣 Context-aware quips
- The pet now comments on late-night sessions, Mondays, Fridays, weekends,
  Fable-heavy weeks, Cowork-heavy or Claude-Code-only weeks (zh/en).

## 0.3.0 — 2026-10-23 · "菜园与天气预报"

### 🌱 Pixel garden (desktop)
- Three plots under the usage bars (and in the Dynamic Island's lower area).
  Click an empty plot to plant (carrot 🥕 → tomato 🍅 → sunflower 🌻 in
  turn), ripe crops glow — click to harvest and the pet eats it on the spot.
- Growth pace follows the pet's mood: happy 1×, calm 0.8×, sleepy 0.45×,
  anxious / overage 0.15×, depleted 0× (the plant gets thirsty 💧 and wilts;
  it recovers when you ration again). Every quota reset waters the garden.
- Carrots take ~5 h at full pace, tomatoes ~9 h, sunflowers ~14 h; growth
  continues between polls and while the app is closed (catch-up capped at
  6 h). State lives in `settings.json`; toggle in Settings → Features.
- New achievement 🌱 "Harvest Master" (10 harvests).

### 📈 Trend sparklines + quota weather (desktop)
- Every fresh poll is recorded (7 days of history). The HUD shows two
  8-bit sparklines: the 5h window over the last 6 hours and the weekly
  window over 7 days (resets show as sawtooth drops).
- A burn-rate forecast (least-squares over the recent samples, reset-aware)
  projects when the window would hit 100 % and compares it with the reset:
  ☀️ fine · 🌤 tight · 🌧 runs dry before the reset · ⛈ in the first half of
  the remaining time. The pet quips about the pace when it turns bad.

### Housekeeping
- Floating window 260 → 380 px and island host 420 → 500 px (saved
  positions compensated); `CLAUDE_PET_SMOKE_SHOT=<png>` captures the HUD.

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
