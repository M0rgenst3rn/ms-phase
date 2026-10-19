"use strict";
// MS Phase – Photoshop-UXP-Panel.
// CRT TV look for the whole document or single layers, non-destructive:
//  • Whole document: a group "MS Phase" on top with real layers (signal, mask, scanlines, glass, bloom).
//    The artwork below stays untouched.
//  • Selected layers: each layer moves into a group "MS Phase · name"; the original stays visible inside,
//    the signal covers exactly its shape (layer mask respected), mask/scanlines/glass are clipped
//    to the signal. Remove restores everything.
// The settings live in the XMP of the signal layer – selecting the group loads them back into the panel.

const { app, core, action, imaging, constants } = require("photoshop");
const { batchPlay } = action;
const Core = require("./core.js");
const UI = require("./ms-ui.js");
const uxpStorage = require("uxp").storage;
const lfs = uxpStorage.localFileSystem;

const $ = (id) => document.getElementById(id);
const STORE_KEY = "msphase.state.v1";
const TARGET_KEY = "msphase.target.v1";
const PRESET_KEY = "msphase.presets.v1";
const GROUP_DOC = "MS Phase";
const LAYER_PREFIX = "MS Phase · ";
const HIST = "MS Phase";
const XMP_NS = "http://ms-phase/1.0/";
const MAX_PIXELS = 60e6;
const TARGET = [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }];
// effect layer names, including the German names of earlier versions
const RENDER_NAMES = new Set(Core.LAYERS.map((l) => l.name).concat(["Leuchten", "Glas", "Maske"]));

const lineMode = (p) => p.mode !== "clear";
const waveMode = (p) => p.mode === "wave" || p.mode === "swirl";
const SLIDERS = [
  { key: "strength", label: "Opacity", min: 0, max: 100, step: 1, unit: "%", parent: "secStrengthTop" },
  { key: "lines", label: "Lines", min: 40, max: 600, step: 1, unit: "", parent: "secSignal", tip: "Lines over the whole image height – like a TV's resolution" },
  { key: "wave", label: "Waves", min: 0, max: 100, step: 1, unit: "%", parent: "secSignal", show: waveMode, tip: "How strongly bright areas bend the lines" },
  { key: "smooth", label: "Smoothing", min: 0, max: 100, step: 1, unit: "%", parent: "secFineSignal", show: waveMode, tip: "Softer, larger waves" },
  { key: "thickness", label: "Line thickness", min: 10, max: 100, step: 1, unit: "%", parent: "secFineSignal", show: lineMode, tip: "Thickness of the lines at the brightest spots" },
  { key: "dots", label: "Dots", min: 0, max: 100, step: 1, unit: "%", parent: "secFineSignal", show: lineMode, tip: "Breaks the lines into glowing dots" },
  { key: "contrast", label: "Contrast", min: -50, max: 100, step: 1, unit: "", parent: "secFineColor" },
  { key: "brightness", label: "Brightness", min: -50, max: 50, step: 1, unit: "", parent: "secFineColor" },
  { key: "maskSize", label: "Mask size", min: 50, max: 400, step: 5, unit: "%", parent: "secFineColor", show: (p) => p.mask !== "none" },
  { key: "maskStrength", label: "Mask strength", min: 0, max: 100, step: 1, unit: "%", parent: "secMask", show: (p) => p.mask !== "none" },
  { key: "scanlines", label: "Scanlines", min: 0, max: 100, step: 1, unit: "%", parent: "secScreen" },
  { key: "bloom", label: "Bloom", min: 0, max: 100, step: 1, unit: "%", parent: "secScreen" },
  { key: "bloomRadius", label: "Bloom radius", min: 5, max: 100, step: 1, unit: "%", parent: "secScreen", show: (p) => p.bloom > 0, sub: true },
  { key: "curvature", label: "Curvature", min: 0, max: 100, step: 1, unit: "%", parent: "secScreen" },
  { key: "corners", label: "Round corners", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube" },
  { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, unit: "%", parent: "secScreen" },
  { key: "tilt", label: "Tilt", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube", tip: "As if photographed at an angle: slightly rotated and keystoned" },
  { key: "moire", label: "Moiré", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube", tip: "Coloured stripes like on a photographed screen" },
  { key: "reflection", label: "Reflex", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube", tip: "Reflection on the glass and a light rim at the tube edge" },
  { key: "rgbShift", label: "RGB shift", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube" },
  { key: "ghost", label: "Ghosting", min: 0, max: 100, step: 1, unit: "%", parent: "secFineTube" },
  { key: "noise", label: "Noise", min: 0, max: 100, step: 1, unit: "%", parent: "secScreen" },
  { key: "rollbar", label: "Roll bar", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise" },
  { key: "jitter", label: "Tracking", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise", tip: "Lines jitter sideways like on a video tape" },
  { key: "glitch", label: "Glitch", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise", tip: "Shifted, coarsely pixelated blocks" },
  { key: "interlace", label: "Interlace", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise", tip: "Every second line shifted sideways, like a filmed TV" },
  { key: "wobble", label: "Wobble", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise", tip: "The whole image wobbles in waves – bad reception" },
  { key: "burnIn", label: "Burn-in", min: 0, max: 100, step: 1, unit: "%", parent: "secFineNoise", tip: "Faint, fixed ghost of the bright parts" },
  { key: "osdSize", label: "Text size", min: 1.5, max: 12, step: 0.5, unit: "%", parent: "secOsd" },
];

let params = loadParams();
let target = loadTarget();         // "document" | "layers"
let previewSrc = null;
let thumbSrc = null;
let previewMode = "fit";
let busy = false;
let activeLook = null;
const ctl = {};
const lastApplied = new Map();     // target key -> params (for the "not applied yet" hint)
let loadedKey = null;              // group whose settings were last loaded into the panel

// ---------------------------------------------------------------- Persistence
function loadParams() { try { return Core.sanitize(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (e) { return Object.assign({}, Core.DEFAULTS); } }
function saveParams() { try { localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch (e) { /* ignore */ } }
function loadTarget() { try { return localStorage.getItem(TARGET_KEY) === "layers" ? "layers" : "document"; } catch (e) { return "document"; } }
function saveTarget() { try { localStorage.setItem(TARGET_KEY, target); } catch (e) { /* ignore */ } }
function loadUserPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || "{}"); } catch (e) { return {}; } }
function saveUserPresets(p) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- Helpers
function setStatus(msg, isErr) { const el = $("status"); el.textContent = msg || ""; el.className = isErr ? "status err" : "status"; }
function debounce(fn, ms) { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hexToRgb(hex) { const n = parseInt(String(hex).slice(1), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function rgbToHex(r, g, b) { return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
function docBounds(doc) { return { left: 0, top: 0, right: Math.round(Number(doc.width)), bottom: Math.round(Number(doc.height)) }; }
function boundsOf(layer) { const b = layer.boundsNoEffects || layer.bounds; return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) }; }
// Area of a layer with a margin for the bloom (5 % of the document height), limited to the document
function layerRegion(doc, layer) {
  const d = docBounds(doc), b = boundsOf(layer), pad = Math.round(d.bottom * 0.05);
  return clampBounds({ left: b.left - pad, top: b.top - pad, right: b.right + pad, bottom: b.bottom + pad }, d);
}
function clampBounds(b, d) { return { left: Math.max(d.left, b.left), top: Math.max(d.top, b.top), right: Math.min(d.right, b.right), bottom: Math.min(d.bottom, b.bottom) }; }
async function selectLayer(id) { await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false }], {}); }
async function selectLayers(ids) {
  const cmds = ids.map((id, i) => {
    const c = { _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false };
    if (i > 0) c.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
    return c;
  });
  if (cmds.length) await batchPlay(cmds, {});
}
function allLayers(container, out) { for (const l of container.layers || []) { out.push(l); if (l.layers) allLayers(l, out); } return out; }
const isGroup = (l) => !!(l && l.layers);
const isDocGroup = (l) => isGroup(l) && l.name === GROUP_DOC;
const isLayerGroup = (l) => isGroup(l) && String(l.name).startsWith(LAYER_PREFIX);
function docGroups(doc) { return doc.layers.filter(isDocGroup); }
function to8bit(data, cs) {
  if (cs === 8) return data;
  const out = new Uint8Array(data.length), f = cs === 16 ? 255 / 32768 : 255;
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(data[i] * f)));
  return out;
}
function fromBuf8(buf, doc) {
  if (buf instanceof Uint8ClampedArray) buf = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);   // Photoshop only takes Uint8/Uint16/Float32
  const depth = String(doc.bitsPerChannel || "");
  if (depth.indexOf("16") >= 0) { const out = new Uint16Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = Math.round(buf[i] * 32768 / 255); return out; }
  if (depth.indexOf("32") >= 0) { const out = new Float32Array(buf.length); for (let i = 0; i < buf.length; i++) out[i] = buf[i] / 255; return out; }
  return buf;
}
function toRGBA(raw, comps, n) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (comps >= 3) { out[i * 4] = raw[i * comps]; out[i * 4 + 1] = raw[i * comps + 1]; out[i * 4 + 2] = raw[i * comps + 2]; }
    else out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = raw[i * comps];
    out[i * 4 + 3] = comps === 4 || comps === 2 ? raw[i * comps + comps - 1] : 255;
  }
  return out;
}
function needsRGB(doc) {
  if (String(doc.mode).toLowerCase().indexOf("rgb") >= 0) return false;
  setStatus("MS Phase needs an RGB document – Image › Mode › RGB Color.", true);
  return true;
}

// ---------------------------------------------------------------- Log
const logLines = [];
let logTimer = null;
function log(msg, data) {
  logLines.push(new Date().toISOString() + " " + msg + (data !== undefined ? " " + JSON.stringify(data) : ""));
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    try { const f = await (await lfs.getDataFolder()).createFile("phase-log.txt", { overwrite: true }); await f.write(logLines.join("\n") + "\n"); } catch (e) { /* ignore */ }
  }, 300);
}

// ---------------------------------------------------------------- XMP (settings on the signal layer)
function xmpFor(p, sourceId) {
  const json = JSON.stringify({ params: p, sourceId: sourceId || null }).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:msphase="${XMP_NS}"><msphase:params>${json}</msphase:params></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
async function writeXmp(layerId, p, sourceId) {
  await batchPlay([{ _obj: "set", _target: [{ _ref: "property", _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }], to: { _obj: "layer", XMPMetadataAsUTF8: xmpFor(p, sourceId) } }], {});
}
async function readXmp(layerId) {
  try {
    const r = await batchPlay([{ _obj: "get", _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "layer", _id: layerId }] }], {});
    const x = r && r[0] && r[0].XMPMetadataAsUTF8;
    const m = x && /<msphase:params>([\s\S]*?)<\/msphase:params>/.exec(x);
    if (!m) return null;
    const o = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
    return { params: Core.sanitize(o.params), sourceId: o.sourceId || null };
  } catch (e) { return null; }
}
async function groupInfo(group) {
  const kids = Array.from(group.layers);
  const signal = kids.find((k) => k.name === "Signal" && !k.layers);
  const saved = signal ? await readXmp(signal.id) : null;
  let source = saved && saved.sourceId ? kids.find((k) => k.id === saved.sourceId) : null;
  if (!source) source = kids.slice().reverse().find((k) => !RENDER_NAMES.has(k.name)) || null;   // older/foreign groups
  return { group, source, signal, saved };
}

// Layer targets: selected layers; an effect group (or a layer inside it) stands for its original
async function resolveTargets(doc) {
  const out = [], seen = new Set(), skipped = [];
  for (const l of doc.activeLayers || []) {
    let g = null;
    if (isLayerGroup(l)) g = l;
    else if (l.parent && isLayerGroup(l.parent)) g = l.parent;
    if (g) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const info = await groupInfo(g);
      if (info.source) out.push(info); else skipped.push(g.name);
      continue;
    }
    if (isDocGroup(l) || (l.parent && isDocGroup(l.parent))) { skipped.push(l.name); continue; }
    if (isGroup(l) || l.isBackgroundLayer) { skipped.push(l.name); continue; }
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push({ group: null, source: l, signal: null, saved: null });
  }
  return { targets: out, skipped };
}

