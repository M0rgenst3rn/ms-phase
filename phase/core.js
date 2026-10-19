"use strict";
// Vhold – core engine (plain JavaScript, runs in the panel and in Node).
// Turns an image into a CRT TV look. The result is several layers that Photoshop
// later gets as real layers with blend modes:
//   signal  Normal    the image as a TV signal (lines, colour, shift, interference, overlays)
//   mask    Multipl.  phosphor mask (aperture grille, shadow mask, slot mask, LED)
//   scan    Multipl.  Scanlines
//   glass   Multipl.  vignette, round corners, moiré
//   reflex  Screen    reflection on the glass and a light rim at the tube edge
//   bloom   Screen    glow of bright areas
// All sizes depend on the number of lines over the image height – so the small preview looks like
// the result at full resolution.

const DEFAULTS = {
  mode: "wave",          // clear | straight | wave | swirl
  lines: 180,            // lines over the image height
  wave: 45,              // wave strength (wave, swirl)
  thickness: 70,         // maximum line thickness
  smooth: 35,            // smoothing of the waves
  dots: 0,               // break the lines into dots
  colorMode: "phosphor", // original | phosphor | gradient
  tint: "#3fd4ff",       // phosphor colour or middle of the gradient
  tintLow: "#1b2a8f",    // gradient: dark tones
  tintHigh: "#ffffff",   // gradient: light tones
  contrast: 15,
  brightness: 0,
  mask: "none",          // none | aperture | shadow | slot | led
  maskSize: 100,
  maskStrength: 45,
  scanlines: 25,
  bloom: 55,
  bloomRadius: 35,
  curvature: 0,
  vignette: 35,
  corners: 0,
  tilt: 0,               // photographed at an angle (rotation + keystone)
  moire: 0,              // moiré like when photographing a screen
  reflection: 0,         // reflection and light rim on the glass
  rgbShift: 25,
  ghost: 0,
  noise: 12,
  rollbar: 0,
  jitter: 0,
  interlace: 0,          // interlace offset: every second line shifted
  wobble: 0,             // whole image wobbles (bad reception)
  glitch: 0,
  burnIn: 0,             // burned-in ghost image
  osd: "none",           // none | channel | play | rec | volume | timecode | cctv
  osdText: "",           // own text (empty = matches the overlay)
  osdColor: "#7dff8a",
  osdSize: 4,            // character height in % of the image height
  seed: 7,
  strength: 100,         // overall opacity
};

const MODES = [
  { id: "clear", name: "Clear", hint: "the image stays solid" },
  { id: "straight", name: "Straight", hint: "straight lines, thickness follows brightness" },
  { id: "wave", name: "Wave", hint: "lines bend with brightness" },
  { id: "swirl", name: "Swirl", hint: "flowing, swirling lines" },
];
const MASKS = [
  { id: "none", name: "None" },
  { id: "aperture", name: "Aperture grille" },
  { id: "shadow", name: "Shadow mask" },
  { id: "slot", name: "Slot mask" },
  { id: "led", name: "LED grid" },
];
const TINTS = [
  { id: "#3fd4ff", name: "Cyan" }, { id: "#39ff7a", name: "Green (P1)" }, { id: "#ffb43a", name: "Amber" },
  { id: "#9fc8ff", name: "Ice blue" }, { id: "#ff4fd8", name: "Magenta" }, { id: "#f2f2f2", name: "White" },
];
// ready-made gradients (dark → middle → light)
const GRADIENTS = [
  { name: "Deep sea", low: "#1b2a8f", mid: "#3fd4ff", high: "#ffffff" },
  { name: "Synthwave", low: "#3a0a6b", mid: "#ff3fa4", high: "#ffe2a8" },
  { name: "Ember", low: "#4a0a0a", mid: "#ff6a1a", high: "#fff1b0" },
  { name: "Toxic", low: "#0b3a1a", mid: "#39ff7a", high: "#f0ffb0" },
  { name: "Aurora", low: "#0a2a4a", mid: "#2dffb0", high: "#e8d0ff" },
];
const OSDS = [
  { id: "none", name: "None" },
  { id: "channel", name: "Channel (CH 03)" },
  { id: "play", name: "Playback (▶ PLAY)" },
  { id: "rec", name: "Recording (● REC + time)" },
  { id: "volume", name: "Volume" },
  { id: "timecode", name: "Date and time" },
  { id: "cctv", name: "Security camera" },
];

