"""Split each element card PNG (front | back side by side) into two transparent WebPs of one fixed size."""
import sys, json, os
from PIL import Image, ImageFilter
import numpy as np
src, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3:])
W, H = 620, 900
os.makedirs(out, exist_ok=True)
man = json.load(open(os.path.join(src, '..', 'manifest.json')))['elements']
total = 0
for e in man:
    if only and e['symbol'] not in only: continue
    img = Image.open(os.path.join(src, e['png'])).convert('RGB')
    im = np.asarray(img).astype(int)
    h, w, _ = im.shape
    bg = np.median(np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]), axis=0)
    dist = np.abs(im - bg).sum(2)
    diff = dist > 60
    cols = diff.mean(0) > 0.05
    rows = np.where(diff.mean(1) > 0.05)[0]
    runs, start = [], None
    for x, v in enumerate(cols):
        if v and start is None: start = x
        if not v and start is not None: runs.append((start, x)); start = None
    if start is not None: runs.append((start, w))
    runs = [r for r in runs if r[1] - r[0] > 200]
    assert len(runs) == 2, (e['png'], runs)
    # background = pixels near bg colour connected to the border
    near = dist < 75
    seed = np.zeros_like(near); seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    seed &= near
    while True:
        g = seed.copy()
        g[1:] |= seed[:-1]; g[:-1] |= seed[1:]; g[:, 1:] |= seed[:, :-1]; g[:, :-1] |= seed[:, 1:]
        g &= near
        if (g == seed).all(): break
        seed = g
    alpha = Image.fromarray(np.where(seed, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2))
    rgba = img.copy(); rgba.putalpha(alpha)
    m = 6
    for side, (x0, x1) in zip(('front', 'back'), runs):
        box = (max(0, x0 - m), max(0, rows[0] - m), min(w, x1 + m), min(h, rows[-1] + m))
        part = rgba.crop(box)
        s = min(W / part.width, H / part.height)
        part = part.resize((round(part.width * s), round(part.height * s)), Image.LANCZOS)
        canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        canvas.paste(part, ((W - part.width) // 2, (H - part.height) // 2))
        p = os.path.join(out, f"{e['symbol']}-{side}.webp")
        canvas.save(p, 'WEBP', quality=80, method=6, alpha_quality=80)
        total += os.path.getsize(p)
        if side == 'front':
            p = os.path.join(out, f"{e['symbol']}-front-sm.webp")
            canvas.resize((W // 2, H // 2), Image.LANCZOS).save(p, 'WEBP', quality=78, method=6, alpha_quality=80)
            total += os.path.getsize(p)
print('bytes', total)
