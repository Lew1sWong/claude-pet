// Read the exact MacBook notch geometry. Electron doesn't expose NSScreen's
// safeAreaInsets / auxiliaryTop*Area, so we query AppKit through osascript's
// JavaScript bridge — present on every Mac, no native build / Xcode needed.
// Values are in points (DIP), matching Electron's window-bounds coordinate space.
const { execFileSync } = require("child_process");

const JXA = `
ObjC.import("AppKit");
var s = $.NSScreen.mainScreen;
var f = s.frame;
var sa = s.safeAreaInsets;
var out = { screenW: f.size.width, screenH: f.size.height, top: sa.top };
if (s.respondsToSelector("auxiliaryTopLeftArea")) {
  var l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea;
  out.notchW = f.size.width - l.size.width - r.size.width;
  out.notchLeft = l.size.width;             // x of the notch's left edge
}
JSON.stringify(out);
`;

function readNotch() {
  if (process.platform !== "darwin") return { hasNotch: false };
  try {
    const raw = execFileSync("osascript", ["-l", "JavaScript", "-e", JXA], {
      timeout: 3000, encoding: "utf8",
    });
    const g = JSON.parse(raw.trim());
    // a real notch is ~150–230pt wide and ~30–40pt tall; anything else → none
    const hasNotch = !!(g.top > 0 && g.notchW > 80 && g.notchW < 320);
    return {
      hasNotch,
      screenW: g.screenW,
      notchTop: g.top || 0,
      notchW: hasNotch ? g.notchW : 0,
      notchCenter: hasNotch ? g.notchLeft + g.notchW / 2 : g.screenW / 2,
    };
  } catch {
    return { hasNotch: false };
  }
}

module.exports = { readNotch };
