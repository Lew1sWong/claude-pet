// Generate web/shared/*.js from the desktop modules so the PWA runs the exact
// same usage parser, mood logic, garden, forecast, report card, strings,
// sprites and renderer helpers — no module loader needed: each CommonJS file
// is wrapped in an IIFE with a fake `module`, and its exports land on
// `window.<Global>`. Browser-only files (petcore.js, gardensprites.js, sfx.js)
// are copied verbatim. `npm run sync-web` regenerates; test/webShared.test.js
// fails when the generated files are stale.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "..", "web", "shared");
const HEADER = (src) => `/* GENERATED from desktop/${src} by desktop/scripts/sync-web.js — do not edit; run \`npm run sync-web\` in desktop/ */\n`;

// [source relative to desktop/, output name, window global (null = verbatim copy)]
const FILES = [
  ["lib/usageClient.js", "usageClient.js", "PetUsage"],
  ["lib/history.js", "history.js", "PetHistory"],
  ["lib/garden.js", "garden.js", "PetGarden"],
  ["lib/report.js", "report.js", "PetReport"],
  ["lib/strings.js", "strings.js", "PetStrings"],
  ["renderer/petcore.js", "petcore.js", null],
  ["renderer/gardensprites.js", "gardensprites.js", null],
  ["renderer/sfx.js", "sfx.js", null],
];

function render(src, global) {
  const code = fs.readFileSync(path.join(ROOT, src), "utf8");
  if (!global) return HEADER(src) + code;
  return HEADER(src) +
    "(function () {\n  \"use strict\";\n  const module = { exports: {} };\n  const exports = module.exports;\n" +
    code.replace(/^/gm, "  ").replace(/\n  $/, "\n") +
    `\n  window.${global} = module.exports;\n})();\n`;
}

function generate() {
  return FILES.map(([src, out, global]) => ({ out, content: render(src, global) }));
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const { out, content } of generate()) {
    fs.writeFileSync(path.join(OUT, out), content);
    console.log("web/shared/" + out);
  }
}

module.exports = { generate, FILES, OUT };