// ---------------------------------------------------------------- Reading pixels
// Document WITHOUT the effect's document group. hide/show: briefly hide/show more layers (history is
// rolled back). inHistory: already runs inside its own history step – then hide/show nothing
// that isn't replaced afterwards anyway.
async function readComposite(ctx, doc, sourceBounds, targetSize, opt) {
  opt = opt || {};
  const hide = docGroups(doc).filter((g) => g.visible).concat((opt.hide || []).filter((l) => l.visible));
  const show = (opt.show || []).filter((l) => !l.visible);
  let hid = null;
  if (hide.length || show.length) {
    if (!opt.inHistory) hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " read" });
    for (const l of hide) l.visible = false;
    for (const l of show) l.visible = true;
  }
  try {
    const o = { documentID: doc.id, sourceBounds, colorSpace: "RGB", componentSize: 8 };
    if (targetSize) o.targetSize = targetSize;
    const res = await imaging.getPixels(o);
    const id = res.imageData;
    const raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
    const out = { w: id.width, h: id.height, rgba: toRGBA(raw, id.components, id.width * id.height), sb: res.sourceBounds || sourceBounds };
    id.dispose();
    return out;
  } finally {
    if (hid !== null) await ctx.hostControl.resumeHistory(hid, false);
    else if (opt.inHistory) { for (const l of hide) l.visible = true; for (const l of show) l.visible = false; }
  }
}
async function hasActiveMask(id) {
  try {
    const r = await batchPlay([{ _obj: "get", _target: [{ _property: "hasUserMask" }, { _ref: "layer", _id: id }] }, { _obj: "get", _target: [{ _property: "userMaskEnabled" }, { _ref: "layer", _id: id }] }], {});
    return !!(r && r[0] && r[0].hasUserMask) && !(r[1] && r[1].userMaskEnabled === false);
  } catch (e) { return false; }
}
// Pixels of a layer at full resolution over sourceBounds – including the layer mask (cut-out objects).
// A hidden original is shown briefly. inHistory: already runs inside its own history step.
async function readLayer(ctx, doc, layer, sourceBounds, inHistory) {
  let hid = null;
  const wasHidden = !layer.visible;
  if (wasHidden) { if (!inHistory) hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " read" }); layer.visible = true; }
  const W = sourceBounds.right - sourceBounds.left, H = sourceBounds.bottom - sourceBounds.top;
  const rgba = new Uint8Array(W * H * 4);
  try {
    const res = await imaging.getPixels({ documentID: doc.id, layerID: layer.id, sourceBounds, colorSpace: "RGB", componentSize: 8 });
    const id = res.imageData, raw = to8bit(await id.getData({ chunky: true }), id.componentSize || 8);
    const sb = res.sourceBounds || sourceBounds, src = toRGBA(raw, id.components, id.width * id.height);
    // getPixels only returns the occupied area – place it on the requested region
    for (let y = 0; y < id.height; y++) for (let x = 0; x < id.width; x++) {
      const tx = sb.left - sourceBounds.left + x, ty = sb.top - sourceBounds.top + y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const s = (y * id.width + x) * 4, d = (ty * W + tx) * 4;
      rgba[d] = src[s]; rgba[d + 1] = src[s + 1]; rgba[d + 2] = src[s + 2]; rgba[d + 3] = src[s + 3];
    }
    id.dispose();
    if (await hasActiveMask(layer.id)) {
      const mr = await imaging.getLayerMask({ documentID: doc.id, layerID: layer.id, kind: "user", sourceBounds });
      const md = mr.imageData, mraw = to8bit(await md.getData({ chunky: true }), md.componentSize || 8);
      const mb = mr.sourceBounds || sourceBounds, mw = md.width, mh = md.height;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        // outside the returned mask its edge value applies
        const mx = Math.max(0, Math.min(mw - 1, sourceBounds.left + x - mb.left)), my = Math.max(0, Math.min(mh - 1, sourceBounds.top + y - mb.top));
        const i = (y * W + x) * 4;
        rgba[i + 3] = rgba[i + 3] * mraw[(my * mw + mx) * md.components] / 255;
      }
      md.dispose();
    }
    return { w: W, h: H, rgba };
  } finally {
    if (wasHidden) { layer.visible = false; if (hid !== null) await ctx.hostControl.resumeHistory(hid, false); }
  }
}
// Downsamples an RGBA image (box average, alpha-weighted) to a grid of ps source pixels per pixel
function downsample(src, sw, sh, ox, oy, w, h, ps) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(ox + x * ps), x1 = Math.max(x0 + 1, Math.floor(ox + (x + 1) * ps));
    const y0 = Math.floor(oy + y * ps), y1 = Math.max(y0 + 1, Math.floor(oy + (y + 1) * ps));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = Math.max(0, y0); yy < Math.min(sh, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(sw, x1); xx++) {
      const i = (yy * sw + xx) * 4, al = src[i + 3];
      r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++;
    }
    n = (x1 - x0) * (y1 - y0);
    const o = (y * w + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / n;
  }
  return out;
}

