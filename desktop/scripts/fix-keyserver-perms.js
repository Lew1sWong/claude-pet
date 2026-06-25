// Make the node-global-key-listener helper binaries executable after install,
// so the boss-key global hook can spawn them without triggering a sudo prompt
// (the package ships them as 0644). Safe/no-op on Windows or if absent.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "node_modules", "node-global-key-listener", "bin");
for (const f of ["MacKeyServer", "X11KeyServer"]) {
  try {
    fs.chmodSync(path.join(dir, f), 0o755);
  } catch {
    /* not present on this platform / not installed — ignore */
  }
}
