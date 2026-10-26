/* 🎃🎄🎆 Seasonal sprites — hats drawn over the pet's 16×16 frame (rows 0-4
   sit on the head; the breathing bob shifts them with the eyes). Same
   string-art conventions as sprites.js. */
(function () {
  const EMPTY = "................";
  const pad = (rows) => rows.concat(Array(16 - rows.length).fill(EMPTY));
  const PALETTE = {
    n: "#14141c",   // witch hat
    p: "#8e44ad",   // hat band
    r: "#e04a3f",   // santa red
    e: "#ffffff",   // trim / pompom
    y: "#f5d142",   // party hat
    c: "#39c5e0",   // party stripe
  };
  const HATS = {
    witch: pad([
      ".......n........",
      "......nnn.......",
      ".....nnnnn......",
      ".....npppn......",
      "..nnnnnnnnnnn...",
    ]),
    santa: pad([
      "..........e.....",
      "......rrrre.....",
      ".....rrrrr......",
      "....rrrrrr......",
      "...eeeeeeee.....",
    ]),
    party: pad([
      ".......y........",
      "......ycy.......",
      "......ycy.......",
      ".....yycyy......",
      ".....cyyyc......",
    ]),
  };
  window.SEASON_SPRITES = { palette: PALETTE, hats: HATS };
})();