// ---------------------------------------------------------------- Controls (Morgenstern design, ms-ui.js)
function buildSliders() {
  for (const s of SLIDERS) {
    const c = UI.slider($(s.parent), Object.assign({ def: Core.DEFAULTS[s.key] }, s), {
      get: () => params[s.key],
      set: (v) => { params[s.key] = v; activeLook = null; changed(); },
      done: () => syncUI(),
    });
    ctl[s.key] = c;
  }
}
function buildStatic() {
  UI.seg($("modeSeg"), Core.MODES.map((m) => ({ id: m.id, name: m.name, tip: m.hint })), (v) => { params.mode = v; activeLook = null; syncUI(); changed(); });
  UI.seg($("maskSeg"), Core.MASKS.map((m) => ({ id: m.id, name: m.name })), (v) => { params.mask = v; activeLook = null; syncUI(); changed(); });
  UI.seg($("osdSeg"), Core.OSDS.map((o) => ({ id: o.id, name: o.name })), (v) => {
    params.osd = v; activeLook = null; syncUI(); changed();
    if (params.osd !== "none" && target === "layers") setStatus("Overlays only appear with \"Whole document\".");
  });
  $("gradPresets").innerHTML = Core.GRADIENTS.map((g, i) => `<div class="grad" data-grad="${i}" title="${g.name}"><div style="background-color:${g.low}"></div><div style="background-color:${g.mid}"></div><div style="background-color:${g.high}"></div></div>`).join("");
  const grid = $("lookGrid");
  grid.innerHTML = "";
  for (const pr of Core.PRESETS) {
    const t = document.createElement("div");
    t.className = "look";
    t.dataset.id = pr.id;
    t.title = pr.name;
    t.innerHTML = `<div class="ph"></div><div class="lbl">${pr.name}</div>`;
    t.addEventListener("click", () => applyLook(pr.id));
    grid.appendChild(t);
  }
  rebuildPresetSelect();
}
// own presets as a list: click loads, × deletes
function rebuildPresetSelect() {
  UI.presetList($("presetList"), Object.keys(loadUserPresets()),
    (n) => { params = Core.sanitize(loadUserPresets()[n]); activeLook = null; syncUI(); changed(); setStatus(`Preset "${n}" loaded.`); },
    (n) => { const u = loadUserPresets(); delete u[n]; saveUserPresets(u); rebuildPresetSelect(); setStatus(`Preset "${n}" deleted.`); });
}
function applyLook(id) {
  const pr = Core.presetParams(id);
  if (!pr) return;
  params = Object.assign(pr, { strength: params.strength });
  activeLook = id;
  syncUI(); changed();
  setStatus(`Look "${Core.PRESETS.find((x) => x.id === id).name}" – every slider stays adjustable.`);
}

function syncUI() {
  for (const key of Object.keys(ctl)) {
    const c = ctl[key];
    c.set(params[key]);
    c.row.className = "sl" + (c.def.sub ? " sub" : "") + (c.def.show && !c.def.show(params) ? " hidden" : "");
  }
  UI.syncSeg($("modeSeg"), params.mode);
  UI.syncSeg($("maskSeg"), params.mask);
  UI.syncSeg($("osdSeg"), params.osd);
  document.querySelectorAll("#colorSeg .seg-btn").forEach((el) => { el.className = el.dataset.color === params.colorMode ? "seg-btn active" : "seg-btn"; });
  document.querySelectorAll("#targetSeg .seg-btn").forEach((el) => { el.className = el.dataset.target === target ? "seg-btn active" : "seg-btn"; });
  document.querySelectorAll("#previewModeSeg .seg-btn").forEach((el) => { el.className = el.dataset.mode === previewMode ? "seg-btn active" : "seg-btn"; });
  document.querySelectorAll(".look").forEach((el) => { el.className = el.dataset.id === activeLook ? "look active" : "look"; });
  $("lookName").textContent = activeLook ? Core.PRESETS.find((x) => x.id === activeLook).name : "";
  $("modeHint").textContent = (Core.MODES.find((m) => m.id === params.mode) || {}).hint || "";
  $("tintRow").className = params.colorMode === "phosphor" ? "row sub" : "row sub hidden";
  $("gradRow").className = params.colorMode === "gradient" ? "subgroup" : "subgroup hidden";
  for (const [id, key] of COLOR_FIELDS) { $("swatch-" + id).style.backgroundColor = params[key]; $("hexl-" + id).textContent = params[key]; }
  $("osdControls").className = params.osd === "none" ? "hidden" : "";
  $("osdName").textContent = params.osd === "none" ? "" : (Core.OSDS.find((o) => o.id === params.osd) || {}).name || "";
  if (document.activeElement !== $("osdText")) $("osdText").value = params.osdText;
  $("seed").value = String(params.seed);
  UI.syncSwitches();
  $("apply").textContent = target === "document" ? "Apply" : "Apply to layer";
}

const SEC_KEY = "msphase.sections.v1";
const SEC_DEFAULT = { looks: true, signal: true, color: true, screen: true, osd: false, fine: false, more: false };
function bindControls() {
  UI.sections(SEC_KEY, SEC_DEFAULT);
  UI.bindSwitch("previewOriginal", () => renderPreview());
  UI.bindSwitch("liveCanvas", (on) => {
    liveLast = null;
    if (on) applyEffect(true);
    else setStatus("Live off – the current state stays in the document.");
  });
  document.querySelectorAll("#colorSeg .seg-btn").forEach((el) => el.addEventListener("click", () => { params.colorMode = el.dataset.color; activeLook = null; syncUI(); changed(); }));
  document.querySelectorAll("#targetSeg .seg-btn").forEach((el) => el.addEventListener("click", () => {
    target = el.dataset.target; saveTarget(); loadedKey = null; previewSrc = null; thumbSrc = null; syncUI(); refreshPreviewSource();
  }));
  document.querySelectorAll("#previewModeSeg .seg-btn").forEach((el) => el.addEventListener("click", () => { previewMode = el.dataset.mode; syncUI(); refreshPreviewSource(); }));
  for (const [id, key] of COLOR_FIELDS) $("swatch-" + id).addEventListener("click", () => openColor(id, key));
  document.querySelectorAll(".grad").forEach((el) => el.addEventListener("click", () => {
    const g = Core.GRADIENTS[Number(el.dataset.grad)];
    Object.assign(params, { tintLow: g.low, tint: g.mid, tintHigh: g.high }); activeLook = null; UI.closeColorPop($("colorPop")); syncUI(); changed();
  }));
  $("osdText").addEventListener("input", (e) => { params.osdText = Core.cleanOsdText(e.target.value); activeLook = null; changed(); });
  $("seed").addEventListener("change", (e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) params.seed = Math.max(0, Math.min(99999, v)); syncUI(); changed(); });
  $("dice").addEventListener("click", () => { params.seed = Math.floor(Math.random() * 99999); syncUI(); changed(); });
  $("refreshPreview").addEventListener("click", () => { previewSrc = null; refreshPreviewSource(); });
  $("presetSave").addEventListener("click", () => {
    const name = String($("presetName").value || "").trim();
    if (!name) return setStatus("Give the preset a name first.", true);
    const user = loadUserPresets(); user[name] = Object.assign({}, params); saveUserPresets(user);
    rebuildPresetSelect(); $("presetName").value = "";
    setStatus(`Preset "${name}" saved.`);
  });
  $("resetAll").addEventListener("click", () => { params = Object.assign({}, Core.DEFAULTS); activeLook = "phase"; syncUI(); changed(); });
  $("apply").addEventListener("click", () => applyEffect(false));
  $("remove").addEventListener("click", removeEffect);
  $("verify").addEventListener("click", verifyNowUI);
  $("selfTest").addEventListener("click", runSelfTest);
}

