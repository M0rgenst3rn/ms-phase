// Builds the README images from a test scene (tools/make-scene.py) with the real engine.
// node tools/make-showcase.js   (needs Python with Pillow for the scene and labels)
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const Core = require(path.join(__dirname, "..", "phase", "core.js"));
const { encodePNG } = require("./png.js");
const OUT = path.join(__dirname, "..", "docs", "images"), TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "msphase-"));
fs.mkdirSync(OUT, { recursive: true });
function scene(w, h, text) {
  const f = path.join(TMP, `scene-${w}x${h}-${text.replace(/\W/g, "")}.png`);
  if (!fs.existsSync(f + ".raw")) execFileSync("python3", ["-I", path.join(__dirname, "make-scene.py"), f, String(w), String(h), text]);
  return new Uint8Array(fs.readFileSync(f + ".raw"));
}
function tv(rgba, w, h, p, crop) {
  const o = { rgba, w, h, params: p, opaque: true };
  if (crop) Object.assign(o, crop);
  const res = Core.render(o);
  return Core.composite(res, o.w, o.h, null, null);
}
function save(name, rgb, w, h) { const f = path.join(TMP, name + ".png"); fs.writeFileSync(f, encodePNG(w, h, rgb, 3)); return f; }
// assemble labelled tiles with Python/Pillow
function sheet(out, title, tiles, cols, tw, th) {
  const spec = { out: path.join(OUT, out), title, cols, tw, th, tiles };
  const js = path.join(TMP, "sheet.json"); fs.writeFileSync(js, JSON.stringify(spec));
  execFileSync("python3", ["-I", "-c", `
import json,sys
from PIL import Image, ImageDraw, ImageFont
s=json.load(open(sys.argv[1])); pad=16; head=70 if s["title"] else 0; lab=34
rows=(len(s["tiles"])+s["cols"]-1)//s["cols"]
W=s["cols"]*(s["tw"]+pad)+pad; H=head+rows*(s["th"]+lab+pad)+pad
im=Image.new("RGB",(W,H),(10,11,13)); d=ImageDraw.Draw(im)
fb=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf",34); fl=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf",19); fs=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf",14)
if s["title"]:
  t=Image.new("RGBA",(W,head)); ImageDraw.Draw(t).text((pad+4,14),s["title"],font=fb,fill=(242,242,242)); t=t.transform(t.size,Image.AFFINE,(1,0.2,-8,0,1,0),resample=Image.BICUBIC); im.paste(t,(0,0),t)
for n,tile in enumerate(s["tiles"]):
  x=pad+(n%s["cols"])*(s["tw"]+pad); y=head+pad+(n//s["cols"])*(s["th"]+lab+pad)
  im.paste(Image.open(tile["img"]).resize((s["tw"],s["th"]),Image.LANCZOS),(x,y))
  d.text((x+2,y+s["th"]+7),tile["label"],font=fl,fill=(240,240,240))
  if tile.get("sub"): d.text((x+s["tw"]-2,y+s["th"]+10),tile["sub"],font=fs,fill=(140,144,152),anchor="ra")
im.save(s["out"])
`, js]);
}
const W = 960, H = 540, base = scene(W, H, "MS PHASE");

// 1) hero: the Phase look, large
{
  const w = 1800, h = 760, src = scene(w, h, "MS PHASE");
  const p = Object.assign(Core.presetParams("phase"), { lines: 210, bloom: 65, curvature: 18, corners: 22, vignette: 45 });
  fs.writeFileSync(path.join(OUT, "hero.png"), encodePNG(w, h, tv(src, w, h, p), 3));
}
// 2) all looks
sheet("looks.png", Core.PRESETS.length + " looks", Core.PRESETS.map((pr) => ({ img: save("look-" + pr.id, tv(base, W, H, Core.presetParams(pr.id)), W, H), label: pr.name })), 3, 560, 315);
// 3) signal modes
sheet("signal.png", "Signal: Clear, Straight, Wave, Swirl", Core.MODES.map((m) => ({
  img: save("mode-" + m.id, tv(base, W, H, Object.assign({}, Core.DEFAULTS, { mode: m.id, wave: m.id === "swirl" ? 60 : 45 })), W, H), label: m.name, sub: m.hint,
})), 2, 640, 360);
// 3b) more effects
sheet("effects.png", "Gradient, filmed screen, interference, overlays", [
  { label: "Colour gradient", sub: "Synthwave", p: Core.presetParams("synth") },
  { label: "Filmed screen", sub: "tilt + moiré + reflex", p: Object.assign(Core.presetParams("filmed"), { moire: 75 }) },
  { label: "Interlace", sub: "every second line shifted", p: Object.assign({}, Core.DEFAULTS, { mode: "clear", colorMode: "original", interlace: 90, lines: 120, bloom: 30 }) },
  { label: "Wobble", sub: "bad reception", p: Object.assign({}, Core.DEFAULTS, { mode: "clear", colorMode: "original", wobble: 80, rgbShift: 40, bloom: 30 }) },
  { label: "Burn-in", sub: "fixed ghost image", p: Object.assign(Core.presetParams("terminal"), { burnIn: 90 }) },
  { label: "Overlays", sub: "Camcorder (● REC)", p: Core.presetParams("camcorder") },
].map((t, n) => ({ img: save("fx-" + n, tv(base, W, H, t.p), W, H), label: t.label, sub: t.sub })), 3, 560, 315);
// 4) phosphor masks up close (1:1 crop of a large scene)
{
  const bw = 2400, bh = 1350, big = scene(bw, bh, "MS PHASE");
  const cw = 360, ch = 220, ox = 1500, oy = 1000;
  const crop = (rgba) => { const o = new Uint8Array(cw * ch * 4); for (let y = 0; y < ch; y++) o.set(rgba.subarray(((oy + y) * bw + ox) * 4, ((oy + y) * bw + ox + cw) * 4), y * cw * 4); return o; };
  const part = crop(big);
  const tiles = Core.MASKS.filter((m) => m.id !== "none").map((m) => {
    const p = Object.assign({}, Core.DEFAULTS, { mode: "clear", colorMode: "original", mask: m.id, maskStrength: 85, maskSize: 160, scanlines: 25, bloom: 30, lines: 220, vignette: 0, noise: 0, rgbShift: 10 });
    return { img: save("mask-" + m.id, tv(part, cw, ch, p, { fullW: bw, fullH: bh, originX: ox, originY: oy, pxScale: 1, w: cw, h: ch }), cw, ch), label: m.name, sub: "1:1 detail" };
  });
  sheet("masks.png", "Phosphor masks", tiles, 2, 540, 330);
}
// 5) before / after
{
  const orig = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) { orig[i * 3] = base[i * 4]; orig[i * 3 + 1] = base[i * 4 + 1]; orig[i * 3 + 2] = base[i * 4 + 2]; }
  sheet("before-after.png", "", [
    { img: save("orig", orig, W, H), label: "Before" },
    { img: save("after-arcade", tv(base, W, H, Core.presetParams("arcade")), W, H), label: "Arcade" },
    { img: save("after-phase", tv(base, W, H, Core.presetParams("phase")), W, H), label: "Phase" },
  ], 3, 560, 315);
}
console.log("images written:", fs.readdirSync(OUT).join(", "));