// Looks. Every look sets all values (missing = default), so they always look the same.
const PRESETS = [
  { id: "phase", name: "Vhold", p: {} },
  { id: "straight", name: "Lines", p: { mode: "straight", lines: 150, thickness: 80, wave: 0, tint: "#9fc8ff", bloom: 45 } },
  { id: "swirl", name: "Swirl", p: { mode: "swirl", wave: 60, lines: 160, tint: "#ff4fd8", bloom: 60 } },
  { id: "dotwave", name: "Dot Wave", p: { mode: "wave", dots: 70, lines: 140, thickness: 85, tint: "#3fd4ff", bloom: 65 } },
  { id: "deepsea", name: "Deep sea", p: { mode: "wave", colorMode: "gradient", tintLow: "#1b2a8f", tint: "#3fd4ff", tintHigh: "#ffffff", wave: 55, lines: 170, bloom: 65, contrast: 20 } },
  { id: "synth", name: "Synthwave", p: { mode: "wave", colorMode: "gradient", tintLow: "#3a0a6b", tint: "#ff3fa4", tintHigh: "#ffe2a8", wave: 40, lines: 160, bloom: 70, reflection: 35, curvature: 20, corners: 25 } },
  { id: "hologram", name: "Hologram", p: { mode: "wave", wave: 30, lines: 220, tint: "#4fb4ff", contrast: 0, rgbShift: 45, ghost: 35, noise: 18, bloom: 70, jitter: 15, interlace: 40 } },
  { id: "scifi", name: "Sci-fi interface", p: { mode: "wave", dots: 55, wave: 35, lines: 190, tint: "#3fd4ff", bloom: 80, bloomRadius: 45, noise: 5, rgbShift: 15, interlace: 25, vignette: 20 } },
  { id: "terminal", name: "Terminal", p: { mode: "clear", tint: "#39ff7a", contrast: 35, scanlines: 60, bloom: 60, curvature: 35, vignette: 55, corners: 45, rgbShift: 0, noise: 10, lines: 240, burnIn: 25 } },
  { id: "amber", name: "Amber", p: { mode: "clear", tint: "#ffb43a", contrast: 30, scanlines: 55, bloom: 55, curvature: 30, vignette: 50, corners: 40, rgbShift: 0, lines: 200 } },
  { id: "gameboy", name: "Handheld", p: { mode: "clear", tint: "#a6c24a", contrast: 40, mask: "led", maskSize: 140, maskStrength: 55, scanlines: 0, bloom: 15, rgbShift: 0, noise: 0, vignette: 20, lines: 144 } },
  { id: "xray", name: "X-ray", p: { mode: "wave", wave: 25, colorMode: "gradient", tintLow: "#04122e", tint: "#5ab0ff", tintHigh: "#eaf6ff", contrast: 55, ghost: 30, bloom: 60, noise: 15, lines: 230, vignette: 55 } },
  { id: "trinitron", name: "Trinitron", p: { mode: "clear", colorMode: "original", mask: "aperture", maskStrength: 55, scanlines: 30, bloom: 35, rgbShift: 10, noise: 4, lines: 240, contrast: 10, reflection: 20 } },
  { id: "arcade", name: "Arcade", p: { mode: "clear", colorMode: "original", mask: "shadow", maskStrength: 60, scanlines: 45, bloom: 55, curvature: 45, vignette: 45, corners: 50, rgbShift: 15, lines: 224, contrast: 20, reflection: 25 } },
  { id: "tv80s", name: "80s living room", p: { mode: "clear", colorMode: "original", mask: "slot", maskStrength: 45, scanlines: 30, bloom: 40, curvature: 55, vignette: 60, corners: 65, rgbShift: 30, ghost: 25, noise: 18, lines: 240, reflection: 40, osd: "channel" } },
  { id: "vaporwave", name: "Vaporwave", p: { mode: "clear", colorMode: "original", mask: "slot", maskStrength: 40, rgbShift: 55, bloom: 60, curvature: 35, corners: 45, vignette: 40, interlace: 30, reflection: 30, contrast: 10, osd: "play", osdColor: "#ffffff" } },
  { id: "vhs", name: "VHS", p: { mode: "clear", colorMode: "original", scanlines: 20, bloom: 35, rgbShift: 70, ghost: 30, noise: 30, jitter: 45, rollbar: 25, lines: 240, contrast: 5, wobble: 20, osd: "play", osdColor: "#ffffff" } },
  { id: "camcorder", name: "Camcorder", p: { mode: "clear", colorMode: "original", scanlines: 25, bloom: 40, rgbShift: 40, noise: 22, jitter: 15, interlace: 35, lines: 240, osd: "rec", osdColor: "#ffffff", vignette: 30 } },
  { id: "cctv", name: "Surveillance", p: { mode: "clear", tint: "#c8d8c0", contrast: 30, scanlines: 40, bloom: 30, noise: 45, interlace: 30, curvature: 25, vignette: 60, rgbShift: 0, lines: 220, osd: "cctv", osdColor: "#f2f2f2", osdSize: 3.5 } },
  { id: "filmed", name: "Filmed screen", p: { mode: "clear", colorMode: "original", mask: "aperture", maskStrength: 50, maskSize: 120, scanlines: 30, bloom: 45, curvature: 30, corners: 35, vignette: 50, tilt: 45, moire: 55, reflection: 50, rgbShift: 15, noise: 10, lines: 240 } },
  { id: "static", name: "Static", p: { mode: "clear", colorMode: "original", scanlines: 35, bloom: 30, noise: 80, rollbar: 55, rgbShift: 25, jitter: 20, curvature: 30, vignette: 45, lines: 200, wobble: 25 } },
  { id: "broken", name: "Broken channel", p: { mode: "swirl", wave: 70, colorMode: "original", glitch: 60, rollbar: 60, wobble: 55, interlace: 50, rgbShift: 75, noise: 45, jitter: 40, bloom: 50, lines: 170 } },
  { id: "lost", name: "Signal lost", p: { mode: "straight", tint: "#3fd4ff", glitch: 70, jitter: 35, rgbShift: 60, noise: 35, lines: 170, thickness: 75, bloom: 60, osd: "channel", osdText: "NO SIGNAL" } },
  { id: "ledwall", name: "LED wall", p: { mode: "clear", colorMode: "original", mask: "led", maskSize: 260, maskStrength: 85, scanlines: 0, bloom: 50, rgbShift: 0, noise: 0, vignette: 0, lines: 120, contrast: 20 } },
  { id: "nightvision", name: "Night vision", p: { mode: "clear", tint: "#39ff7a", contrast: 45, brightness: 10, scanlines: 35, bloom: 70, noise: 55, vignette: 80, corners: 0, rgbShift: 0, lines: 260, burnIn: 15 } },
];
function presetParams(id) {
  const pr = PRESETS.find((x) => x.id === id);
  return pr ? Object.assign({}, DEFAULTS, pr.p) : null;
}

