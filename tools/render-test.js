// Renders a raw RGBA file with Vhold and writes the composited result as PNG.
// node tools/render-test.js <in.raw> <w> <h> <out.png> [json-params | preset-id]
const fs = require("fs"), path = require("path");
const Core = require(path.join(__dirname, "..", "phase", "core.js"));
const { encodePNG } = require("./png.js");
const [inp, w0, h0, out, arg] = process.argv.slice(2);
const w = +w0, h = +h0, rgba = new Uint8Array(fs.readFileSync(inp));
let params = Core.DEFAULTS;
if (arg) params = arg.trim().startsWith("{") ? Object.assign({}, Core.DEFAULTS, JSON.parse(arg)) : Core.presetParams(arg);
const t0 = Date.now();
const res = Core.render({ rgba, w, h, params, opaque: true });
const ms = Date.now() - t0;
const orig = new Uint8Array(w * h * 3);
for (let i = 0; i < w * h; i++) { orig[i * 3] = rgba[i * 4]; orig[i * 3 + 1] = rgba[i * 4 + 1]; orig[i * 3 + 2] = rgba[i * 4 + 2]; }
fs.writeFileSync(out, encodePNG(w, h, Core.composite(res, w, h, null, orig), 3));
console.log(out, ms + "ms");
