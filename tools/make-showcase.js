// Erzeugt die Bilder der README aus einer Testszene (tools/make-scene.py) mit der echten Engine.
// node tools/make-showcase.js   (braucht Python mit Pillow für Szene und Beschriftung)
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
// Kacheln mit Beschriftung über Python/Pillow zusammensetzen
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

// 1) Hero: Phase-Look groß
{
  const w = 1800, h = 760, src = scene(w, h, "MS PHASE");
  const p = Object.assign(Core.presetParams("phase"), { lines: 210, bloom: 65, curvature: 18, corners: 22, vignette: 45 });
  fs.writeFileSync(path.join(OUT, "hero.png"), encodePNG(w, h, tv(src, w, h, p), 3));
}
// 2) alle Looks
sheet("looks.png", "15 Looks", Core.PRESETS.map((pr) => ({ img: save("look-" + pr.id, tv(base, W, H, Core.presetParams(pr.id)), W, H), label: pr.name })), 3, 560, 315);
// 3) Signal-Modi
sheet("signal.png", "Signal: Klar, Gerade, Welle, Wirbel", Core.MODES.map((m) => ({
  img: save("mode-" + m.id, tv(base, W, H, Object.assign({}, Core.DEFAULTS, { mode: m.id, wave: m.id === "swirl" ? 60 : 45 })), W, H), label: m.name, sub: m.hint,
})), 2, 640, 360);
// 4) Phosphor-Masken im Detail (1:1-Ausschnitt einer großen Szene)
{
  const bw = 2400, bh = 1350, big = scene(bw, bh, "MS PHASE");
  const cw = 360, ch = 220, ox = 1500, oy = 1000;
  const crop = (rgba) => { const o = new Uint8Array(cw * ch * 4); for (let y = 0; y < ch; y++) o.set(rgba.subarray(((oy + y) * bw + ox) * 4, ((oy + y) * bw + ox + cw) * 4), y * cw * 4); return o; };
  const part = crop(big);
  const tiles = Core.MASKS.filter((m) => m.id !== "none").map((m) => {
    const p = Object.assign({}, Core.DEFAULTS, { mode: "clear", colorMode: "original", mask: m.id, maskStrength: 85, maskSize: 160, scanlines: 25, bloom: 30, lines: 220, vignette: 0, noise: 0, rgbShift: 10 });
    return { img: save("mask-" + m.id, tv(part, cw, ch, p, { fullW: bw, fullH: bh, originX: ox, originY: oy, pxScale: 1, w: cw, h: ch }), cw, ch), label: m.name, sub: "Detail 1:1" };
  });
  sheet("masks.png", "Phosphor-Masken", tiles, 2, 540, 330);
}
// 5) Vorher / Nachher
{
  const orig = new Uint8Array(W * H * 3); for (let i = 0; i < W * H; i++) { orig[i * 3] = base[i * 4]; orig[i * 3 + 1] = base[i * 4 + 1]; orig[i * 3 + 2] = base[i * 4 + 2]; }
  sheet("vorher-nachher.png", "", [
    { img: save("orig", orig, W, H), label: "Vorher" },
    { img: save("after-arcade", tv(base, W, H, Core.presetParams("arcade")), W, H), label: "Arcade" },
    { img: save("after-phase", tv(base, W, H, Core.presetParams("phase")), W, H), label: "Phase" },
  ], 3, 560, 315);
}
console.log("Bilder geschrieben:", fs.readdirSync(OUT).join(", "));