// colour fields: [element ID, parameter] – own popover, Photoshop's colour picker only via "Pick exactly…"
const COLOR_FIELDS = [["tint", "tint"], ["tint2", "tint"], ["tintLow", "tintLow"], ["tintHigh", "tintHigh"], ["osdColor", "osdColor"]];
const PHASE_PALETTE = Core.TINTS.map((t) => String(t.id).toLowerCase()).concat(UI.PALETTE).filter((c, i, a) => a.indexOf(c) === i);
function openColor(id, key) {
  UI.openColorPop({
    pop: $("colorPop"), key: id, anchor: $("swatch-" + id), palette: PHASE_PALETTE,
    get: () => params[key],
    set: (c) => { params[key] = c; activeLook = null; syncUI(); changed(); },
    exact: () => pickColor(key),
  });
}
async function pickColor(key) {
  const c0 = hexToRgb(params[key]);
  try {
    let res;
    await core.executeAsModal(async () => {
      res = await batchPlay([{ _obj: "showColorPicker", _target: { _ref: "application" }, context: "MS Phase", color: { _obj: "RGBColor", red: c0.r, grain: c0.g, blue: c0.b } }], {});
    }, { commandName: "Pick colour" });
    const c = res && res[0] && (res[0].RGBFloatColor || res[0].color);
    if (c && c.red !== undefined) { params[key] = rgbToHex(c.red, c.grain !== undefined ? c.grain : c.green, c.blue); activeLook = null; syncUI(); changed(); }
  } catch (e) { setStatus("Colour picker not available – type a hex value.", true); }
}

const debouncedPreview = debounce(() => renderPreview(), 60);
function changed() {
  params = Core.sanitize(params);
  saveParams();
  debouncedPreview();
  if ($("liveCanvas").checked) debouncedLive();
  else showSyncHint();
}
function showSyncHint() {
  const key = previewSrc && previewSrc.key;
  const applied = key && lastApplied.get(key);
  if (!applied) return;
  const diff = Object.keys(Core.DEFAULTS).filter((k) => JSON.stringify(applied[k]) !== JSON.stringify(params[k]));
  if (diff.length) setStatus(`● Not in the document yet – click "${$("apply").textContent}" or turn on Live.`);
  else setStatus("Document matches the settings.");
}

// ---------------------------------------------------------------- Preview
const PV_W = 300, PV_H = 170, TH_W = 96, TH_H = 54;
const GRAY = 26;
function sizeFit(w, h, mw, mh) { const f = Math.min(1, mw / w, mh / h); return { width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)) }; }
function rgbOf(rgba, n, bg) {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = bg === null ? 1 : rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = rgba[i * 4 + c] * a + (bg || 0) * (1 - a);
  }
  return out;
}
function flatRGB(n, v) { const o = new Uint8Array(n * 3); o.fill(v); return o; }

