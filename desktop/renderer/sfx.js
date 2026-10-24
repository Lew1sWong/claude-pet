/* 🔊 8-bit sound effects, synthesized with WebAudio — no asset files.
   Off unless Settings → Features → Sound is on (window.SFX.setEnabled). */
(function () {
  let ctx = null;
  let enabled = false;
  function ac() {
    if (ctx) return ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
    return ctx;
  }
  // one chip-tune note: [freq, startSec, durSec, type?, vol?]
  function tone(freq, start, dur, type, vol) {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    const t0 = c.currentTime + start;
    g.gain.setValueAtTime(vol || 0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  // filtered noise burst (thunder / rain patter)
  function noise(start, dur, cutoff, vol) {
    const c = ac();
    if (!c) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = vol || 0.12;
    src.connect(f).connect(g).connect(c.destination);
    src.start(c.currentTime + start);
  }
  const SONGS = {
    click:   [[880, 0, 0.06]],
    plant:   [[392, 0, 0.08], [523, 0.09, 0.12]],
    harvest: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.28]],
    reset:   [[523, 0, 0.12], [784, 0.12, 0.12], [1047, 0.24, 0.32], [1319, 0.42, 0.4]],
    warn:    [[440, 0, 0.15], [330, 0.18, 0.28]],
    crow:    [[320, 0, 0.09, "sawtooth", 0.05], [270, 0.11, 0.12, "sawtooth", 0.05], [300, 0.26, 0.08, "sawtooth", 0.04]],
    shoo:    [[600, 0, 0.05], [900, 0.05, 0.05], [1200, 0.1, 0.08]],
    level:   [[659, 0, 0.1], [784, 0.1, 0.1], [988, 0.2, 0.1], [1319, 0.3, 0.35]],
  };
  function play(name) {
    if (!enabled) return;
    const c = ac();
    if (!c) return;
    if (c.state === "suspended" && c.resume) c.resume().catch(() => {});
    if (name === "thunder") { noise(0, 0.9, 220, 0.18); tone(55, 0, 0.5, "triangle", 0.08); return; }
    const song = SONGS[name];
    if (!song) return;
    for (const [f, s, d, type, vol] of song) tone(f, s, d, type, vol);
  }
  window.SFX = {
    play,
    setEnabled(v) { enabled = !!v; if (enabled) { const c = ac(); if (c && c.state === "suspended" && c.resume) c.resume().catch(() => {}); } },
    isEnabled: () => enabled,
  };
})();