// Check values and clamp them (saved settings can be old or broken)
const RANGES = {
  lines: [40, 600], wave: [0, 100], thickness: [10, 100], smooth: [0, 100], dots: [0, 100], contrast: [-50, 100], brightness: [-50, 50],
  maskSize: [50, 400], maskStrength: [0, 100], scanlines: [0, 100], bloom: [0, 100], bloomRadius: [5, 100], curvature: [0, 100],
  vignette: [0, 100], corners: [0, 100], tilt: [0, 100], moire: [0, 100], reflection: [0, 100], rgbShift: [0, 100], ghost: [0, 100],
  noise: [0, 100], rollbar: [0, 100], jitter: [0, 100], interlace: [0, 100], wobble: [0, 100], glitch: [0, 100], burnIn: [0, 100],
  osdSize: [1.5, 12], seed: [0, 99999], strength: [0, 100],
};
const COLOR_KEYS = ["tint", "tintLow", "tintHigh", "osdColor"];
function sanitize(p) {
  const out = Object.assign({}, DEFAULTS);
  if (!p || typeof p !== "object") return out;
  for (const k of Object.keys(DEFAULTS)) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (RANGES[k]) { const n = Number(v); if (isFinite(n)) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n)); }
    else if (k === "mode") { if (MODES.some((m) => m.id === v)) out[k] = v; }
    else if (k === "mask") { if (MASKS.some((m) => m.id === v)) out[k] = v; }
    else if (k === "osd") { if (OSDS.some((m) => m.id === v)) out[k] = v; }
    else if (k === "colorMode") { if (v === "original" || v === "phosphor" || v === "gradient") out[k] = v; }
    else if (COLOR_KEYS.indexOf(k) >= 0) { const t = String(v).toLowerCase(); if (/^#[0-9a-f]{6}$/.test(t)) out[k] = t; }
    else if (k === "osdText") out[k] = cleanOsdText(v);
  }
  out.seed = Math.round(out.seed);
  return out;
}

// ---------------------------------------------------------------- Pixel font for overlays (5×7)
const GLYPHS = {
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31], "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], "Ä": [17, 14, 17, 17, 31, 17, 17], "Ö": [17, 14, 17, 17, 17, 17, 14], "Ü": [17, 0, 17, 17, 17, 17, 14],
  ":": [0, 12, 12, 0, 12, 12, 0], ".": [0, 0, 0, 0, 0, 12, 12], "-": [0, 0, 0, 31, 0, 0, 0], "/": [1, 1, 2, 4, 8, 16, 16],
  "+": [0, 4, 4, 31, 4, 4, 0], "!": [4, 4, 4, 4, 4, 0, 4], "?": [14, 17, 1, 2, 4, 0, 4], "#": [10, 10, 31, 10, 31, 10, 10],
  ">": [16, 24, 28, 30, 28, 24, 16], "*": [0, 14, 31, 31, 31, 14, 0], "|": [31, 31, 31, 31, 31, 31, 31], "_": [31, 17, 17, 17, 17, 17, 31],
  " ": [0, 0, 0, 0, 0, 0, 0],
};
// ▶ and ● as pixel glyphs; all upper case; unknown characters are dropped; max. 28 characters
function cleanOsdText(v) {
  return String(v).toUpperCase().replace(/▶/g, ">").replace(/●/g, "*").split("").filter((c) => GLYPHS[c]).join("").slice(0, 28);
}
// overlay elements in target coordinates: { text, x, y, u (pixels per font pixel), color }
function osdLayout(p, fullW, fullH) {
  if (p.osd === "none") return [];
  const u = Math.max(1, fullH * p.osdSize / 100 / 7);
  const inset = 1 + p.curvature / 100 * 0.6 + p.corners / 100 * 0.4;
  const mx = fullW * 0.055 * inset, my = fullH * 0.07 * inset;
  const col = hexRgb(p.osdColor), red = [1, 0.18, 0.15];
  const width = (t) => t.length * 6 * u - u;
  const at = (text, ax, ay, color) => {
    const x = ax === "l" ? mx : ax === "r" ? fullW - mx - width(text) : (fullW - width(text)) / 2;
    const y = ay === "t" ? my : fullH - my - 7 * u;
    return { text, x, y, u, color: color || col };
  };
  const t = p.osdText;
  switch (p.osd) {
    case "channel": return [at(t || "CH 03", "l", "t")];
    case "play": return [at(t || "> PLAY", "l", "t")];
    case "rec": return [at("*", "l", "t", red), Object.assign(at(t || " REC", "l", "t"), { x: mx + 6 * u }), at("00:12:47", "r", "b")];
    case "volume": {
      const bar = "|".repeat(11) + "_".repeat(5);
      const a = at(t || "VOLUME", "l", "b"), b = at(bar, "l", "b");
      a.y -= 10 * u;
      return [a, b];
    }
    case "timecode": return [at(t || "OKT.18.1987", "l", "b"), at("AM 03:47", "r", "b")];
    case "cctv": return [at(t || "CAM 01", "l", "t"), at("*", "r", "t", red), Object.assign(at("REC", "r", "t"), { x: fullW - mx - width("REC") - 7 * u }), at("18.10.1987 03:47:12", "l", "b")];
    default: return [];
  }
}
// coverage (0..1) of an element at target point X, Y; sh = shadow coverage
function osdCover(el, X, Y) {
  const gx = (X - el.x) / el.u, gy = (Y - el.y) / el.u;
  if (gy < 0 || gy >= 7 || gx < 0) return 0;
  const ci = Math.floor(gx / 6), cx = Math.floor(gx - ci * 6), cy = Math.floor(gy);
  if (ci >= el.text.length || cx >= 5) return 0;
  const g = GLYPHS[el.text[ci]];
  return g && (g[cy] >> (4 - cx)) & 1 ? 1 : 0;
}