async function refreshPreviewSource() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) { previewSrc = null; showTarget(null); return renderPreview("No document open."); }
  const dB = docBounds(doc), dw = dB.right, dh = dB.bottom;
  let info = null;
  if (target === "document") {
    const g = docGroups(doc)[0];
    if (g) info = await groupInfo(g);
    showTarget(doc.name || "Document");
  } else {
    const r = await resolveTargets(doc);
    if (!r.targets.length) {
      previewSrc = null; showTarget(null);
      return renderPreview(r.skipped.length ? "Edit groups and the background with \"Whole document\"." : "Select a layer in the Layers panel (image, text, shape)…");
    }
    info = r.targets[0];
    showTarget(info.source.name + (r.targets.length > 1 ? ` (+${r.targets.length - 1} weitere)` : ""));
  }
  // Take over the settings of an existing group (only when the group changes – open edits stay)
  if (info && info.group && info.saved) {
    if (loadedKey !== info.group.id) {
      loadedKey = info.group.id;
      params = Core.sanitize(info.saved.params); activeLook = null;
      lastApplied.set(targetKey(doc, info), Object.assign({}, params));
      saveParams(); syncUI();
      setStatus(`Settings loaded from "${info.group.name}".`);
    }
  } else loadedKey = null;
  // Target area: document or the layer; the preview always shows the document
  const lb = target === "document" ? dB : layerRegion(doc, info.source);
  const fw = lb.right - lb.left, fh = lb.bottom - lb.top;
  const ob = target === "document" ? dB : boundsOf(info.source);
  if (fw <= 0 || fh <= 0 || ob.right <= ob.left || ob.bottom <= ob.top) { previewSrc = null; return renderPreview("The layer is empty."); }
  let view = dB, ts = sizeFit(dw, dh, PV_W, PV_H);
  if (previewMode === "detail") {
    const w = Math.min(dw, PV_W), h = Math.min(dh, PV_H);
    const cx = (lb.left + lb.right) / 2, cy = (lb.top + lb.bottom) / 2;
    const left = Math.max(0, Math.min(dw - w, Math.round(cx - w / 2))), top = Math.max(0, Math.min(dh - h, Math.round(cy - h / 2)));
    view = { left, top, right: left + w, bottom: top + h }; ts = null;
  }
  const tts = sizeFit(dw, dh, TH_W, TH_H);
  try {
    let pv = null, th = null, lay = null;
    await core.executeAsModal(async (ctx) => {
      // in layer mode: document with the original, but without this object's old effect layers
      const opt = target === "layers" && info.group ? { hide: Array.from(info.group.layers).filter((k) => k.id !== info.source.id), show: [info.source] } : {};
      pv = await readComposite(ctx, doc, view, ts, opt);
      th = await readComposite(ctx, doc, dB, tts, opt);
      if (target === "layers") lay = await readLayer(ctx, doc, info.source, lb, false);
    }, { commandName: HIST + " preview" });
    ignoreEventsUntil = Date.now() + 600;
    const mk = (c, v, ps) => {
      const n = c.w * c.h, original = rgbOf(c.rgba, n, null);
      const s = { w: c.w, h: c.h, fullW: fw, fullH: fh, originX: v.left - lb.left, originY: v.top - lb.top, pxScale: ps, lineBase: dh, original, base: null, opaque: target === "document" };
      if (target === "document") s.rgba = c.rgba;
      else { s.rgba = downsample(lay.rgba, lay.w, lay.h, v.left - lb.left, v.top - lb.top, c.w, c.h, ps); s.base = original; }
      return s;
    };
    previewSrc = mk(pv, view, previewMode === "detail" ? 1 : dw / pv.w);
    previewSrc.key = targetKey(doc, info);
    const tsig = JSON.stringify([doc.id, target, lb, th.w, th.h]) + ":" + checksum(th.rgba) + ":" + (lay ? checksum(lay.rgba) : 0);
    const newThumbs = !thumbSrc || thumbSrc.sig !== tsig;
    thumbSrc = mk(th, dB, dw / th.w);
    thumbSrc.sig = tsig;
    renderPreview();
    if (newThumbs) renderThumbs();
  } catch (e) {
    previewSrc = null;
    renderPreview("Preview not possible: " + (e.message || e));
  }
}
// shows below the preview what is being edited
function showTarget(name) {
  $("targetName").textContent = name ? (target === "document" ? "Whole document" : "Layer: " + name) : "–";
  $("targetInfo").innerHTML = target === "document"
    ? `Editing: <b>the whole document</b>${name ? " · " + esc(name) : ""}`
    : name ? `Editing only: <b>${esc(name)}</b>` : `Editing only: <b>the selected layer</b> – please select one`;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function targetKey(doc, info) { return target === "document" ? "doc:" + doc.id : "layer:" + doc.id + ":" + (info && info.source ? info.source.id : "?"); }
function checksum(a) { let h = 0; for (let i = 0; i < a.length; i += 7) h = (h * 31 + a[i]) | 0; return h; }

function renderOn(s, p) {
  const res = Core.render({ rgba: s.rgba, w: s.w, h: s.h, fullW: s.fullW, fullH: s.fullH, originX: s.originX, originY: s.originY, pxScale: s.pxScale, lineBase: s.lineBase, opaque: s.opaque, params: p });
  return Core.composite(res, s.w, s.h, s.base, s.original);
}
let previewToken = 0;
async function renderPreview(msg) {
  const img = $("preview"), m = $("previewMsg");
  if (msg || !previewSrc) { img.className = "hidden"; m.className = "preview-msg"; m.textContent = msg || "Open a document…"; return; }
  const token = ++previewToken, s = previewSrc;
  const rgb = $("previewOriginal").checked ? s.original : renderOn(s, params);
  try {
    const url = await encodeRGB(rgb, s.w, s.h);
    if (token !== previewToken) return;
    img.src = url; img.className = ""; m.className = "hidden";
  } catch (e) { img.className = "hidden"; m.className = "preview-msg"; m.textContent = "The preview needs Photoshop 24.2 or newer."; }
}
async function encodeRGB(rgb, w, h) {
  const d = await imaging.createImageDataFromBuffer(rgb, { width: w, height: h, components: 3, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
  try { return "data:image/jpeg;base64," + await imaging.encodeImageData({ imageData: d, base64: true }); } finally { d.dispose(); }
}
// Look gallery with your own image
let thumbToken = 0;
async function renderThumbs() {
  const token = ++thumbToken, s = thumbSrc;
  if (!s) return;
  for (const pr of Core.PRESETS) {
    if (token !== thumbToken) return;
    try {
      const url = await encodeRGB(renderOn(s, Object.assign(Core.presetParams(pr.id), { strength: 100 })), s.w, s.h);
      const tile = document.querySelector(`.look[data-id="${pr.id}"]`);
      if (tile && token === thumbToken) {
        const img = document.createElement("img"); img.src = url;
        tile.replaceChild(img, tile.firstChild);
      }
    } catch (e) { log("thumb error", String(e.message || e)); return; }
    await sleep(0);
  }
}

// ---------------------------------------------------------------- Apply
async function makePixelLayer(doc, name, buf, w, h, off, mode, opacity) {
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name } }], {});
  const layer = doc.activeLayers[0];
  const d = await imaging.createImageDataFromBuffer(fromBuf8(buf, doc), { width: w, height: h, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
  try { await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData: d, targetBounds: { left: off.left, top: off.top } }); }
  finally { d.dispose(); }
  await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", mode: { _enum: "blendMode", _value: mode }, opacity: { _unit: "percentUnit", _value: opacity } } }], {});
  return layer.id;
}
// Opacity of a TV layer. Whole document: the overall opacity sits on the group. Layer: the original lies
// visible below the signal – the overall opacity sits on the signal (with everything clipped to it) and
// on the bloom, so it mixes the effect with the original instead of fading the object.
function layerOpacity(def, p, layerMode) {
  if (!layerMode) return def.opacity(p);
  if (def.key === "signal") return p.strength;
  if (def.key === "bloom") return Math.round(p.bloom * p.strength / 100);
  return def.opacity(p);
}
// Creates the layers bottom to top above the active layer; each is computed on its own (little memory)
async function makeTvLayers(doc, o, off) {
  const p = Core.sanitize(o.params), made = [];
  const signal = Core.renderSignal(o);
  for (const def of Core.LAYERS.slice().reverse()) {
    let buf;
    if (def.key === "signal") buf = signal;
    else if (def.key === "bloom") buf = Core.renderBloom(o, signal);
    else if (def.key === "mask") buf = Core.renderMask(o);
    else if (def.key === "scan") buf = Core.renderScan(o);
    else if (def.key === "reflex") buf = Core.renderReflex(o);
    else buf = Core.renderGlass(o);
    if (!buf) continue;
    made.push({ id: await makePixelLayer(doc, def.name, buf, o.w, o.h, off, def.mode, layerOpacity(def, p, o.opaque === false)), def });
  }
  return made;
}
async function deleteDeep(l) { if (l.layers) for (const k of Array.from(l.layers)) await deleteDeep(k); await l.delete(); }
async function deleteDocGroups(doc) { for (const g of docGroups(doc)) await deleteDeep(g); }

async function applyDocument(ctx, doc, p) {
  await deleteDocGroups(doc);
  const b = docBounds(doc);
  if (b.right * b.bottom > MAX_PIXELS) throw new Error(`Document too large (${Math.round(b.right * b.bottom / 1e6)} MP, maximum ${MAX_PIXELS / 1e6} MP).`);
  const c = await readComposite(ctx, doc, b, null);
  if (doc.layers[0]) await selectLayer(doc.layers[0].id);
  const made = await makeTvLayers(doc, { rgba: c.rgba, w: c.w, h: c.h, params: p, opaque: true }, { left: 0, top: 0 });
  await selectLayers(made.map((m) => m.id));
  await batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }], from: { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }, name: GROUP_DOC }], {});
  await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", name: GROUP_DOC } }], {});
  // if an (expanded) group was selected on top, the new group lands inside it – move it to the very top
  const made0 = doc.activeLayers[0];
  if (made0 && made0.parent && doc.layers[0] && doc.layers[0].id !== made0.id) await made0.move(doc.layers[0], constants.ElementPlacement.PLACEBEFORE);
  const g = docGroups(doc)[0];
  if (g) { g.opacity = p.strength; loadedKey = g.id; }   // opacity via batchPlay on a fresh group would be ignored
  const sig = made.find((m) => m.def.key === "signal");
  if (sig) await writeXmp(sig.id, p, null);
  lastApplied.set("doc:" + doc.id, Object.assign({}, p));
  log("  document", { layers: made.map((m) => m.def.name), w: c.w, h: c.h });
}

async function applyLayer(ctx, doc, t, p) {
  const src = t.source;
  if (t.group) for (const k of Array.from(t.group.layers)) if (k.id !== src.id) await deleteDeep(k);
  const sb0 = boundsOf(src);
  if (sb0.right <= sb0.left || sb0.bottom <= sb0.top) throw new Error(`"${src.name}" is empty.`);
  const b = layerRegion(doc, src);
  const w = b.right - b.left, h = b.bottom - b.top;
  if (w * h > MAX_PIXELS) throw new Error(`"${src.name}" is too large.`);
  if (!src.visible) src.visible = true;   // the original lies visible below the signal (also for groups from 0.1)
  const px = await readLayer(ctx, doc, src, b, true);
  await selectLayer(src.id);
  const made = await makeTvLayers(doc, { rgba: px.rgba, w, h, params: p, opaque: false, lineBase: docBounds(doc).bottom }, b);
  const clip = made.filter((m) => m.def.clip).map((m) => m.id);
  if (clip.length) { await selectLayers(clip); await batchPlay([{ _obj: "groupEvent", _target: TARGET }], {}); }
  let group = t.group;
  if (!group) {
    await selectLayers([src.id].concat(made.map((m) => m.id)));
    await batchPlay([{ _obj: "make", _target: [{ _ref: "layerSection" }], from: { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }, name: LAYER_PREFIX + src.name }], {});
    group = doc.activeLayers[0];
    await batchPlay([{ _obj: "set", _target: TARGET, to: { _obj: "layer", name: LAYER_PREFIX + src.name } }], {});
  }
  group.opacity = 100;
  const sig = made.find((m) => m.def.key === "signal");
  if (sig) await writeXmp(sig.id, p, src.id);
  await selectLayer(group.id);
  lastApplied.set("layer:" + doc.id + ":" + src.id, Object.assign({}, p));
  loadedKey = group.id;
  log("  layer", { source: src.name, layers: made.map((m) => m.def.name), w, h });
  return group;
}

