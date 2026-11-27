"""Split each card PNG (front | info side, side by side) into transparent WebPs of one fixed size (620 x 900).

    python build_card_webp.py elements Element_Cards_Complete/Cards ../../mmaxr-webxr-client/public/cards/elements
    python build_card_webp.py physics Physics_Cards_Collectible_Edition/Cards ../../mmaxr-webxr-client/public/cards/physics

Writes {name}-front.webp, {name}-front-sm.webp (half size, for grids) and {name}-back.webp, where name is the
element symbol (H, He, ...) or the physics quantity key (length, force, ...). Needs Pillow and numpy.
"""
import sys, json, os, glob
from PIL import Image, ImageFilter
import numpy as np
kind, src, out = sys.argv[1], sys.argv[2], sys.argv[3]
only = set(sys.argv[4:])
W, H = 620, 900
os.makedirs(out, exist_ok=True)
if kind == 'elements':
    entries = [(e['symbol'], e['png']) for e in json.load(open(os.path.join(src, '..', 'manifest.json')))['elements']]
elif kind == 'physics':
    cards = json.load(open(os.path.join(src, '..', 'physics_catalog.json')))['cards']
    entries = []
    for c in cards:
        files = glob.glob(os.path.join(src, f"*_{c['key']}_Card.png"))
        assert len(files) == 1, (c['key'], files)
        entries.append((c['key'], os.path.basename(files[0])))
else:
    sys.exit(f'unknown set {kind}')
total = 0
for name, png in entries:
    if only and name not in only: continue
    img = Image.open(os.path.join(src, png)).convert('RGB')
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
    assert len(runs) == 2, (png, runs)
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
        p = os.path.join(out, f"{name}-{side}.webp")
        canvas.save(p, 'WEBP', quality=80, method=6, alpha_quality=80)
        total += os.path.getsize(p)
        if side == 'front':
            p = os.path.join(out, f"{name}-front-sm.webp")
            canvas.resize((W // 2, H // 2), Image.LANCZOS).save(p, 'WEBP', quality=78, method=6, alpha_quality=80)
            total += os.path.getsize(p)
print('bytes', total)
