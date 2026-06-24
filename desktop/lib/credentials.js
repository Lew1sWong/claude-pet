// Read Claude Code OAuth credentials (read-only; never refreshes tokens
// to avoid racing Claude Code's own refresh flow).
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function extract(j) {
  const o = j.claudeAiOauth || j.oauth || j;
  if (o && typeof o.accessToken === "string" && o.accessToken.length > 10) {
    return { accessToken: o.accessToken, expiresAt: o.expiresAt || null };
  }
  return null;
}

function fromKeychain() {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          resolve(extract(JSON.parse(stdout.trim())));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function fromFiles() {
  const candidates = [
    path.join(os.homedir(), ".claude", ".credentials.json"),
    path.join(os.homedir(), ".config", "claude", ".credentials.json"),
  ];
  for (const p of candidates) {
    try {
      const t = extract(JSON.parse(fs.readFileSync(p, "utf8")));
      if (t) return t;
    } catch {
      /* next */
    }
  }
  return null;
}

/** @returns {Promise<{accessToken:string, expiresAt:number|null}|null>} */
async function readCredentials() {
  if (process.platform === "darwin") {
    const t = await fromKeychain();
    if (t) return t;
  }
  return fromFiles();
}

module.exports = { readCredentials };
