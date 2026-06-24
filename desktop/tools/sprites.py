# -*- coding: utf-8 -*-
"""Claude Pet sprite generator — chibi front-facing pets.
Frames are 16x16 string-art, built with concatenations to avoid width
mistakes. Renders a preview PNG and exports sprites.js (desktop + web).
Chars: . transparent | letters map to per-character palette.

Characters: cat 小橘 / dog 柴柴 / bear 布朗 (original)
            rabbit 团子 / fox 小狐 / penguin QQ / star 小克 (new)
"""
import json, os
from PIL import Image, ImageDraw

W = H = 16
E = "................"  # empty row

# ---------------------------------------------------------------- palettes
PAL = {
    "cat":     {"o": "#F0A055", "d": "#B5683A", "c": "#FFE9C9", "p": "#F08CA0", "k": "#3A2A22"},
    "dog":     {"o": "#E2A35B", "d": "#A8642E", "c": "#FBEBD0", "p": "#F08CA0", "k": "#33241A"},
    "bear":    {"o": "#B07845", "d": "#7C4F2A", "c": "#E8C99B", "p": "#F08CA0", "k": "#2E2018"},
    # --- new ---
    "rabbit":  {"o": "#F2EEE6", "d": "#CFC4B6", "c": "#FBE2E8", "p": "#F2A6BC", "k": "#3A2E2A"},
    "fox":     {"o": "#E8843C", "d": "#B5551E", "c": "#FCF2E4", "p": "#F08CA0", "k": "#2E2018"},
    # penguin: 'p' slot repurposed as the orange beak/feet colour
    "penguin": {"o": "#3D4A63", "d": "#283449", "c": "#F4F5F1", "p": "#F0A23C", "k": "#1B1E28"},
    # star 小克: Anthropic coral; 'p' is the warm highlight
    "star":    {"o": "#D9774F", "d": "#B85733", "c": "#F6C9A6", "p": "#FFE9D2", "k": "#3A2018"},
}

def put(frame, pixels, ch):
    rows = [list(r) for r in frame]
    for x, y in pixels:
        rows[y][x] = ch
    return ["".join(r) for r in rows]

def shift_down(frame):
    return [E] + frame[:-1]

HEAD     = ".." + "o" * 12 + ".."                                  # cols2-13
EYES_ROW = ".." + "oo" + "kk" + "oooo" + "kk" + "oo" + ".."        # eyes 4-5 / 10-11
BODY     = "..." + "o" * 10 + "..."                                # cols3-12
BELLY    = "..." + "oo" + "cccccc" + "oo" + "..."
FEET_A   = "...." + "oo" + "...." + "oo" + "...."
FEET_B   = "....." + "oo" + ".." + "oo" + "....."

def sleep_frames(ears_left, ears_right, nose=None):
    """Lying blob, head right. ears_* are 1-2 px wide strings."""
    r_ears = "........." + ears_left + ".." + ears_right + "."
    assert len(r_ears) == 16, r_ears
    f1 = [
        E, E, E, E, E, E, E, E,
        r_ears,
        "........." + "oooooo" + ".",
        "........." + "odoodo" + ".",
        "." + "o" * 14 + ".",
        "." + "oo" + "c" * 9 + "ooo" + ".",
        "." + "o" * 14 + ".",
        ".." + "oo" + ".." + "oo" + ".." + "oo" + "....",
        E,
    ]
    if nose:
        f1 = put(f1, [nose], "k")
    # breathing: head flattens 1px
    f2 = [E] + f1[:9] + f1[10:]
    f2 = f2[:16]
    return [f1, f2]

F = {}

# ---------------------------------------------------------------- CAT
cat_base = [
    "..." + "o" + "." * 8 + "o" + "...",                 # r0 ear tips
    ".." + "opo" + "." * 6 + "opo" + "..",               # r1 ears + pink inner
    HEAD, HEAD,                                          # r2-3
    EYES_ROW, EYES_ROW,                                  # r4-5
    ".." + "ooooo" + "pp" + "ooooo" + "..",              # r6 pink nose
    ".." + "o" + "pp" + "oo" + "dd" + "oo" + "pp" + "o" + "..",  # r7 blush+mouth
    HEAD,                                                # r8 chin
    BODY,                                                # r9
    BELLY, BELLY,                                        # r10-11
    BODY,                                                # r12
    BODY,                                                # r13
]
cat_a = put(cat_base, [(14, 10), (14, 11), (14, 12), (13, 13)], "o")   # tail up
cat_b = put(cat_base, [(14, 11), (14, 12), (15, 10), (13, 13)], "o")   # tail flick

