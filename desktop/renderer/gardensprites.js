/* 🌱 Pixel garden sprites — 16×16 string art, same conventions as sprites.js
   ("." = transparent, letters index the palette). Each crop has 4 growth
   stages (seed · sprout · growing · ripe); frames include the soil rows so
   the renderer just paints one frame per plot. Hand-drawn, keep it cute. */
(function () {
  const PALETTE = {
    s: "#7a4a2a", S: "#5a331c",            // soil, soil shadow
    g: "#5cbf5f", G: "#2e7d32",            // leaf, leaf shadow
    b: "#8d6e3a",                          // stalk
    w: "#e8d9b5",                          // seed
    o: "#f28c28", O: "#c96a12",            // carrot
    r: "#e04a3f", R: "#a8281f",            // tomato
    y: "#f5d142", Y: "#d4a914", k: "#4a2f14", // sunflower petals, dark petals, seeds
  };
  const SOIL = [
    "ssssssssssssssss",
    "sSssssSsssssSsss",
    "ssssssssssssssss",
    "ssSsssssSssssSss",
    "SSSSSSSSSSSSSSSS",
  ];
  const EMPTY = "................";
  // top 11 rows (0-10) given bottom-up as the plant grows; pad to 11 rows
  const top = (rows) => { const r = rows.slice(); while (r.length < 11) r.unshift(EMPTY); return r.concat(SOIL); };

  const SEED = top([".......ww......."]);
  const SPROUT = top([
    ".......g........",
    "......gGg.......",
    ".......b........",
  ]);

  const CROPS = {
    carrot: [
      SEED, SPROUT,
      top([
        ".....g..g..g....",
        "......gGgGg.....",
        ".....gGGGGGg....",
        "......gGGGg.....",
        ".......GG.......",
      ]),
      [
        EMPTY, EMPTY, EMPTY, EMPTY,
        ".....g..g..g....",
        "......gGgGg.....",
        ".....gGGGGGg....",
        "......gGGGg.....",
        ".......GG.......",
        "......oooo......",
        "......oOoo......",
        "sssssssooOssssss",
        "sSssssSooosssSss",
        "sssssssoOsssssss",
        "ssSsssssSssssSss",
        "SSSSSSSSSSSSSSSS",
      ],
    ],
    tomato: [
      SEED, SPROUT,
      top([
        "......gGg.......",
        ".....gGGGg......",
        "....gGgGgGg.....",
        ".....gGGGg......",
        "......gbg.......",
      ]),
      top([
        "......gGg.......",
        ".....gGGGg......",
        "....gGrGrGg.....",
        "....GRgGgrG.....",
        ".....gGrGg......",
        "......gRg.......",
        ".......b........",
      ]),
    ],
    sunflower: [
      SEED, SPROUT,
      top([
        ".......y........",
        "......yGy.......",
        ".......b........",
        ".....g.b.g......",
        "......gbg.......",
        ".......b........",
        ".......b........",
      ]),
      top([
        ".......y........",
        ".....yyyyy......",
        "....yYkkkYy.....",
        "....ykkkkky.....",
        "....yYkkkYy.....",
        ".....yyyyy......",
        ".......b........",
        ".....g.b.g......",
        "......gbg.......",
        ".......b........",
      ]),
    ],
  };
  const EMOJI = { carrot: "🥕", tomato: "🍅", sunflower: "🌻" };

  window.GARDEN_SPRITES = { palette: PALETTE, soil: top([]), crops: CROPS, emoji: EMOJI };
})();