// ---------------------------------------------------------------- Helpers
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function hexRgb(h) { const n = parseInt(String(h).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise1(x, s) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash2(i, 17, s) * (1 - u) + hash2(i + 1, 17, s) * u;
}
function noise2(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, s) { return noise2(x, y, s) * 0.55 + noise2(x * 2.1, y * 2.1, s + 7) * 0.3 + noise2(x * 4.3, y * 4.3, s + 13) * 0.15; }

// box blur (2 passes ≈ Gaussian) on a float field; large radii are computed downsampled.
function boxBlur(src, w, h, r) {
  r = Math.max(0, Math.round(r));
  if (!r) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}
// smoothed field with a sampler. get(i) returns the value at pixel i (image w×h); for a large radius
// it averages straight into a downsampled copy – so even a very large image needs little memory.
function smoothField(get, w, h, radius) {
  const f = Math.max(1, Math.floor(radius / 3));
  const sw = Math.max(1, Math.ceil(w / f)), sh = Math.max(1, Math.ceil(h / f));
  let data = new Float32Array(sw * sh);
  if (f > 1) {
    const cnt = new Float32Array(sw * sh);
    for (let y = 0; y < h; y++) { const row = ((y / f) | 0) * sw; for (let x = 0; x < w; x++) { const j = row + ((x / f) | 0); data[j] += get(y * w + x); cnt[j]++; } }
    for (let j = 0; j < data.length; j++) data[j] /= cnt[j] || 1;
  } else for (let i = 0; i < w * h; i++) data[i] = get(i);
  const r = radius / f;
  data = boxBlur(boxBlur(data, sw, sh, r * 0.6), sw, sh, r * 0.6);
  return {
    // x, y in pixels of the original image
    at(x, y) {
      let fx = (x + 0.5) / f - 0.5, fy = (y + 0.5) / f - 0.5;
      if (fx < 0) fx = 0; else if (fx > sw - 1) fx = sw - 1;
      if (fy < 0) fy = 0; else if (fy > sh - 1) fy = sh - 1;
      const x0 = fx | 0, y0 = fy | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      return (data[y0 * sw + x0] * (1 - tx) + data[y0 * sw + x1] * tx) * (1 - ty) + (data[y1 * sw + x0] * (1 - tx) + data[y1 * sw + x1] * tx) * ty;
    },
  };
}

// ---------------------------------------------------------------- Geometry
// opts: { w, h                 image region in pixels
//         fullW, fullH         size of the whole target (document or layer) in target pixels
//         originX, originY     position of the region in the target (target pixels)
//         pxScale              target pixels per region pixel (downsampled preview > 1)
//         lineBase             height over which the lines are counted (layer: document height; else fullH)
//         params }
function geometry(opts) {
  const p = sanitize(opts.params), w = opts.w, h = opts.h;
  const fullW = opts.fullW || w, fullH = opts.fullH || h, ps = opts.pxScale || 1;
  const pitch = (opts.lineBase || fullH) / p.lines;
  const ang = p.tilt / 100 * 0.07;
  return { p, w, h, N: w * h, fullW, fullH, ox: opts.originX || 0, oy: opts.originY || 0, ps, pitch, pitchS: pitch / ps,
    k: p.curvature / 100 * 0.32, s: p.seed | 0, tilt: p.tilt > 0, cosA: Math.cos(ang), sinA: Math.sin(ang), key: p.tilt / 100 * 0.14 };
}
// tube curvature: screen coordinate -> image coordinate (null = outside the tube)
function warp(g, X, Y, out) {
  if (g.tilt) {   // photographed at an angle: slightly rotated and narrower at the top (keystone)
    const dx = X - g.fullW / 2, dy = Y - g.fullH / 2;
    X = g.fullW / 2 + dx * g.cosA + dy * g.sinA; Y = g.fullH / 2 - dx * g.sinA + dy * g.cosA;
  }
  let u = X / g.fullW * 2 - 1;
  const v = Y / g.fullH * 2 - 1;
  if (g.tilt) u = u * (1 + g.key * v) * (1 + g.key * 0.6);
  const cu = u * (1 + g.k * v * v), cv = v * (1 + g.k * u * u);
  out[2] = Math.max(Math.abs(cu), Math.abs(cv));   // 1 = tube edge
  if (cu < -1 || cu > 1 || cv < -1 || cv > 1) return false;
  out[0] = (cu + 1) / 2 * g.fullW; out[1] = (cv + 1) / 2 * g.fullH;
  return true;
}

// ---------------------------------------------------------------- Signal
// opts also: rgba (8-bit RGBA of the region), opaque (true = whole document, false = layer: the signal
// covers exactly the shape of the layer, line gaps and edges outside the tube are black inside it – like a
// screen in the shape of the object). Returns: RGBA (Uint8ClampedArray)
function renderSignal(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, fullW, fullH, ox, oy, ps, pitch, pitchS, s } = g;
  const src = opts.rgba, opaque = opts.opaque !== false;
  const lineMode = p.mode !== "clear";
  const Ls = lineMode && p.mode !== "straight"
    ? smoothField((i) => (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255 * src[i * 4 + 3] / 255, w, h, (0.25 + p.smooth / 100 * 2.2) * pitchS)
    : null;
  // bilinear sampling of the source at target coordinates -> out[0..3] in 0..1
  const sample = (X, Y, out) => {
    let fx = (X - ox) / ps - 0.5, fy = (Y - oy) / ps - 0.5;
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
    if (fy < 0) fy = 0; else if (fy > h - 1) fy = h - 1;
    const x0 = fx | 0, y0 = fy | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
    const w00 = (1 - tx) * (1 - ty) / 255, w10 = tx * (1 - ty) / 255, w01 = (1 - tx) * ty / 255, w11 = tx * ty / 255;
    for (let c = 0; c < 4; c++) out[c] = src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11;
    return out;
  };
  const tint = hexRgb(p.tint), lowC = hexRgb(p.tintLow), highC = hexRgb(p.tintHigh);
  const ilc = p.interlace / 100, wob = p.wobble / 100 * pitch * 3.5, wobLen = pitch * 26, wobPh = hash2(s, 7, 3) * 6.283;
  // burn-in: soft, offset, fixed copy of the bright parts
  const burn = p.burnIn / 100 * 0.42;
  const Bf = burn > 0 ? smoothField((i) => { const v = (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255 * src[i * 4 + 3] / 255; return v > 0.45 ? v : 0; }, w, h, Math.max(1, pitchS * 1.2)) : null;
  // overlays (whole document only)
  const osd = opaque ? osdLayout(p, fullW, fullH) : [];
  const shiftPx = p.rgbShift / 100 * pitch * 0.9;
  const ghostA = p.ghost / 100 * 0.45, ghostDx = pitch * 4.5;
  const con = 1 + p.contrast / 100, bri = p.brightness / 100;
  const waveK = p.wave / 100 * 16, thick = p.thickness / 100;
  const pxInPitch = ps / pitch, fine = pitchS >= 2.2, dotsK = p.dots / 100;
  const rollC = hash2(s, 3, 91) * fullH, rollW = fullH * 0.13, roll = p.rollbar / 100;
  const jit = p.jitter / 100, gl = p.glitch / 100, nz = p.noise / 100;
  const out = new Uint8ClampedArray(N * 4);
  const c0 = [0, 0, 0, 0], c1 = [0, 0, 0, 0], c2 = [0, 0, 0, 0], cg = [0, 0, 0, 0], q = [0, 0, 0];

  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, X = ox + (x + 0.5) * ps;
      if (!warp(g, X, Y, q)) { out[i * 4 + 3] = opaque ? 255 : sample(X, Y, c0)[3] * 255; continue; }
      const SX0 = q[0];   // undisturbed position (for overlays)
      let SX = SX0;
      const SY = q[1], t0 = SY / pitch, li = Math.floor(t0);
      // wobble (bad reception) and interlace offset (every second line shifted sideways)
      if (wob > 0) SX += wob * Math.sin(SY / wobLen * 6.283 + wobPh) + wob * 0.35 * Math.sin(SY / (wobLen * 0.37) + wobPh * 2);
      const odd = (li & 1) === 1;
      if (ilc > 0 && odd) SX += ilc * pitch * 2.2;
      // line jitter (tracking) and occasional tears
      if (jit > 0) {
        SX += (noise1(li * 0.23, s + 5) - 0.5) * jit * pitch * 3;
        if (hash2(li >> 1, 9, s) < jit * 0.06) SX += (hash2(li >> 1, 10, s) - 0.5) * jit * fullW * 0.06;
      }
      // glitch: shifted, coarsely pixelated blocks
      let blockCol = 0;
      if (gl > 0) {
        const band = Math.floor(SY / (pitch * 3));
        if (hash2(band, 21, s) < gl * 0.55) {
          const a0 = (hash2(band, 22, s) - 0.2) * fullW, len = (0.1 + 0.7 * hash2(band, 23, s)) * fullW;
          if (SX > a0 && SX < a0 + len) {
            SX += (hash2(band, 24, s) - 0.5) * fullW * 0.35 * gl;
            const blk = pitch * (2 + 6 * hash2(band, 25, s));
            SX = Math.floor(SX / blk) * blk + blk / 2;
            blockCol = (hash2(band, 26, s) - 0.5) * 0.9;
          }
        }
      }
      // sample the colour channels offset (RGB shift) + ghost image
      sample(SX + shiftPx, SY, c0); sample(SX, SY, c1); sample(SX - shiftPx, SY, c2);
      let r = c0[0], gg = c1[1], b = c2[2], a = Math.max(c0[3], c1[3], c2[3]);
      if (ghostA > 0) { sample(SX - ghostDx, SY, cg); r += cg[0] * ghostA; gg += cg[1] * ghostA; b += cg[2] * ghostA; a = Math.max(a, cg[3] * ghostA); }
      if (blockCol) { r = clamp01(r + blockCol); b = clamp01(b - blockCol); }
      r = clamp01((r - 0.5) * con + 0.5 + bri); gg = clamp01((gg - 0.5) * con + 0.5 + bri); b = clamp01((b - 0.5) * con + 0.5 + bri);
      const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (p.colorMode === "phosphor") {
        const hot = Math.max(0, lum - 0.72) * 2.2;   // very bright areas burn to white
        r = clamp01(tint[0] * lum * 1.15 + hot); gg = clamp01(tint[1] * lum * 1.15 + hot); b = clamp01(tint[2] * lum * 1.15 + hot);
      } else if (p.colorMode === "gradient") {
        // gradient: black → dark tone → middle → light tone
        const l = clamp01(lum * 1.08);
        let c0r, c0g, c0b, c1r, c1g, c1b, f;
        if (l < 0.33) { f = l / 0.33; c0r = 0; c0g = 0; c0b = 0; c1r = lowC[0]; c1g = lowC[1]; c1b = lowC[2]; }
        else if (l < 0.7) { f = (l - 0.33) / 0.37; c0r = lowC[0]; c0g = lowC[1]; c0b = lowC[2]; c1r = tint[0]; c1g = tint[1]; c1b = tint[2]; }
        else { f = (l - 0.7) / 0.3; c0r = tint[0]; c0g = tint[1]; c0b = tint[2]; c1r = highC[0]; c1g = highC[1]; c1b = highC[2]; }
        r = c0r + (c1r - c0r) * f; gg = c0g + (c1g - c0g) * f; b = c0b + (c1b - c0b) * f;
      }
      if (ilc > 0 && odd) { const d = 1 - ilc * 0.18; r *= d; gg *= d; b *= d; }
      if (Bf) { const v = Bf.at((SX - pitch * 7 - ox) / ps - 0.5, (SY - pitch * 4 - oy) / ps - 0.5) * burn; r = clamp01(r + v * 0.8); gg = clamp01(gg + v * 0.9); b = clamp01(b + v * 0.75); }
      // line signal: thickness follows brightness; with wave/swirl the brightness bends the lines
      let m = 1;
      if (lineMode) {
        let t = t0;
        if (p.mode !== "straight") {
          const ls = Ls.at((SX - ox) / ps - 0.5, (SY - oy) / ps - 0.5);
          t += waveK * ls;
          if (p.mode === "swirl") t += p.wave / 100 * (3.2 * (fbm(SX / (pitch * 16), SY / (pitch * 16), s + 31) - 0.5) + 0.5 * Math.sin(SX / (pitch * 7) + ls * 6));
        }
        const hw = 0.5 * thick * (0.12 + 0.88 * lum);
        if (fine) { const f = t - Math.floor(t) - 0.5; m = clamp01((hw - Math.abs(f)) / pxInPitch + 0.5); }
        else m = Math.min(1, 2 * hw);
        if (dotsK > 0) {
          const hd = 0.5 * (1 - dotsK * 0.55);
          let dc;
          if (fine) { const fx = SX / pitch - Math.floor(SX / pitch) - 0.5; dc = clamp01((hd - Math.abs(fx)) / pxInPitch + 0.5); }
          else dc = 2 * hd;
          m *= 1 - dotsK + dotsK * dc;
        }
        r = clamp01(r * 1.3); gg = clamp01(gg * 1.3); b = clamp01(b * 1.3);
      }
      if (roll > 0) { const d = (Y - rollC) / rollW, rb = 1 - 0.18 * roll + 0.45 * roll * Math.exp(-d * d); r = clamp01(r * rb); gg = clamp01(gg * rb); b = clamp01(b * rb); }
      // noise and snow (anchored to the target pixel, so detail preview and result match)
      if (nz > 0) {
        const Xi = Math.floor(X), Yi = Math.floor(Y);
        const gr = (hash2(Xi, Yi, s + 40) - 0.5) * 0.32 * nz;
        const snow = hash2(Xi, Yi, s + 41) < nz * 0.025 ? 0.55 * nz + 0.2 : 0;
        r = clamp01(r + gr + snow); gg = clamp01(gg + gr + snow); b = clamp01(b + gr + snow);
      }
      if (opaque) {
        const k2 = m * a;   // whole document: gaps black; transparent areas count as black
        r *= k2; gg *= k2; b *= k2;
        // overlay: pixel font with a shadow, sits in the signal (follows the curvature, gets mask/scanlines/bloom)
        for (const el of osd) {
          if (osdCover(el, SX0 - el.u * 0.7, SY - el.u * 0.7)) { r *= 0.15; gg *= 0.15; b *= 0.15; }
          if (osdCover(el, SX0, SY)) { r = el.color[0]; gg = el.color[1]; b = el.color[2]; }
        }
        out[i * 4] = r * 255; out[i * 4 + 1] = gg * 255; out[i * 4 + 2] = b * 255; out[i * 4 + 3] = 255;
      } else {
        out[i * 4] = r * m * 255; out[i * 4 + 1] = gg * m * 255; out[i * 4 + 2] = b * m * 255; out[i * 4 + 3] = sample(X, Y, cg)[3] * 255;
      }
    }
  }
  return out;
}

