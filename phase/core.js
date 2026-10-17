"use strict";
// MS Phase – Kern-Engine (reines JavaScript, läuft im Panel und in Node).
// Rechnet ein Bild in einen Röhrenfernseher-Look um. Ergebnis sind mehrere Ebenen, die Photoshop
// später als echte Ebenen mit Mischmodus bekommt:
//   signal  Normal    das Bild als Fernsehsignal (Linien, Farbe, Versatz, Störungen)
//   mask    Multipl.  Phosphor-Maske (Streifen, Lochmaske, Schlitzmaske, LED)
//   scan    Multipl.  Scanlines
//   glass   Multipl.  Vignette und runde Ecken
//   bloom   Negativ multipl. (Screen)  Leuchten heller Stellen
// Alle Größen hängen an der Zeilenzahl über die Bildhöhe – darum sieht die kleine Vorschau aus wie
// das Ergebnis in voller Auflösung.

const DEFAULTS = {
  mode: "wave",      // clear | straight | wave | swirl
  lines: 180,            // Zeilen über die Bildhöhe
  wave: 45,              // Wellenstärke (Welle, Wirbel)
  thickness: 70,         // maximale Linienstärke
  smooth: 35,            // Glättung der Wellen
  dots: 0,               // Linien in Punkte zerlegen
  colorMode: "phosphor", // original | phosphor
  tint: "#3fd4ff",
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
  rgbShift: 25,
  ghost: 0,
  noise: 12,
  rollbar: 0,
  jitter: 0,
  glitch: 0,
  seed: 7,
  strength: 100,         // Deckkraft der ganzen Gruppe
};

const MODES = [
  { id: "clear", name: "Klar", hint: "Bild bleibt geschlossen" },
  { id: "straight", name: "Gerade", hint: "gerade Zeilen, Stärke nach Helligkeit" },
  { id: "wave", name: "Welle", hint: "Zeilen biegen sich mit der Helligkeit" },
  { id: "swirl", name: "Wirbel", hint: "fließende, verwirbelte Zeilen" },
];
const MASKS = [
  { id: "none", name: "Keine" },
  { id: "aperture", name: "Streifenmaske" },
  { id: "shadow", name: "Lochmaske" },
  { id: "slot", name: "Schlitzmaske" },
  { id: "led", name: "LED-Raster" },
];
const TINTS = [
  { id: "#3fd4ff", name: "Cyan" }, { id: "#39ff7a", name: "Grün (P1)" }, { id: "#ffb43a", name: "Bernstein" },
  { id: "#9fc8ff", name: "Eisblau" }, { id: "#ff4fd8", name: "Magenta" }, { id: "#f2f2f2", name: "Weiß" },
];

