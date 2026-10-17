// Erzeugt die Plugin-Icons: ein kleiner Röhrenbildschirm mit Scanlines.
const fs = require("fs"), path = require("path");
const { encodePNG } = require("./png.js");
const dir = path.join(__dirname, "..", "phase", "icons");
fs.mkdirSync(dir, { recursive: true });
function icon(size, file) {
  const rgba = new Uint8Array(size * size * 4);
  const m = size * 0.1, r = size * 0.18, lines = 7;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    // abgerundetes Rechteck (Bildschirm), leicht gewölbte Seiten
    const qx = Math.max(0, Math.abs(cx - size / 2) - (size / 2 - m - r)), qy = Math.max(0, Math.abs(cy - size * 0.47) - (size * 0.36 - r));
    const d = Math.sqrt(qx * qx + qy * qy) - r;
    const frame = Math.max(0, Math.min(1, 0.5 - d)) - Math.max(0, Math.min(1, 0.5 - (d + size * 0.09)));
    const inner = Math.max(0, Math.min(1, 0.5 - (d + size * 0.09)));
    const t = (cy - (size * 0.47 - size * 0.36)) / (size * 0.72) * lines;
    const line = Math.abs(t - Math.floor(t) - 0.5) < 0.22 ? 1 : 0;
    // Standfuß
    const foot = cy > size * 0.86 && cy < size * 0.94 && Math.abs(cx - size / 2) < size * 0.2 ? 1 : 0;
    const a = Math.min(1, frame + inner * line * 0.85 + foot);
    const i = (y * size + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 220; rgba[i + 3] = a * 255;
  }
  fs.writeFileSync(path.join(dir, file), encodePNG(size, size, rgba, 4));
}
icon(23, "icon@1x.png"); icon(46, "icon@2x.png"); icon(48, "plugin@1x.png"); icon(96, "plugin@2x.png");
console.log("Icons geschrieben:", fs.readdirSync(dir).join(", "));
