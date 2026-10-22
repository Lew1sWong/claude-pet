# MacKeyServer (vendored)

Source of the macOS helper that `node-global-key-listener` spawns for the
boss-key global triple-Esc hook.

- Upstream: https://github.com/LaunchMenu/node-global-key-listener
  (`src/bin/MacKeyServer/main.swift`, master, fetched 2026-10-22; MIT — see LICENSE).
- The npm package (0.3.0) only ships a **x86_64** `bin/MacKeyServer`. On an
  Apple-Silicon Mac without Rosetta it fails to spawn (`EBADARCH`, "Unknown
  system error -86"), so the global hook silently never started.
- `scripts/fix-keyserver-perms.js` (postinstall) rebuilds it natively with
  `swiftc` when the host is `darwin`/`arm64` and the shipped binary has no
  arm64 slice. Without the Xcode Command Line Tools it leaves the stock binary
  alone and the ⌘⇧B fallback keeps working.
- Only change vs upstream: an explicit `import CoreGraphics` (newer Swift
  toolchains no longer re-export it through Foundation).
- Wire protocol (stdout → JS): `KEYBOARD|MOUSE,DOWN|UP,keyCode,x,y,id`, matching
  the parser in `build/ts/MacKeyServer.js` of 0.3.0.