// bloom: blur the bright parts of the signal (for the Screen blend mode)
function renderBloom(opts, signal) {
  const g = geometry(opts), p = g.p, { w, h, N } = g;
  if (p.bloom <= 0) return null;
  const rad = Math.max(1, (0.5 + p.bloomRadius / 100 * 6) * g.pitchS);
  const f = [0, 1, 2].map((c) => smoothField((i) => { const v = signal[i * 4 + c] / 255 * signal[i * 4 + 3] / 255; return v > 0.18 ? (v - 0.18) / 0.82 : 0; }, w, h, rad));
  const out = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    out[i] = Math.min(1, f[0].at(x, y) * 1.8) * 255; out[i + 1] = Math.min(1, f[1].at(x, y) * 1.8) * 255; out[i + 2] = Math.min(1, f[2].at(x, y) * 1.8) * 255; out[i + 3] = 255;
  }
  return out;
}

// phosphor mask (sits on the glass, doesn't follow the curvature)
function renderMask(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, pitch } = g;
  if (p.mask === "none" || p.maskStrength <= 0) return null;
  const out = new Uint8ClampedArray(N * 4);
  const cw = Math.max(3, pitch * p.maskSize / 100 * 1.5);   // width of an RGB triple in target pixels (at least 1 px per colour)
  const lo = 0.16, flat = cw / 3 / ps < 1;                 // too fine in the downsampled preview -> average instead of moiré
  const flatV = { aperture: (1 + 2 * lo) / 3, slot: (1 + 2 * lo) / 3 * 0.86, shadow: 0.36, led: 0.4 }[p.mask];
  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, X = ox + (x + 0.5) * ps;
      let r = 1, gg = 1, b = 1;
      if (flat) r = gg = b = flatV;
      else if (p.mask === "aperture" || p.mask === "slot") {
        const col = Math.floor(X / (cw / 3)), j = ((col % 3) + 3) % 3;
        r = j === 0 ? 1 : lo; gg = j === 1 ? 1 : lo; b = j === 2 ? 1 : lo;
        const e = X / (cw / 3) - col; if (e < 0.1 || e > 0.9) { r *= 0.55; gg *= 0.55; b *= 0.55; }
        if (p.mask === "slot") {
          const triad = Math.floor(X / cw), yy = Y / (cw * 1.1) + (triad % 2) * 0.5;
          if (yy - Math.floor(yy) < 0.14) { r *= 0.12; gg *= 0.12; b *= 0.12; }
        }
      } else if (p.mask === "shadow") {
        const dp = cw / 3, rowH = dp * 0.866;
        const row = Math.floor(Y / rowH), off = (row % 2) * dp * 1.5;
        const cx = Math.floor((X - off) / dp), j = (((cx + row * 2) % 3) + 3) % 3;
        const dx = X - off - (cx + 0.5) * dp, dy = Y - (row + 0.5) * rowH;
        const on = clamp01((0.46 * dp - Math.sqrt(dx * dx + dy * dy)) / ps + 0.5);
        r = 0.06 + 0.94 * on * (j === 0 ? 1 : lo); gg = 0.06 + 0.94 * on * (j === 1 ? 1 : lo); b = 0.06 + 0.94 * on * (j === 2 ? 1 : lo);
      } else if (p.mask === "led") {
        const fx = X / cw - Math.floor(X / cw), fy = Y / cw - Math.floor(Y / cw), gap = 0.12;
        if (fx < gap || fy < gap) r = gg = b = 0.05;
        else { const j = Math.floor((fx - gap) / (1 - gap) * 3); r = j === 0 ? 1 : 0.22; gg = j === 1 ? 1 : 0.22; b = j === 2 ? 1 : 0.22; }
      }
      out[i] = r * 255; out[i + 1] = gg * 255; out[i + 2] = b * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// scanlines: dark gaps between the lines, follow the curvature