let liveLast = null, livePending = false;
function historyStateId(doc) { try { return doc.activeHistoryState ? doc.activeHistoryState.id : null; } catch (e) { return null; } }
async function idleWithin(ms) { const end = Date.now() + ms; while (busy && Date.now() < end) await sleep(50); return !busy; }

async function applyEffect(live) {
  live = live === true;
  if (busy) {
    if (live) { livePending = true; return; }
    if (!(await idleWithin(6000))) return setStatus("Photoshop is still busy – try again in a moment.", true);
  }
  const doc = app.activeDocument;
  if (!doc) return setStatus("No document open.", true);
  if (needsRGB(doc)) return;
  let targets = null;
  if (target === "layers") {
    const r = await resolveTargets(doc);
    targets = r.targets;
    if (!targets.length) return setStatus(r.skipped.length ? "Edit groups and the background with \"Whole document\"." : "Select one or more layers first.", true);
  }
  busy = true;
  setStatus(live ? "Live-Update…" : "Erzeuge Look…");
  const t0 = Date.now();
  let error = null;
  const key = target === "document" ? "doc" : targets.map((t) => t.source.id).join(",");
  const replaceLast = live && liveLast && liveLast.docId === doc.id && liveLast.key === key && liveLast.stateId !== null && liveLast.stateId === historyStateId(doc);
  const p = Core.sanitize(params);
  log(live ? "LIVE" : "APPLY", { target: target, replaced: !!replaceLast, params: p });
  try {
    await core.executeAsModal(async (ctx) => {
      if (replaceLast) await batchPlay([{ _obj: "select", _target: [{ _ref: "historyState", _enum: "ordinal", _value: "previous" }] }], {});
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: live ? HIST + " Live" : HIST });
      try {
        if (target === "document") await applyDocument(ctx, doc, p);
        else {
          // after a Live undo the layer objects are new – resolve the targets again
          const list = replaceLast ? (await resolveTargets(doc)).targets : targets;
          const groups = [];
          for (const t of list) groups.push(await applyLayer(ctx, doc, t, p));
          if (groups.length > 1) await selectLayers(groups.map((g) => g.id));
        }
      } catch (e) {
        await ctx.hostControl.resumeHistory(hid, false);   // error: roll everything back, nothing half-done stays behind
        throw e;
      }
      await ctx.hostControl.resumeHistory(hid);
    }, { commandName: HIST + " apply" });
  } catch (e) { error = e.message || String(e); }
  liveLast = live && !error ? { docId: doc.id, key, stateId: historyStateId(doc) } : null;
  log("  result", { error, ms: Date.now() - t0 });
  ignoreEventsUntil = Date.now() + 700;
  busy = false;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (error) setStatus("Error: " + error, true);
  else if (!live) setStatus(target === "document" ? `Done in ${secs}s – group "${GROUP_DOC}" is on top. Undo with ⌘Z.` : `Done in ${secs}s – ${targets.length} layer(s) in ${HIST} groups. Remove restores the originals.`);
  else setStatus(`Live updated (${secs}s).`);
  if (livePending && $("liveCanvas").checked) { livePending = false; applyEffect(true); }
}
const debouncedLive = debounce(() => applyEffect(true), 250);

async function removeEffect() {
  if (busy && !(await idleWithin(6000))) return setStatus("Photoshop is still busy – try again in a moment.", true);
  const doc = app.activeDocument;
  if (!doc) return setStatus("No document open.", true);
  let list = [];
  if (target === "layers") {
    list = (await resolveTargets(doc)).targets.filter((t) => t.group);
    if (!list.length) return setStatus(`Select a ${HIST} group (or a layer inside it).`, true);
  } else if (!docGroups(doc).length) return setStatus(`No group "${GROUP_DOC}" in the document.`, true);
  busy = true;
  try {
    await core.executeAsModal(async (ctx) => {
      const hid = await ctx.hostControl.suspendHistory({ documentID: doc.id, name: HIST + " remove" });
      try {
        if (target === "document") await deleteDocGroups(doc);
        else for (const t of list) await unwrap(t);
      } catch (e) { await ctx.hostControl.resumeHistory(hid, false); throw e; }
      await ctx.hostControl.resumeHistory(hid);
    }, { commandName: HIST + " remove" });
    for (const t of list) lastApplied.delete("layer:" + doc.id + ":" + t.source.id);
    if (target === "document") lastApplied.delete("doc:" + doc.id);
    loadedKey = null;
    log("REMOVE", { target: target, groups: list.length });
    setStatus(target === "document" ? `Group "${GROUP_DOC}" removed.` : `${list.length} original(s) restored.`);
  } catch (e) { setStatus("Error while removing: " + (e.message || e), true); }
  ignoreEventsUntil = Date.now() + 700;
  busy = false;
}
// Dissolve the group: delete the effect layers, original visible in the same place
async function unwrap(t) {
  for (const k of Array.from(t.group.layers)) if (k.id !== t.source.id) await deleteDeep(k);
  await selectLayer(t.group.id);
  await batchPlay([{ _obj: "ungroupLayersEvent", _target: TARGET }], {});
  t.source.visible = true;
  await selectLayer(t.source.id);
}