// 15 Looks. Jeder Look setzt alle Werte (fehlende = Standard), darum sehen sie immer gleich aus.
const PRESETS = [
  { id: "phase", name: "Phase", p: {} },
  { id: "straight", name: "Zeilen", p: { mode: "straight", lines: 150, thickness: 80, wave: 0, tint: "#9fc8ff", bloom: 45 } },
  { id: "swirl", name: "Wirbel", p: { mode: "swirl", wave: 60, lines: 160, tint: "#ff4fd8", bloom: 60 } },
  { id: "dotwave", name: "Dot Wave", p: { mode: "wave", dots: 70, lines: 140, thickness: 85, tint: "#3fd4ff", bloom: 65 } },
  { id: "hologram", name: "Hologramm", p: { mode: "wave", wave: 30, lines: 220, tint: "#4fb4ff", contrast: 0, rgbShift: 45, ghost: 35, noise: 18, bloom: 70, jitter: 15 } },
  { id: "terminal", name: "Terminal", p: { mode: "clear", tint: "#39ff7a", contrast: 35, scanlines: 60, bloom: 60, curvature: 35, vignette: 55, corners: 45, rgbShift: 0, noise: 10, lines: 240 } },
  { id: "amber", name: "Bernstein", p: { mode: "clear", tint: "#ffb43a", contrast: 30, scanlines: 55, bloom: 55, curvature: 30, vignette: 50, corners: 40, rgbShift: 0, lines: 200 } },
  { id: "trinitron", name: "Trinitron", p: { mode: "clear", colorMode: "original", mask: "aperture", maskStrength: 55, scanlines: 30, bloom: 35, rgbShift: 10, noise: 4, lines: 240, contrast: 10 } },
  { id: "arcade", name: "Arcade", p: { mode: "clear", colorMode: "original", mask: "shadow", maskStrength: 60, scanlines: 45, bloom: 55, curvature: 45, vignette: 45, corners: 50, rgbShift: 15, lines: 224, contrast: 20 } },
  { id: "tv80s", name: "Wohnzimmer 80er", p: { mode: "clear", colorMode: "original", mask: "slot", maskStrength: 45, scanlines: 30, bloom: 40, curvature: 55, vignette: 60, corners: 65, rgbShift: 30, ghost: 25, noise: 18, lines: 240 } },
  { id: "vhs", name: "VHS", p: { mode: "clear", colorMode: "original", scanlines: 20, bloom: 35, rgbShift: 70, ghost: 30, noise: 30, jitter: 45, rollbar: 25, lines: 240, contrast: 5 } },
  { id: "static", name: "Rauschen", p: { mode: "clear", colorMode: "original", scanlines: 35, bloom: 30, noise: 80, rollbar: 55, rgbShift: 25, jitter: 20, curvature: 30, vignette: 45, lines: 200 } },
  { id: "lost", name: "Signal verloren", p: { mode: "straight", tint: "#3fd4ff", glitch: 70, jitter: 35, rgbShift: 60, noise: 35, lines: 170, thickness: 75, bloom: 60 } },
  { id: "ledwall", name: "LED-Wand", p: { mode: "clear", colorMode: "original", mask: "led", maskSize: 260, maskStrength: 85, scanlines: 0, bloom: 50, rgbShift: 0, noise: 0, vignette: 0, lines: 120, contrast: 20 } },
  { id: "nightvision", name: "Nachtsicht", p: { mode: "clear", tint: "#39ff7a", contrast: 45, brightness: 10, scanlines: 35, bloom: 70, noise: 55, vignette: 80, corners: 0, rgbShift: 0, lines: 260 } },
];
function presetParams(id) {
  const pr = PRESETS.find((x) => x.id === id);
  return pr ? Object.assign({}, DEFAULTS, pr.p) : null;
}

// Werte prüfen und auf ihre Grenzen setzen (gespeicherte Einstellungen können alt oder kaputt sein)
const RANGES = {
  lines: [40, 600], wave: [0, 100], thickness: [10, 100], smooth: [0, 100], dots: [0, 100], contrast: [-50, 100], brightness: [-50, 50],
  maskSize: [50, 400], maskStrength: [0, 100], scanlines: [0, 100], bloom: [0, 100], bloomRadius: [5, 100], curvature: [0, 100],
  vignette: [0, 100], corners: [0, 100], rgbShift: [0, 100], ghost: [0, 100], noise: [0, 100], rollbar: [0, 100], jitter: [0, 100],
  glitch: [0, 100], seed: [0, 99999], strength: [0, 100],
};
function sanitize(p) {
  const out = Object.assign({}, DEFAULTS);
  if (!p || typeof p !== "object") return out;
  for (const k of Object.keys(DEFAULTS)) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (RANGES[k]) { const n = Number(v); if (isFinite(n)) out[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n)); }
    else if (k === "mode") { if (MODES.some((m) => m.id === v)) out[k] = v; }
    else if (k === "mask") { if (MASKS.some((m) => m.id === v)) out[k] = v; }
    else if (k === "colorMode") { if (v === "original" || v === "phosphor") out[k] = v; }
    else if (k === "tint") { const t = String(v).toLowerCase(); if (/^#[0-9a-f]{6}$/.test(t)) out[k] = t; }
  }
  out.seed = Math.round(out.seed);
  return out;
}

// ---------------------------------------------------------------- Helfer
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