function renderScan(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, pitch } = g;
  if (p.scanlines <= 0) return null;
  const out = new Uint8ClampedArray(N * 4), flat = g.pitchS < 2.2, flatV = 1 - 0.85 * 0.375, q = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, X = ox + (x + 0.5) * ps;
      let v = 1;
      if (warp(g, X, Y, q)) {
        if (flat) v = flatV;
        else { const t = q[1] / pitch, f = t - Math.floor(t), sl = 0.5 - 0.5 * Math.cos(2 * Math.PI * f); v = 1 - 0.85 * Math.pow(1 - sl, 1.5); }
      }
      out[i] = out[i + 1] = out[i + 2] = v * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// glass: vignette and round corners
function renderGlass(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, fullW, fullH } = g;
  if (p.vignette <= 0 && p.corners <= 0 && p.moire <= 0) return null;
  const mo = p.moire / 100, per = g.pitch * 13, ma = 0.55, fx = Math.cos(ma) / per, fy = Math.sin(ma) / per;
  const out = new Uint8ClampedArray(N * 4);
  const rad = p.corners / 100 * 0.22 * Math.min(fullW, fullH), vg = p.vignette / 100;
  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, X = ox + (x + 0.5) * ps;
      const u = X / fullW * 2 - 1, v = Y / fullH * 2 - 1, d = Math.sqrt(u * u * 0.8 + v * v);
      let val = 1 - vg * 0.8 * Math.pow(clamp01((d - 0.35) / 0.95), 1.6);
      if (rad > 0) {
        const qx = Math.max(0, Math.abs(X - fullW / 2) - (fullW / 2 - rad)), qy = Math.max(0, Math.abs(Y - fullH / 2) - (fullH / 2 - rad));
        val *= clamp01(0.5 - (Math.sqrt(qx * qx + qy * qy) - rad) / ps);
      }
      let gR = val, gG = val, gB = val;
      if (mo > 0) {
        // moiré like a photographed screen: curved, slightly coloured interference stripes
        // two slightly different grids overlap -> wide, curved beat bands
        const ph = 6.283 * (X * fx + Y * fy) + 7 * noise2(X / (fullH * 0.4), Y / (fullH * 0.4), g.s + 61) + 1.5 * Math.sin(6.283 * (X * fy - Y * fx) * 0.35);
        const k = mo * 0.36 * (0.55 + 0.45 * noise2(X / (fullH * 0.25), Y / (fullH * 0.25), g.s + 62));
        gR *= 1 - k * Math.pow(0.5 + 0.5 * Math.cos(ph), 2); gG *= 1 - k * Math.pow(0.5 + 0.5 * Math.cos(ph + 2.1), 2); gB *= 1 - k * Math.pow(0.5 + 0.5 * Math.cos(ph + 4.2), 2);
      }
      out[i] = gR * 255; out[i + 1] = gG * 255; out[i + 2] = gB * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// reflex: reflection of a window at the top of the glass, a diagonal sheen and a light rim at the tube edge