// ---------------------------------------------------------------- Verify
async function readLayerRGBA(doc, layerId, b) {
  const r = await imaging.getPixels({ documentID: doc.id, layerID: layerId, sourceBounds: b, colorSpace: "RGB", componentSize: 8 });
  const d = r.imageData, raw = to8bit(await d.getData({ chunky: true }), d.componentSize || 8);
  const rb = r.sourceBounds || b, W = b.right - b.left, H = b.bottom - b.top, out = new Uint8Array(W * H * 4), c = d.components;
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const tx = rb.left - b.left + x, ty = rb.top - b.top + y;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    const s = (y * d.width + x) * c, o = (ty * W + tx) * 4;
    out[o] = raw[s]; out[o + 1] = raw[s + 1]; out[o + 2] = raw[s + 2]; out[o + 3] = c >= 4 ? raw[s + 3] : 255;
  }
  d.dispose();
  return out;
}
// Share (in %) of pixels that differ clearly (colour only where the signal is visible)
function pixelDiff(exp, act) {
  let big = 0, n = 0;
  for (let i = 0; i < exp.length; i += 4) {
    const ea = exp[i + 3], aa = act[i + 3];
    if (ea < 8 && aa < 8) continue;
    n++;
    if (Math.abs(ea - aa) > 40) { big++; continue; }
    if (ea > 64 && (Math.abs(exp[i] - act[i]) > 40 || Math.abs(exp[i + 1] - act[i + 1]) > 40 || Math.abs(exp[i + 2] - act[i + 2]) > 40)) big++;
  }
  return n ? Math.round(big / n * 1000) / 10 : 0;
}
function expectedLayers(o) {
  const sig = Core.renderSignal(o), keys = Core.layerKeys(o.params);
  return { signal: sig, defs: Core.LAYERS.filter((d) => keys.indexOf(d.key) >= 0) };
}
async function checkGroup(doc, g, o, b, sourceId) {
  const fail = [], p = Core.sanitize(o.params), kids = Array.from(g.layers);
  const exp = expectedLayers(o);
  const names = kids.filter((k) => k.id !== sourceId).map((k) => k.name), want = exp.defs.map((d) => d.name);
  if (JSON.stringify(names) !== JSON.stringify(want)) fail.push(`layers ${names.join("/")} instead of ${want.join("/")}`);
  const gOp = sourceId ? 100 : p.strength;
  if (Math.abs(Number(g.opacity) - gOp) > 1) fail.push(`group opacity ${g.opacity} instead of ${gOp}`);
  for (const d of exp.defs) {
    const l = kids.find((k) => k.name === d.name);
    if (!l) continue;
    const mode = String(l.blendMode || "").replace(/^BlendMode\./, "").toLowerCase();
    if (mode !== d.mode.toLowerCase()) fail.push(`${d.name}: blend mode ${mode} instead of ${d.mode}`);
    const op = layerOpacity(d, p, !!sourceId);
    if (Math.abs(Number(l.opacity) - op) > 1) fail.push(`${d.name}: opacity ${l.opacity} instead of ${op}`);
    if (sourceId && d.clip !== !!l.isClippingMask) fail.push(`${d.name}: clipping mask ${!!l.isClippingMask}`);
  }
  const sigL = kids.find((k) => k.name === "Signal");
  let diff = null;
  if (sigL) { diff = pixelDiff(exp.signal, await readLayerRGBA(doc, sigL.id, b)); if (diff > 1) fail.push(`Signal: ${diff}% Pixel anders`); }
  const saved = sigL ? await readXmp(sigL.id) : null;
  if (!saved || JSON.stringify(saved.params) !== JSON.stringify(p)) fail.push("settings in XMP missing/different");
  if (sourceId && (!saved || saved.sourceId !== sourceId)) fail.push("original ID in XMP wrong");
  return { fail, diff };
}
async function verifyDocument(ctx, doc, p) {
  const r = { errors: [] }, groups = docGroups(doc);
  if (groups.length !== 1) { r.errors.push(groups.length ? "several groups" : "group missing"); r.ok = false; return r; }
  if (doc.layers[0].id !== groups[0].id) r.errors.push("group not on top");
  const b = docBounds(doc), c = await readComposite(ctx, doc, b, null);
  const cg = await checkGroup(doc, groups[0], { rgba: c.rgba, w: c.w, h: c.h, params: p, opaque: true }, b, null);
  r.errors = r.errors.concat(cg.fail); r.deviation = cg.diff; r.ok = !r.errors.length;
  return r;
}
async function verifyLayerTarget(ctx, doc, t, p) {
  const r = { errors: [] };
  if (!t.group) { r.errors.push(`"${t.source.name}" belongs to no MS Phase group`); r.ok = false; return r; }
  if (!t.source.visible) r.errors.push("original is hidden");
  if (t.group.name !== LAYER_PREFIX + t.source.name) r.errors.push(`group name "${t.group.name}"`);
  const kids = Array.from(t.group.layers);
  if (kids[kids.length - 1].id !== t.source.id) r.errors.push("original is not at the bottom");
  const b = layerRegion(doc, t.source);
  const px = await readLayer(ctx, doc, t.source, b, false);
  const cg = await checkGroup(doc, t.group, { rgba: px.rgba, w: px.w, h: px.h, params: p, opaque: false, lineBase: docBounds(doc).bottom }, b, t.source.id);
  r.errors = r.errors.concat(cg.fail); r.deviation = cg.diff; r.ok = !r.errors.length;
  return r;
}
async function verifyNow(doc, p) {
  let r;
  await core.executeAsModal(async (ctx) => {
    if (target === "document") r = await verifyDocument(ctx, doc, p);
    else {
      const list = (await resolveTargets(doc)).targets;
      r = { ok: list.length > 0, errors: list.length ? [] : ["no layer selected"], layers: [] };
      for (const t of list) { const x = await verifyLayerTarget(ctx, doc, t, p); r.layers.push(x); if (!x.ok) { r.ok = false; r.errors = r.errors.concat(x.errors); } }
    }
  }, { commandName: HIST + " verify" });
  return r;
}
async function verifyNowUI() {
  if (busy) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("No document open.", true);
  busy = true;
  let r;
  try { r = await verifyNow(doc, Core.sanitize(params)); } catch (e) { r = { ok: false, errors: [e.message || String(e)] }; }
  busy = false;
  ignoreEventsUntil = Date.now() + 600;
  log("VERIFY", r);
  if (r.ok) setStatus("✓ The document matches the current settings.");
  else setStatus("✗ " + r.errors.join(", ") + " (details in the log)", true);
}