// Box-Blur (2 Durchgänge ≈ Gauß) auf einem Float-Feld; große Radien werden verkleinert gerechnet.
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
// geglättetes Feld mit Abtaster. get(i) liefert den Wert an Pixel i (Bild w×h); bei großem Radius wird
// direkt in eine verkleinerte Kopie gemittelt – so braucht auch ein sehr großes Bild kaum Speicher.
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
    // x, y in Pixeln des Originalbilds
    at(x, y) {
      let fx = (x + 0.5) / f - 0.5, fy = (y + 0.5) / f - 0.5;
      if (fx < 0) fx = 0; else if (fx > sw - 1) fx = sw - 1;
      if (fy < 0) fy = 0; else if (fy > sh - 1) fy = sh - 1;
      const x0 = fx | 0, y0 = fy | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      return (data[y0 * sw + x0] * (1 - tx) + data[y0 * sw + x1] * tx) * (1 - ty) + (data[y1 * sw + x0] * (1 - tx) + data[y1 * sw + x1] * tx) * ty;
    },
  };
}

// ---------------------------------------------------------------- Geometrie
// opts: { w, h                 Bildausschnitt in Pixeln
//         fullW, fullH         Größe des ganzen Ziels (Dokument oder Ebene) in Ziel-Pixeln
//         originX, originY     Lage des Ausschnitts im Ziel (Ziel-Pixel)
//         pxScale              Ziel-Pixel pro Ausschnitt-Pixel (Vorschau verkleinert > 1)
//         lineBase             Höhe, über die die Zeilen gezählt werden (Ebene: Dokumenthöhe; sonst fullH)
//         params }
function geometry(opts) {
  const p = sanitize(opts.params), w = opts.w, h = opts.h;
  const fullW = opts.fullW || w, fullH = opts.fullH || h, ps = opts.pxScale || 1;
  const pitch = (opts.lineBase || fullH) / p.lines;
  return { p, w, h, N: w * h, fullW, fullH, ox: opts.originX || 0, oy: opts.originY || 0, ps, pitch, pitchS: pitch / ps,
    k: p.curvature / 100 * 0.32, s: p.seed | 0 };
}
// Röhrenwölbung: Bildschirm-Koordinate -> Bild-Koordinate (null = außerhalb der Röhre)
function warp(g, X, Y, out) {
  const u = X / g.fullW * 2 - 1, v = Y / g.fullH * 2 - 1;
  const cu = u * (1 + g.k * v * v), cv = v * (1 + g.k * u * u);
  if (cu < -1 || cu > 1 || cv < -1 || cv > 1) return false;
  out[0] = (cu + 1) / 2 * g.fullW; out[1] = (cv + 1) / 2 * g.fullH;
  return true;
}