F["cat"] = {
    "idle": [cat_a + [FEET_A, E], shift_down(cat_b + [FEET_A, E])],
    "walk": [cat_a + [FEET_A, E], cat_b + [FEET_B, E]],
    "sleep": sleep_frames("o.", ".o"),
}

# ---------------------------------------------------------------- DOG
dog_base = [
    E,                                                   # r0
    "." + "o" + "." * 12 + "o" + ".",                    # r1 floppy ear tops
    "." + "o" * 14 + ".",                                # r2
    "." + "o" * 14 + ".",                                # r3
    "." + "d" + "oo" + "kk" + "oooo" + "kk" + "oo" + "d" + ".",  # r4 eyes+ear tips
    EYES_ROW,                                            # r5
    ".." + "ooo" + "cc" + "kk" + "cc" + "ooo" + "..",    # r6 muzzle + nose
    ".." + "o" + "pp" + "cc" + "pp" + "cc" + "pp" + "o" + "..",  # r7 blush+tongue
    HEAD,                                                # r8
    BODY,                                                # r9
    BELLY, BELLY,                                        # r10-11
    BODY,                                                # r12
    BODY,                                                # r13
]
dog_a = put(dog_base, [(13, 9), (13, 10)], "o")          # tail
dog_a = put(dog_a, [(13, 8)], "c")                       # cream tip
dog_b = put(dog_base, [(13, 10), (13, 11)], "o")         # tail wag down
dog_b = put(dog_b, [(13, 9)], "c")

F["dog"] = {
    "idle": [dog_a + [FEET_A, E], shift_down(dog_b + [FEET_A, E])],
    "walk": [dog_a + [FEET_A, E], dog_b + [FEET_B, E]],
    "sleep": sleep_frames("oo", "oo", nose=(12, 11)),
}

# ---------------------------------------------------------------- BEAR
BEAR_BODY  = ".." + "o" * 12 + ".."
BEAR_BELLY = ".." + "ooo" + "cccccc" + "ooo" + ".."
BEAR_FEET_A = "..." + "ooo" + "...." + "ooo" + "..."
BEAR_FEET_B = "...." + "ooo" + ".." + "ooo" + "...."

bear_base = [
    ".." + "ooo" + "." * 6 + "ooo" + "..",               # r0 round ears
    ".." + "oco" + "." * 6 + "oco" + "..",               # r1 inner
    HEAD, HEAD,                                          # r2-3
    EYES_ROW, EYES_ROW,                                  # r4-5
    ".." + "ooo" + "cc" + "kk" + "cc" + "ooo" + "..",    # r6 muzzle + nose
    ".." + "o" + "pp" + "cccccc" + "pp" + "o" + "..",    # r7 blush + plain muzzle
    HEAD,                                                # r8
    BEAR_BODY,                                           # r9
    BEAR_BELLY, BEAR_BELLY,                              # r10-11
    BEAR_BODY,                                           # r12
    BODY,                                                # r13 rounded bottom
]

F["bear"] = {
    "idle": [bear_base + [BEAR_FEET_A, E], shift_down(bear_base + [BEAR_FEET_A, E])],
    "walk": [bear_base + [BEAR_FEET_A, E], bear_base + [BEAR_FEET_B, E]],
    "sleep": sleep_frames("oo", "oo"),
}

# ---------------------------------------------------------------- RABBIT 团子
rabbit_base = [
    "...oo......oo...",                                  # r0 tall ear tips
    "...op......po...",                                  # r1 pink inner ears
    HEAD, HEAD,                                          # r2-3
    EYES_ROW, EYES_ROW,                                  # r4-5
    ".." + "ooooo" + "pp" + "ooooo" + "..",              # r6 pink nose
    ".." + "o" + "pp" + "oo" + "dd" + "oo" + "pp" + "o" + "..",  # r7 blush + tiny mouth
    HEAD,                                                # r8
    BODY,                                                # r9
    BELLY, BELLY,                                        # r10-11
    BODY,                                                # r12
    BODY,                                                # r13
]
rabbit_a = put(rabbit_base, [(13, 12), (13, 13)], "c")   # fluffy tail puff
rabbit_b = put(rabbit_base, [(13, 13)], "c")

F["rabbit"] = {
    "idle": [rabbit_a + [FEET_A, E], shift_down(rabbit_b + [FEET_A, E])],
    "walk": [rabbit_a + [FEET_A, E], rabbit_b + [FEET_B, E]],
    "sleep": sleep_frames("o.", ".o"),
}