function renderReflex(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, fullW, fullH } = g;
  if (p.reflection <= 0) return null;
  const out = new Uint8ClampedArray(N * 4), q = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, X = ox + (x + 0.5) * ps;
      const u = X / fullW * 2 - 1, v = Y / fullH * 2 - 1;
      let val = 0;
      if (warp(g, X, Y, q)) {
        const du = (u + 0.3) / 0.85, dv = (v + 0.66) / 0.36;
        const glare = 0.32 * Math.exp(-(du * du + dv * dv) * 2.4);
        const t = u * 0.55 + v + 0.62, sheen = 0.16 * Math.exp(-(t * t) / 0.004);
        const rim = 0.4 * Math.pow(clamp01((q[2] - 0.9) / 0.1), 2.5);
        val = Math.min(1, glare + sheen + rim);
      }
      out[i] = val * 0.9 * 255; out[i + 1] = val * 0.96 * 255; out[i + 2] = val * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// the layers top to bottom, as they lie in the group. clip = clipping mask onto the signal.
const LAYERS = [
  { key: "bloom", name: "Bloom", mode: "screen", opacity: (p) => p.bloom, clip: false },
  { key: "reflex", name: "Reflex", mode: "screen", opacity: (p) => p.reflection, clip: true },
  { key: "glass", name: "Glass", mode: "multiply", opacity: () => 100, clip: true },
  { key: "scan", name: "Scanlines", mode: "multiply", opacity: (p) => p.scanlines, clip: true },
  { key: "mask", name: "Mask", mode: "multiply", opacity: (p) => p.maskStrength, clip: true },
  { key: "signal", name: "Signal", mode: "normal", opacity: () => 100, clip: false },
];
// everything at once (preview, tests)
function render(opts) {
  const signal = renderSignal(opts);
  return { signal, bloom: renderBloom(opts, signal), mask: renderMask(opts), scan: renderScan(opts), glass: renderGlass(opts), reflex: renderReflex(opts), params: sanitize(opts.params) };
}