// ---------------------------------------------------------------- Signal
// opts zusätzlich: rgba (8 Bit RGBA des Ausschnitts), opaque (true = ganzes Dokument, false = Ebene: das Signal
// deckt genau die Form der Ebene ab, Zeilenlücken und Ränder außerhalb der Röhre sind darin schwarz – wie ein
// Bildschirm in Form des Objekts). Rückgabe: RGBA (Uint8ClampedArray)
function renderSignal(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, fullW, fullH, ox, oy, ps, pitch, pitchS, s } = g;
  const src = opts.rgba, opaque = opts.opaque !== false;
  const lineMode = p.mode !== "clear";
  const Ls = lineMode && p.mode !== "straight"
    ? smoothField((i) => (0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]) / 255 * src[i * 4 + 3] / 255, w, h, (0.25 + p.smooth / 100 * 2.2) * pitchS)
    : null;
  // bilineares Abtasten der Quelle an Ziel-Koordinaten -> out[0..3] in 0..1
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
  const tint = hexRgb(p.tint);
  const shiftPx = p.rgbShift / 100 * pitch * 0.9;
  const ghostA = p.ghost / 100 * 0.45, ghostDx = pitch * 4.5;
  const con = 1 + p.contrast / 100, bri = p.brightness / 100;
  const waveK = p.wave / 100 * 16, thick = p.thickness / 100;
  const pxInPitch = ps / pitch, fine = pitchS >= 2.2, dotsK = p.dots / 100;
  const rollC = hash2(s, 3, 91) * fullH, rollW = fullH * 0.13, roll = p.rollbar / 100;
  const jit = p.jitter / 100, gl = p.glitch / 100, nz = p.noise / 100;
  const out = new Uint8ClampedArray(N * 4);
  const c0 = [0, 0, 0, 0], c1 = [0, 0, 0, 0], c2 = [0, 0, 0, 0], cg = [0, 0, 0, 0], q = [0, 0];

  for (let y = 0; y < h; y++) {
    const Y = oy + (y + 0.5) * ps;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, X = ox + (x + 0.5) * ps;
      if (!warp(g, X, Y, q)) { out[i * 4 + 3] = opaque ? 255 : sample(X, Y, c0)[3] * 255; continue; }
      let SX = q[0];
      const SY = q[1], t0 = SY / pitch, li = Math.floor(t0);
      // Zeilen-Zittern (Tracking) und gelegentliche Risse
      if (jit > 0) {
        SX += (noise1(li * 0.23, s + 5) - 0.5) * jit * pitch * 3;
        if (hash2(li >> 1, 9, s) < jit * 0.06) SX += (hash2(li >> 1, 10, s) - 0.5) * jit * fullW * 0.06;
      }
      // Glitch: verschobene, grob gerasterte Blöcke
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
      // Farbkanäle versetzt abtasten (RGB-Versatz) + Geisterbild
      sample(SX + shiftPx, SY, c0); sample(SX, SY, c1); sample(SX - shiftPx, SY, c2);
      let r = c0[0], gg = c1[1], b = c2[2], a = Math.max(c0[3], c1[3], c2[3]);
      if (ghostA > 0) { sample(SX - ghostDx, SY, cg); r += cg[0] * ghostA; gg += cg[1] * ghostA; b += cg[2] * ghostA; a = Math.max(a, cg[3] * ghostA); }
      if (blockCol) { r = clamp01(r + blockCol); b = clamp01(b - blockCol); }
      r = clamp01((r - 0.5) * con + 0.5 + bri); gg = clamp01((gg - 0.5) * con + 0.5 + bri); b = clamp01((b - 0.5) * con + 0.5 + bri);
      const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (p.colorMode === "phosphor") {
        const hot = Math.max(0, lum - 0.72) * 2.2;   // sehr helle Stellen brennen ins Weiße
        r = clamp01(tint[0] * lum * 1.15 + hot); gg = clamp01(tint[1] * lum * 1.15 + hot); b = clamp01(tint[2] * lum * 1.15 + hot);
      }
      // Zeilen-Signal: Linienstärke nach Helligkeit, bei Welle/Wirbel biegt die Helligkeit die Zeilen
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
      // Rauschen und Schnee (am Ziel-Pixel verankert, darum gleich in Vorschau-Detail und Ergebnis)
      if (nz > 0) {
        const Xi = Math.floor(X), Yi = Math.floor(Y);
        const gr = (hash2(Xi, Yi, s + 40) - 0.5) * 0.32 * nz;
        const snow = hash2(Xi, Yi, s + 41) < nz * 0.025 ? 0.55 * nz + 0.2 : 0;
        r = clamp01(r + gr + snow); gg = clamp01(gg + gr + snow); b = clamp01(b + gr + snow);
      }
      if (opaque) {
        const k2 = m * a;   // ganzes Dokument: Lücken schwarz; durchsichtige Stellen zählen als Schwarz
        out[i * 4] = r * k2 * 255; out[i * 4 + 1] = gg * k2 * 255; out[i * 4 + 2] = b * k2 * 255; out[i * 4 + 3] = 255;
      } else {
        out[i * 4] = r * m * 255; out[i * 4 + 1] = gg * m * 255; out[i * 4 + 2] = b * m * 255; out[i * 4 + 3] = sample(X, Y, cg)[3] * 255;
      }
    }
  }
  return out;
}