# ---------------------------------------------------------------- FOX 小狐
fox_base = [
    ".." + "oo" + "." * 8 + "oo" + "..",                 # r0 pointy ear tips
    ".." + "odo" + "." * 6 + "odo" + "..",               # r1 dark inner ears
    HEAD, HEAD,                                          # r2-3
    EYES_ROW, EYES_ROW,                                  # r4-5
    ".." + "occoo" + "kk" + "oocco" + "..",              # r6 white cheeks + nose
    ".." + "ooocc" + "dd" + "ccooo" + "..",              # r7 white muzzle + mouth
    HEAD,                                                # r8
    BODY,                                                # r9
    BELLY, BELLY,                                        # r10-11
    BODY,                                                # r12
    BODY,                                                # r13
]
fox_a = put(fox_base, [(13, 9), (13, 10), (14, 10)], "o")   # bushy tail
fox_a = put(fox_a, [(14, 9)], "c")                          # cream tail tip
fox_b = put(fox_base, [(13, 10), (13, 11), (14, 11)], "o")
fox_b = put(fox_b, [(14, 10)], "c")

F["fox"] = {
    "idle": [fox_a + [FEET_A, E], shift_down(fox_b + [FEET_A, E])],
    "walk": [fox_a + [FEET_A, E], fox_b + [FEET_B, E]],
    "sleep": sleep_frames("oo", ".o", nose=(12, 11)),
}

# ---------------------------------------------------------------- PENGUIN QQ
PEN_BELLY  = "o" + "c" * 10 + "o"            # cols2-13 white belly
PEN_FEET_A = "...." + "pp" + "...." + "pp" + "...."   # orange feet
PEN_FEET_B = "....." + "pp" + ".." + "pp" + "....."

penguin_base = [
    "...." + "oooooooo" + "....",                        # r0 rounded head top
    HEAD, HEAD,                                          # r1-2
    ".." + "ockkcoockkco" + "..",                        # r3 white-patch eyes
    ".." + "ooooo" + "pp" + "ooooo" + "..",              # r4 orange beak
    ".." + PEN_BELLY + "..",                             # r5 white belly
    ".." + PEN_BELLY + "..",                             # r6
    ".." + PEN_BELLY + "..",                             # r7
    ".." + PEN_BELLY + "..",                             # r8
    ".." + "oo" + "c" * 8 + "oo" + "..",                 # r9
    ".." + "ooo" + "c" * 6 + "ooo" + "..",               # r10
    ".." + "oooo" + "c" * 4 + "oooo" + "..",             # r11
    BODY,                                                # r12 rounded bottom
    "...." + "oooooooo" + "....",                        # r13
]
penguin_a = put(penguin_base, [(1, 6), (1, 7), (14, 6), (14, 7)], "o")   # flippers down
penguin_b = put(penguin_base, [(1, 5), (1, 6), (14, 5), (14, 6)], "o")   # flippers up

F["penguin"] = {
    "idle": [penguin_a + [PEN_FEET_A, E], shift_down(penguin_a + [PEN_FEET_A, E])],
    "walk": [penguin_a + [PEN_FEET_A, E], penguin_b + [PEN_FEET_B, E]],
    "sleep": sleep_frames("oo", "oo", nose=(12, 11)),
}

# ---------------------------------------------------------------- STAR 小克
star_a = [
    "......." + "oo" + ".......",                        # r0 top spark
    ".." + "o" + "...." + "oo" + "...." + "o" + "..",    # r1 side sparks + top
    "...." + "oooooooo" + "....",                        # r2 body top
    HEAD,                                                # r3
    EYES_ROW,                                            # r4
    EYES_ROW,                                            # r5
    ".." + "o" + "pp" + "oo" + "dd" + "oo" + "pp" + "o" + "..",  # r6 blush + smile
    HEAD,                                                # r7
    "...." + "oooooooo" + "....",                        # r8 body bottom
    ".." + "o" + "...." + "oo" + "...." + "o" + "..",    # r9 side sparks + bottom
    "......." + "oo" + ".......",                        # r10 bottom spark
    E, E, E,                                             # r11-13
]
star_b = [
    E,                                                   # r0 top spark twinkles out
    "..." + "o" + "..." + "oo" + "..." + "o" + "...",    # r1 short side sparks
    "...." + "oooooooo" + "....",                        # r2
    HEAD,                                                # r3
    EYES_ROW,                                            # r4
    EYES_ROW,                                            # r5
    ".." + "o" + "pp" + "oo" + "dd" + "oo" + "pp" + "o" + "..",  # r6
    HEAD,                                                # r7
    "...." + "oooooooo" + "....",                        # r8
    "..." + "o" + "..." + "oo" + "..." + "o" + "...",    # r9 short side sparks
    E,                                                   # r10
    E, E, E,                                             # r11-13
]
star_sleep = [
    E, E, E,                                             # r0-2
    "...." + "oooooooo" + "....",                        # r3 body top (lowered)
    HEAD,                                                # r4
    ".." + "oo" + "dd" + "oooo" + "dd" + "oo" + "..",    # r5 closed eyes (dark line)
    HEAD,                                                # r6
    ".." + "oooo" + "dddd" + "oooo" + "..",              # r7 calm mouth
    HEAD,                                                # r8
    "...." + "oooooooo" + "....",                        # r9 body bottom
    E, E, E, E,                                          # r10-13
]