// ---------------------------------------------------------------- Self-test
function testArtwork(w, h) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const t = y / h;
    let c = [20 + 200 * t, 20 + 40 * t, 90 - 40 * t];
    const dx = x - 260, dy = y - 220, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 150) { const l = Math.max(0, 1 - d / 150); c = [60 + 190 * l, 140 + 110 * l, 200 + 55 * l]; }
    if (x > 520 && x < 820 && y > 120 && y < 320) c = [240, 190, 60];
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
  return buf;
}
let selfTestRunning = false;
async function runSelfTest() {
  if (busy || selfTestRunning) return;
  selfTestRunning = true;
  const saved = Object.assign({}, params), savedTarget = target, wasLive = $("liveCanvas").checked;
  $("liveCanvas").checked = false;
  const results = [], t0 = Date.now();
  let doc = null, artId = null, textId = null;
  const check = async (name, fn) => {
    try { const r = await fn(); results.push({ test: name, ok: !!r.ok, details: r }); }
    catch (e) { results.push({ test: name, ok: false, details: String(e && e.stack || e) }); }
    setStatus(`Self-test: ${results.length} – ${name}`);
  };
  log("SELFTEST START");
  setStatus("Self-test running… (1–2 minutes, please don't click)");
  try {
    await core.executeAsModal(async () => {
      doc = await app.documents.add({ width: 900, height: 520, resolution: 72, mode: "RGBColorMode", fill: "white", name: "MS Phase self-test" });
      await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: "Artwork" } }], {});
      const al = doc.activeLayers[0]; artId = al.id;
      const id = await imaging.createImageDataFromBuffer(testArtwork(900, 520), { width: 900, height: 520, components: 4, chunky: true, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1" });
      await imaging.putPixels({ documentID: doc.id, layerID: al.id, imageData: id, targetBounds: { left: 0, top: 0 } });
      id.dispose();
      await batchPlay([{ _obj: "make", _target: [{ _ref: "textLayer" }], using: { _obj: "textLayer", textKey: "MS Phase",
        textClickPoint: { _obj: "paint", horizontal: { _unit: "percentUnit", _value: 52 }, vertical: { _unit: "percentUnit", _value: 88 } },
        textStyleRange: [{ _obj: "textStyleRange", from: 0, to: 5, textStyle: { _obj: "textStyle", size: { _unit: "pointsUnit", _value: 110 }, color: { _obj: "RGBColor", red: 250, grain: 250, blue: 250 } } }] } }], {});
      textId = doc.activeLayers[0].id;
    }, { commandName: HIST + " prepare self-test" });
    const D = Object.assign({}, Core.DEFAULTS, { seed: 4242 });
    const docCase = async (name, over) => check(name, async () => {
      target = "document"; params = Core.sanitize(Object.assign({}, D, over));
      await applyEffect(false);
      if ($("status").className.indexOf("err") >= 0) return { ok: false, status: $("status").textContent };
      return verifyNow(doc, params);
    });
    for (const pr of Core.PRESETS) await docCase(`Look ${pr.name}`, Object.assign({ seed: 4242 }, pr.p));
    for (const m of Core.MODES) await docCase(`Signal ${m.name}`, { mode: m.id });
    for (const m of Core.MASKS) await docCase(`Mask ${m.name}`, { mode: "clear", mask: m.id, maskStrength: 70 });
    await docCase("Colour gradient", { colorMode: "gradient", tintLow: "#3a0a6b", tint: "#ff3fa4", tintHigh: "#ffe2a8" });
    await docCase("Filmed: tilt, moiré, reflex", { mode: "clear", tilt: 80, moire: 90, reflection: 70, curvature: 30 });
    await docCase("Interlace, wobble, burn-in", { interlace: 80, wobble: 70, burnIn: 80 });
    for (const o of Core.OSDS.filter((x) => x.id !== "none")) await docCase(`Overlay ${o.name}`, { osd: o.id, osdSize: 6 });
    await docCase("Overlay with own text", { osd: "channel", osdText: "CHANNEL 7 ▶" });
    await docCase("Limits: 40 lines, everything on", { lines: 40, curvature: 100, corners: 100, vignette: 100, glitch: 100, jitter: 100, noise: 100, rollbar: 100, ghost: 100, rgbShift: 100, dots: 100, tilt: 100, moire: 100, reflection: 100, interlace: 100, wobble: 100, burnIn: 100, osd: "cctv", osdSize: 12 });
    await docCase("Limits: 600 lines, everything off", { lines: 600, bloom: 0, scanlines: 0, vignette: 0, corners: 0, noise: 0, rgbShift: 0 });
    await docCase("Overall opacity 30", { strength: 30 });
    await check("Applying again replaces the group", async () => {
      await applyEffect(false); await applyEffect(false);
      return { ok: docGroups(doc).length === 1, groups: docGroups(doc).length };
    });
    await check("Live: several updates = one history step", async () => {
      liveLast = null;
      const s0 = historyStateId(doc);
      params = Core.sanitize(Object.assign({}, D, { mode: "straight" })); await applyEffect(true);
      params = Core.sanitize(Object.assign({}, D, { mode: "swirl" })); await applyEffect(true);
      params = Core.sanitize(Object.assign({}, D, { mode: "clear", mask: "shadow" })); await applyEffect(true);
      const states = doc.historyStates, ai = states.findIndex((st) => st.id === historyStateId(doc));
      const before = ai > 0 ? states[ai - 1].id : null;
      const v = await verifyNow(doc, params);
      return { ok: before === s0 && states[ai].name === HIST + " Live" && v.ok, s0, before, v };
    });
    liveLast = null;
    await check("Selecting the group loads its settings", async () => {
      const want = Object.assign({}, params);
      params = Object.assign({}, D, { lines: 99 }); loadedKey = null;
      await refreshPreviewSource();
      return { ok: JSON.stringify(params) === JSON.stringify(want), lines: params.lines };
    });
    await check("Remove (document) leaves nothing", async () => {
      await removeEffect();
      return { ok: docGroups(doc).length === 0 && doc.layers.length === 3, layers: doc.layers.map((l) => l.name) };
    });
    // ---- layers
    const layerCase = async (name, ids, over) => check(name, async () => {
      target = "layers"; params = Core.sanitize(Object.assign({}, D, over));
      await core.executeAsModal(async () => { await selectLayers(ids); }, { commandName: HIST + " test" });
      await applyEffect(false);
      return verifyNow(doc, params);
    });
    await layerCase("Layer: text", [textId], { mode: "wave", reflection: 50, osd: "play" });
    await layerCase("Layer: text again (via the group)", [textId], { mode: "clear", mask: "aperture", maskStrength: 80, curvature: 40, corners: 30 });
    await check("Layer: exactly one group, original visible below", async () => {
      const gs = doc.layers.filter(isLayerGroup);
      const t = gs[0] && await groupInfo(gs[0]);
      return { ok: gs.length === 1 && !!t && t.source.id === textId && t.source.visible, groups: gs.length };
    });
    await check("Layer: overall opacity mixes with the original (signal/bloom instead of group)", async () => {
      target = "layers"; params = Core.sanitize(Object.assign({}, D, { strength: 40, bloom: 50 }));
      await core.executeAsModal(async () => { await selectLayers([textId]); }, { commandName: HIST + " test" });
      await applyEffect(false);
      const v = await verifyNow(doc, params);
      const g = doc.layers.filter(isLayerGroup)[0], kids = Array.from(g.layers);
      const sig = kids.find((k) => k.name === "Signal"), bl = kids.find((k) => k.name === "Bloom");
      return { ok: v.ok && Number(g.opacity) === 100 && Math.round(Number(sig.opacity)) === 40 && Math.round(Number(bl.opacity)) === 20, v };
    });
    await check("Layer with mask: only the visible part gets the effect", async () => {
      // hide the right half of the artwork with a mask
      await core.executeAsModal(async () => {
        await selectLayers([artId]);
        await batchPlay([
          { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "rectangle", top: { _unit: "pixelsUnit", _value: 0 }, left: { _unit: "pixelsUnit", _value: 0 }, bottom: { _unit: "pixelsUnit", _value: 520 }, right: { _unit: "pixelsUnit", _value: 450 } } },
          { _obj: "make", new: { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: "revealSelection" } },
          { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } },
        ], {});
      }, { commandName: HIST + " test mask" });
      target = "layers"; params = Core.sanitize(Object.assign({}, D, { mode: "clear", bloom: 0 }));
      await applyEffect(false);
      const v = await verifyNow(doc, params);
      const g = doc.layers.filter(isLayerGroup).find((x) => x.name === LAYER_PREFIX + "Artwork");
      const sig = Array.from(g.layers).find((k) => k.name === "Signal");
      let left = -1, right = -1;
      await core.executeAsModal(async () => {
        const px = await readLayerRGBA(doc, sig.id, { left: 0, top: 0, right: 900, bottom: 520 });
        left = px[(260 * 900 + 200) * 4 + 3]; right = px[(260 * 900 + 700) * 4 + 3];
      }, { commandName: HIST + " test" });
      return { ok: v.ok && left > 200 && right < 10, left, right, v };
    });
    await layerCase("Two layers at once", [artId, textId], { mode: "straight", tint: "#39ff7a" });
    await check("Document look above layer groups", async () => {
      target = "document"; params = Core.sanitize(Object.assign({}, D, { mode: "clear", curvature: 30 }));
      await applyEffect(false);
      const v = await verifyNow(doc, params);
      await removeEffect();
      return v;
    });
    await check("Remove (layers) restores the originals", async () => {
      target = "layers";
      const gs = doc.layers.filter(isLayerGroup);
      await core.executeAsModal(async () => { await selectLayers(gs.map((g) => g.id)); }, { commandName: HIST + " test" });
      await removeEffect();
      const ls = allLayers(doc, []);
      const art = ls.find((l) => l.id === artId), txt = ls.find((l) => l.id === textId);
      return { ok: doc.layers.filter(isLayerGroup).length === 0 && !!art && !!txt && art.visible && txt.visible && !isLayerGroup(art.parent) && !isLayerGroup(txt.parent) && doc.layers.length === 3,
        layers: doc.layers.map((l) => l.name) };
    });
    await check("Check values (broken settings)", async () => {
      const s = Core.sanitize({ lines: "abc", wave: 999, mode: "xx", tint: "#fff", mask: "shadow" });
      return { ok: s.lines === Core.DEFAULTS.lines && s.wave === 100 && s.mode === Core.DEFAULTS.mode && s.tint === Core.DEFAULTS.tint && s.mask === "shadow", s };
    });
  } catch (e) {
    results.push({ test: "Self-test stopped", ok: false, details: String(e && e.stack || e) });
  }
  params = saved; target = savedTarget; saveTarget();
  $("liveCanvas").checked = wasLive;
  syncUI();
  const failed = results.filter((r) => !r.ok);
  log("SELFTEST RESULT", { passed: results.length - failed.length, total: results.length, seconds: Math.round((Date.now() - t0) / 1000) });
  for (const r of results) log((r.ok ? "  ✓ " : "  ✗ ") + r.test, r.ok ? undefined : r.details);
  setStatus(`Self-test: ${results.length - failed.length}/${results.length} passed` + (failed.length ? ` – failed: ${failed.map((r) => r.test).join(", ")}` : " ✓"), failed.length > 0);
  selfTestRunning = false;
  previewSrc = null; thumbSrc = null;
  refreshPreviewSource();
}

// ---------------------------------------------------------------- Start
let ignoreEventsUntil = 0;
const onPsEvent = debounce(() => {
  if (busy || selfTestRunning || Date.now() < ignoreEventsUntil) return;
  refreshPreviewSource();
}, 400);

async function init() {
  log("START", { ps: app.version });
  buildSliders();
  buildStatic();
  bindControls();
  syncUI();
  try { action.addNotificationListener(["select", "make", "delete", "open", "close", "set", "move", "transform", "placedLayerEditContents"], onPsEvent); }
  catch (e) { log("event listener not available", String(e)); }
  await refreshPreviewSource();
  // developer hook: a file "run-selftest" in the data folder starts the self-test (and is deleted)
  setInterval(async () => {
    if (busy || selfTestRunning) return;
    try { const f = await (await lfs.getDataFolder()).getEntry("run-selftest"); await f.delete(); runSelfTest(); } catch (e) { /* no request */ }
  }, 3000);
}
init();
