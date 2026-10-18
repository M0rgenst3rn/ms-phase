"""Creates a test scene (sphere, sunset, grid floor, lettering) as PNG and raw RGBA file.
Usage: python3 tools/make-scene.py <out.png> <width> <height> [text]"""
import sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
text = sys.argv[4] if len(sys.argv) > 4 else "MS PHASE"
img = Image.new("RGB", (W, H))
px = img.load()
hor = int(H * 0.62)
for y in range(H):
    for x in range(W):
        if y < hor:
            t = y / hor
            r = int(18 + 200 * t ** 1.6); g = int(14 + 60 * t ** 2); b = int(60 + 60 * (1 - t))
        else:
            t = (y - hor) / (H - hor)
            r = int(30 * (1 - t)); g = int(8 + 10 * (1 - t)); b = int(40 + 30 * (1 - t))
        px[x, y] = (r, g, b)
d = ImageDraw.Draw(img)
# sun with stripes
cx, cy, R = int(W * 0.5), int(hor - H * 0.02), int(H * 0.26)
for y in range(cy - R, cy + 1):
    if y < 0: continue
    band = (y - (cy - R)) / R
    if band > 0.45 and int((band - 0.45) * 22) % 2 == 1: continue
    half = int(math.sqrt(max(0, R * R - (y - cy) ** 2)))
    for x in range(cx - half, cx + half):
        if 0 <= x < W:
            t = (y - (cy - R)) / R
            px[x, y] = (255, int(220 - 150 * t), int(90 - 60 * t))
# grid floor
for i in range(-14, 15):
    x0 = cx + i * W * 0.012; x1 = cx + i * W * 0.12
    d.line([(x0, hor), (x1, H)], fill=(255, 60, 200), width=max(1, W // 400))
y = hor; step = H * 0.012
while y < H:
    d.line([(0, y), (W, y)], fill=(255, 60, 200), width=max(1, W // 400)); step *= 1.35; y += step
# lit sphere on the left
sx, sy, sr = int(W * 0.18), int(H * 0.42), int(H * 0.2)
for y in range(sy - sr, sy + sr):
    for x in range(sx - sr, sx + sr):
        dx, dy = (x - sx) / sr, (y - sy) / sr
        q = dx * dx + dy * dy
        if q < 1:
            z = math.sqrt(1 - q); l = max(0, -0.5 * dx - 0.6 * dy + 0.62 * z)
            spec = max(0, l) ** 30
            px[x, y] = (int(40 + 150 * l + 120 * spec), int(120 + 120 * l + 100 * spec), int(160 + 95 * l))
# lettering
f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf", int(H * 0.2))
tw = d.textlength(text, font=f)
layer = Image.new("RGBA", (W, H)); ld = ImageDraw.Draw(layer)
ld.text((min((W - tw) / 2 + W * 0.17, W * 0.97 - tw), H * 0.68), text, font=f, fill=(245, 245, 255, 255))
layer = layer.transform(layer.size, Image.AFFINE, (1, 0.22, -H * 0.15, 0, 1, 0), resample=Image.BICUBIC)
img.paste(layer, (0, 0), layer)
img.save(out)
with open(out + ".raw", "wb") as fh:
    fh.write(img.convert("RGBA").tobytes())
print(out, W, H)