F["star"] = {
    "idle": [star_a + [E, E], shift_down(star_b + [E, E])],
    "walk": [star_a + [E, E], star_b + [E, E]],
    "sleep": [star_sleep + [E, E], shift_down(star_sleep + [E, E])],
}

# eye pixels for blink/happy overlays (frame 0 coordinates)
EYES = {ch: [[4, 4], [5, 4], [4, 5], [5, 5], [10, 4], [11, 4], [10, 5], [11, 5]]
        for ch in F}
EYES["penguin"] = [[4, 3], [5, 3], [10, 3], [11, 3]]   # single-row eyes

NAMES = {
    "cat": "小橘", "dog": "柴柴", "bear": "布朗",
    "rabbit": "团子", "fox": "小狐", "penguin": "QQ", "star": "小克",
}

# ---------------------------------------------------------------- validate
for ch, states in F.items():
    for st, frames in states.items():
        for i, fr in enumerate(frames):
            assert len(fr) == 16, f"{ch}.{st}[{i}] has {len(fr)} rows"
            for r, row in enumerate(fr):
                assert len(row) == 16, f"{ch}.{st}[{i}] row{r} len={len(row)}: '{row}'"
                for px in row:
                    assert px == "." or px in PAL[ch], f"{ch}.{st}[{i}] bad char '{px}'"

# ---------------------------------------------------------------- render
def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def draw_frame(img, ox, oy, frame, pal, scale):
    d = ImageDraw.Draw(img)
    for y, row in enumerate(frame):
        for x, px in enumerate(row):
            if px != ".":
                c = hex2rgb(pal[px])
                d.rectangle([ox + x*scale, oy + y*scale,
                             ox + (x+1)*scale - 1, oy + (y+1)*scale - 1], fill=c)

def preview(path, scale=10, pad=12):
    order = ["idle", "walk", "sleep"]
    cols = sum(len(F["cat"][s]) for s in order)
    iw = cols * (W*scale + pad) + pad
    ih = len(F) * (H*scale + pad) + pad
    img = Image.new("RGB", (iw, ih), hex2rgb("#1E1E2E"))
    for r, ch in enumerate(F):
        cx = pad
        for st in order:
            for fr in F[ch][st]:
                draw_frame(img, cx, pad + r*(H*scale+pad), fr, PAL[ch], scale)
                cx += W*scale + pad
    img.save(path)
    print("preview ->", path)

def export_js(path):
    data = {"palettes": PAL, "frames": F, "eyes": EYES, "names": NAMES}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write("// auto-generated by tools/sprites.py — do not edit by hand\n")
        f.write("const SPRITES = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print("js ->", path)

def render_png(char, size):
    fr = F[char]["idle"][0]
    scale = size // W
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_frame(img, 0, 0, fr, PAL[char], scale)
    return img

def export_icon(path, char="cat", size=256):
    render_png(char, size).save(path)
    print("icon ->", path)

def export_ico(path, char="cat", size=256):
    render_png(char, size).save(
        path, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("ico ->", path)

if __name__ == "__main__":
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))      # .../desktop
    root = os.path.dirname(base)                                           # project root
    preview(os.path.join(base, "tools", "preview.png"))
    # sprites.js for both the desktop renderer and the web/PWA build
    export_js(os.path.join(base, "renderer", "sprites.js"))
    export_js(os.path.join(root, "web", "sprites.js"))
    # desktop / windows app icons (cat — matches the tray paw vibe)
    export_icon(os.path.join(base, "assets", "icon.png"), "cat", 256)
    export_ico(os.path.join(base, "assets", "icon.ico"), "cat", 256)
    # PWA icons use 小克 (the Claude-brand mascot)
    export_icon(os.path.join(root, "web", "icons", "icon-512.png"), "star", 512)
    export_icon(os.path.join(root, "web", "icons", "icon-192.png"), "star", 192)
    export_icon(os.path.join(root, "web", "icons", "icon-180.png"), "star", 180)  # iOS