// Leuchten: helle Teile des Signals weichzeichnen (für den Mischmodus „Negativ multiplizieren“)
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

// Phosphor-Maske (sitzt auf dem Glas, folgt der Wölbung nicht)
function renderMask(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, pitch } = g;
  if (p.mask === "none" || p.maskStrength <= 0) return null;
  const out = new Uint8ClampedArray(N * 4);
  const cw = Math.max(3, pitch * p.maskSize / 100 * 1.5);   // Breite eines RGB-Tripels in Ziel-Pixeln (mind. 1 px je Farbe)
  const lo = 0.16, flat = cw / 3 / ps < 1;                 // in der verkleinerten Vorschau zu fein -> Mittelwert statt Moiré
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

// Scanlines: dunkle Lücken zwischen den Zeilen, folgen der Wölbung
function renderScan(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, pitch } = g;
  if (p.scanlines <= 0) return null;
  const out = new Uint8ClampedArray(N * 4), flat = g.pitchS < 2.2, flatV = 1 - 0.85 * 0.375, q = [0, 0];
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

// Glas: Vignette und runde Ecken
function renderGlass(opts) {
  const g = geometry(opts), p = g.p, { w, h, N, ox, oy, ps, fullW, fullH } = g;
  if (p.vignette <= 0 && p.corners <= 0) return null;
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
      out[i] = out[i + 1] = out[i + 2] = val * 255; out[i + 3] = 255;
    }
  }
  return out;
}

// Die Ebenen von oben nach unten, so wie sie in der Gruppe liegen. clip = Schnittmaske auf das Signal.
const LAYERS = [
  { key: "bloom", name: "Leuchten", mode: "screen", opacity: (p) => p.bloom, clip: false },
  { key: "glass", name: "Glas", mode: "multiply", opacity: () => 100, clip: true },
  { key: "scan", name: "Scanlines", mode: "multiply", opacity: (p) => p.scanlines, clip: true },
  { key: "mask", name: "Maske", mode: "multiply", opacity: (p) => p.maskStrength, clip: true },
  { key: "signal", name: "Signal", mode: "normal", opacity: () => 100, clip: false },
];
// alles auf einmal (Vorschau, Tests)
function render(opts) {
  const signal = renderSignal(opts);
  return { signal, bloom: renderBloom(opts, signal), mask: renderMask(opts), scan: renderScan(opts), glass: renderGlass(opts), params: sanitize(opts.params) };
}

// Ebenen wie in Photoshop übereinanderlegen (Vorschau und Prüfung).
// base: RGB darunter (Uint8, 3 Kanäle) oder null = schwarz; original: Bild ohne Effekt für die Gruppen-Deckkraft
function composite(res, w, h, base, original) {
  const p = res.params, N = w * h, out = new Uint8Array(N * 3);
  const mo = p.maskStrength / 100, so = p.scanlines / 100, bo = p.bloom / 100, st = p.strength / 100;
  for (let i = 0; i < N; i++) {
    const sa = res.signal[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const bg = base ? base[i * 3 + c] / 255 : 0;
      let sv = res.signal[i * 4 + c] / 255;
      if (res.mask) sv *= 1 - mo + mo * res.mask[i * 4 + c] / 255;
      if (res.scan) sv *= 1 - so + so * res.scan[i * 4 + c] / 255;
      if (res.glass) sv *= res.glass[i * 4 + c] / 255;
      let v = sv * sa + bg * (1 - sa);
      if (res.bloom) { const bl = res.bloom[i * 4 + c] / 255 * bo; v = 1 - (1 - v) * (1 - bl); }
      const o = original ? original[i * 3 + c] / 255 : bg;
      out[i * 3 + c] = Math.round((o * (1 - st) + v * st) * 255);
    }
  }
  return out;
}

const api = { DEFAULTS, MODES, MASKS, TINTS, PRESETS, RANGES, LAYERS, presetParams, sanitize, render, renderSignal, renderBloom, renderMask, renderScan, renderGlass, composite, hexRgb };
if (typeof module !== "undefined") module.exports = api;
