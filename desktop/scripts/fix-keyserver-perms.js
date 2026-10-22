// Post-install fixes for the node-global-key-listener helper binaries (the
// boss-key global triple-Esc hook):
//   1. chmod +x — the package ships them as 0644, which would otherwise make
//      the hook fail to spawn (or trigger a sudo prompt).
//   2. Apple-Silicon Macs: the stock MacKeyServer is x86_64-only and spawns
//      with EBADARCH ("Unknown system error -86") when Rosetta isn't installed.
//      If `swiftc` (Xcode Command Line Tools) is available, rebuild it natively
//      from the vendored source (vendor/MacKeyServer/main.swift). Without it the
//      ⌘⇧B fallback still works — the hook just stays off.
// Safe / no-op on Windows, Linux, or when the package isn't installed.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = path.join(__dirname, "..", "node_modules", "node-global-key-listener", "bin");
for (const f of ["MacKeyServer", "X11KeyServer"]) {
  try { fs.chmodSync(path.join(dir, f), 0o755); } catch { /* not present on this platform — ignore */ }
}

function archsOf(bin) {
  try {
    return execFileSync("lipo", ["-archs", bin], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";   // no lipo (no CLT) — treat as unknown
  }
}

// without the Command Line Tools, `lipo` / `swiftc` are xcode-select shims
// that pop the "Install the command line developer tools?" dialog — check
// first and skip quietly instead
function hasCommandLineTools() {
  try {
    execFileSync("xcode-select", ["-p"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const bin = path.join(dir, "MacKeyServer");
if (process.platform === "darwin" && process.arch === "arm64" && fs.existsSync(bin) && !hasCommandLineTools()) {
  console.warn(
    "[claude-pet] no Xcode Command Line Tools — keeping the stock (x86_64) MacKeyServer; the boss key works via ⌘⇧B. " +
    "For global triple-Esc run `xcode-select --install` and then `npm install` again (or install Rosetta: softwareupdate --install-rosetta)."
  );
} else if (process.platform === "darwin" && process.arch === "arm64" && fs.existsSync(bin)) {
  const archs = archsOf(bin);
  if (/arm64/.test(archs)) {
    console.log(`[claude-pet] MacKeyServer already has an arm64 slice (${archs}) — nothing to do`);
  } else {
    const src = path.join(__dirname, "..", "vendor", "MacKeyServer", "main.swift");
    const tmp = bin + ".arm64.tmp";
    try {
      execFileSync("swiftc", ["-O", src, "-o", tmp], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
      fs.renameSync(tmp, bin);
      fs.chmodSync(bin, 0o755);
      console.log(`[claude-pet] rebuilt MacKeyServer natively for arm64 (was: ${archs || "unknown arch"}) — boss-key triple-Esc hook enabled`);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      const msg = String((e && e.stderr && e.stderr.toString().trim()) || (e && e.message) || e).split("\n")[0];
      console.warn(
        `[claude-pet] could not rebuild MacKeyServer for arm64 (${msg}). The boss key still works via ⌘⇧B; ` +
        "for global triple-Esc install the Xcode Command Line Tools (xcode-select --install) and run `npm install` again, " +
        "or install Rosetta (softwareupdate --install-rosetta)."
      );
    }
  }
}