// stack the layers like Photoshop does (preview and verify).
// base: RGB below (Uint8, 3 channels) or null = black; original: image without the effect for the group opacity
function composite(res, w, h, base, original) {
  const p = res.params, N = w * h, out = new Uint8Array(N * 3);
  const mo = p.maskStrength / 100, so = p.scanlines / 100, bo = p.bloom / 100, ro = p.reflection / 100, st = p.strength / 100;
  for (let i = 0; i < N; i++) {
    const sa = res.signal[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const bg = base ? base[i * 3 + c] / 255 : 0;
      let sv = res.signal[i * 4 + c] / 255;
      if (res.mask) sv *= 1 - mo + mo * res.mask[i * 4 + c] / 255;
      if (res.scan) sv *= 1 - so + so * res.scan[i * 4 + c] / 255;
      if (res.glass) sv *= res.glass[i * 4 + c] / 255;
      if (res.reflex) sv = 1 - (1 - sv) * (1 - res.reflex[i * 4 + c] / 255 * ro);
      let v = sv * sa + bg * (1 - sa);
      if (res.bloom) { const bl = res.bloom[i * 4 + c] / 255 * bo; v = 1 - (1 - v) * (1 - bl); }
      const o = original ? original[i * 3 + c] / 255 : bg;
      out[i * 3 + c] = Math.round((o * (1 - st) + v * st) * 255);
    }
  }
  return out;
}

// which layers these settings create
function layerKeys(p) {
  p = sanitize(p);
  const has = { signal: true, bloom: p.bloom > 0, mask: p.mask !== "none" && p.maskStrength > 0, scan: p.scanlines > 0,
    glass: p.vignette > 0 || p.corners > 0 || p.moire > 0, reflex: p.reflection > 0 };
  return LAYERS.filter((d) => has[d.key]).map((d) => d.key);
}
const api = { DEFAULTS, MODES, MASKS, TINTS, GRADIENTS, OSDS, PRESETS, RANGES, LAYERS, presetParams, sanitize, cleanOsdText, layerKeys,
  render, renderSignal, renderBloom, renderMask, renderScan, renderGlass, renderReflex, composite, hexRgb };
if (typeof module !== "undefined") module.exports = api;
