"""Renders the livery templates (for Canva) and the default liveries.

  node scripts/livery-uv.mjs livery-uv.json
  python scripts/livery_templates.py livery-uv.json <fonts-dir>

Outputs
  livery-templates/<car>-template.png  shaded views + labels, design on top of it
  livery-templates/<car>-guide.png     transparent outlines to overlay while designing
  public/liveries/<car>.png            default livery the game loads
"""
import json
import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
uv_path = sys.argv[1]
fonts = sys.argv[2]
data = json.load(open(uv_path, encoding='utf-8'))
SIZE = data['size']
REGIONS = data['regions']
IDS = data['regionIds']

BEBAS = os.path.join(fonts, 'BebasNeue-Regular.ttf')
CHAKRA = os.path.join(fonts, 'ChakraPetch-Bold.ttf')
UNB = os.path.join(fonts, 'Unbounded[wght].ttf')


def font(path, size, black=False):
    f = ImageFont.truetype(path, size)
    if black:
        try:
            f.set_variation_by_name('Black')
        except Exception:
            pass
    return f


def project(frame, region, x, y, z):
    ox, oy = frame['o'][region]
    S = frame['S']
    if region == 'top':
        return ox + (x - frame['x0']) * S, oy + (z - frame['z0']) * S
    if region == 'right':
        return ox + (x - frame['x0']) * S, oy + (frame['y1'] - y) * S
    if region == 'left':
        return ox + (frame['x1'] - x) * S, oy + (frame['y1'] - y) * S
    if region == 'front':
        return ox + (frame['z1'] - z) * S, oy + (frame['y1'] - y) * S
    if region == 'rear':
        return ox + (z - frame['z0']) * S, oy + (frame['y1'] - y) * S
    Su = frame['Su']
    return ox + (x - frame['x0']) * Su, oy + (frame['z1'] - z) * Su


def masks_and_shading(car):
    """Per-region silhouette masks and a shaded render of the body."""
    shade = Image.new('L', (SIZE, SIZE), 0)
    mask = Image.new('L', (SIZE, SIZE), 0)
    ds, dm = ImageDraw.Draw(shade), ImageDraw.Draw(mask)
    for t in car['tris']:
        pts = [(t[1], t[2]), (t[3], t[4]), (t[5], t[6])]
        v = int(70 + 170 * t[7])
        ds.polygon(pts, fill=v)
        dm.polygon(pts, fill=255)
    return mask, shade


def outlines(mask, shade):
    edge = mask.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
    creases = shade.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 26 else 0)
    creases = ImageChops.multiply(creases, mask.filter(ImageFilter.MinFilter(5)))
    return edge.filter(ImageFilter.MaxFilter(3)), creases


def paste_logo(img, box, rotate=0, opacity=1.0, tint=None):
    logo = Image.open(os.path.join(ROOT, 'public', 'brand', 'logo-white.webp')).convert('RGBA')
    if rotate:
        logo = logo.rotate(rotate, expand=True)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    s = min(w / logo.width, h / logo.height)
    logo = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))), Image.LANCZOS)
    if tint:
        solid = Image.new('RGBA', logo.size, tint)
        solid.putalpha(logo.getchannel('A'))
        logo = solid
    if opacity < 1:
        a = logo.getchannel('A').point(lambda v: int(v * opacity))
        logo.putalpha(a)
    img.alpha_composite(logo, (int(x0 + (w - logo.width) / 2), int(y0 + (h - logo.height) / 2)))


def text(img, xy, s, f, fill, anchor='mm', rotate=0):
    if not rotate:
        ImageDraw.Draw(img).text(xy, s, font=f, fill=fill, anchor=anchor)
        return
    tmp = Image.new('RGBA', (SIZE, 600), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((SIZE // 2, 300), s, font=f, fill=fill, anchor='mm')
    tmp = tmp.crop(tmp.getbbox()).rotate(rotate, expand=True)
    img.alpha_composite(tmp, (int(xy[0] - tmp.width / 2), int(xy[1] - tmp.height / 2)))


def gradient(w, h, c0, c1, vertical=True):
    g = Image.new('RGBA', (w, h))
    px = g.load()
    for i in range(h if vertical else w):
        t = i / max(1, (h if vertical else w) - 1)
        c = tuple(int(c0[k] + (c1[k] - c0[k]) * t) for k in range(3)) + (255,)
        if vertical:
            for x in range(w):
                px[x, i] = c
        else:
            for y in range(h):
                px[i, y] = c
    return g


def hex_overlay(w, h, size, color, alpha):
    o = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(o)
    dx = size * math.sqrt(3)
    for row in range(int(h / (size * 1.5)) + 2):
        for col in range(int(w / dx) + 2):
            cx = col * dx + (row % 2) * dx / 2
            cy = row * size * 1.5
            pts = [(cx + size * math.cos(math.radians(60 * k + 30)), cy + size * math.sin(math.radians(60 * k + 30))) for k in range(6)]
            d.polygon(pts, outline=color + (alpha,), width=2)
    return o


def roundel(diam, number, ring, ink=(11, 12, 18)):
    r = Image.new('RGBA', (diam, diam), (0, 0, 0, 0))
    d = ImageDraw.Draw(r)
    d.ellipse((0, 0, diam - 1, diam - 1), fill=ink + (255,))
    m = int(diam * 0.05)
    d.ellipse((m, m, diam - m, diam - m), fill=(244, 241, 234, 255))
    m2 = int(diam * 0.13)
    d.ellipse((m2, m2, diam - m2, diam - m2), outline=ring + (255,), width=max(4, int(diam * 0.045)))
    d.text((diam / 2, diam / 2 + diam * 0.02), number, font=font(UNB, int(diam * 0.42), True), fill=ink + (255,), anchor='mm')
    return r


# ---------------------------------------------------------------------------
# Default liveries
# ---------------------------------------------------------------------------
NAVY = (8, 22, 110)
BLUE = (31, 61, 230)
RED = (196, 18, 34)
BERRY = (92, 6, 18)
LIME = (141, 198, 63)
CREAM = (244, 241, 234)
INK = (11, 12, 18)


def livery_classic(car):
    fr = car['frame']
    img = Image.new('RGBA', (SIZE, SIZE), NAVY + (255,))
    for key, r in REGIONS.items():
        g = gradient(r['w'], r['h'], (14, 32, 140), (6, 14, 70))
        img.alpha_composite(g, (r['x'], r['y']))
    img.alpha_composite(hex_overlay(SIZE, SIZE, 34, (90, 120, 255), 26))
    d = ImageDraw.Draw(img)

    # Top: twin cream racing stripes nose-to-tail with lime pinstripes
    for zc in (-0.17, 0.17):
        a = project(fr, 'top', fr['x0'], 0, zc - 0.11)
        b = project(fr, 'top', fr['x1'], 0, zc + 0.11)
        d.rectangle((a[0], a[1], b[0], b[1]), fill=CREAM + (255,))
        for zz in (zc - 0.14, zc + 0.14):
            p = project(fr, 'top', fr['x0'], 0, zz)
            q = project(fr, 'top', fr['x1'], 0, zz + 0.012)
            d.rectangle((p[0], p[1], q[0], q[1]), fill=LIME + (255,))
    # hood logo, reads from the driver's seat (top points to the front)
    c = project(fr, 'top', 0.95, 0, 0)
    paste_logo(img, (c[0] - 150, c[1] - 150, c[0] + 150, c[1] + 150), rotate=-90, tint=NAVY + (255,))

    # Sides: lime beltline pinstripe, roundel 07, wordmark, flavour line
    for side in ('right', 'left'):
        p = project(fr, side, fr['x0'], 0.3, 0)
        q = project(fr, side, fr['x1'], 0.27, 0)
        d.rectangle((min(p[0], q[0]), p[1], max(p[0], q[0]), q[1]), fill=LIME + (255,))
        p = project(fr, side, fr['x0'], -0.29, 0)
        q = project(fr, side, fr['x1'], -0.44, 0)
        d.rectangle((min(p[0], q[0]), p[1], max(p[0], q[0]), q[1]), fill=CREAM + (255,))
        door = project(fr, side, -0.36, 0.0, 0)
        rd = roundel(170, '07', BLUE)
        img.alpha_composite(rd, (int(door[0] - 85), int(door[1] - 85)))
        hood = project(fr, side, 0.75, 0.0, 0)
        paste_logo(img, (hood[0] - 120, hood[1] - 70, hood[0] + 120, hood[1] + 70), rotate=0)
        tail = project(fr, side, -1.25, -0.05, 0)
        text(img, tail, 'CLASSIC · TROPICAL', font(BEBAS, 46), CREAM + (255,))

    # Front / rear
    c = project(fr, 'front', 0, 0.05, 0)
    paste_logo(img, (c[0] - 120, c[1] - 80, c[0] + 120, c[1] + 80))
    c = project(fr, 'rear', 0, 0.12, 0)
    text(img, c, 'HAWK RACING', font(UNB, 56, True), CREAM + (255,))
    c = project(fr, 'rear', 0, -0.12, 0)
    text(img, c, 'NIGHT HAWK ENERGY · 50 MG', font(BEBAS, 44), LIME + (255,))
    return img


def livery_ultra(car):
    fr = car['frame']
    img = Image.new('RGBA', (SIZE, SIZE), RED + (255,))
    for key, r in REGIONS.items():
        g = gradient(r['w'], r['h'], (214, 28, 42), (110, 8, 20))
        img.alpha_composite(g, (r['x'], r['y']))
    img.alpha_composite(hex_overlay(SIZE, SIZE, 34, (255, 140, 120), 24))
    d = ImageDraw.Draw(img)

    # Top: lime centre slash + black hood panel
    a = project(fr, 'top', 0.3, 0, -0.5)
    b = project(fr, 'top', fr['x1'], 0, 0.5)
    d.rectangle((a[0], a[1], b[0], b[1]), fill=INK + (255,))
    for k in range(5):
        x = 0.4 + k * 0.2
        p1 = project(fr, 'top', x, 0, -0.45)
        p2 = project(fr, 'top', x + 0.08, 0, -0.45)
        p3 = project(fr, 'top', x + 0.2, 0, 0.45)
        p4 = project(fr, 'top', x + 0.12, 0, 0.45)
        d.polygon([p1, p2, p3, p4], fill=LIME + (255,))
    c = project(fr, 'top', -0.95, 0, 0)
    paste_logo(img, (c[0] - 110, c[1] - 110, c[0] + 110, c[1] + 110), rotate=-90)

    # Sides: black rocker, lime slashes, number 75, logo
    for side in ('right', 'left'):
        p = project(fr, side, fr['x0'], -0.12, 0)
        q = project(fr, side, fr['x1'], -0.4, 0)
        d.rectangle((min(p[0], q[0]), p[1], max(p[0], q[0]), q[1]), fill=INK + (255,))
        for k in range(3):
            x = 0.55 + k * 0.17
            pts = [project(fr, side, x, -0.12, 0), project(fr, side, x + 0.09, -0.12, 0),
                   project(fr, side, x + 0.33, 0.45, 0), project(fr, side, x + 0.24, 0.45, 0)]
            d.polygon(pts, fill=LIME + (255,))
        num = project(fr, side, -0.15, 0.1, 0)
        img.alpha_composite(roundel(170, '75', RED), (int(num[0] - 85), int(num[1] - 85)))
        lg = project(fr, side, -0.85, 0.15, 0)
        paste_logo(img, (lg[0] - 110, lg[1] - 65, lg[0] + 110, lg[1] + 65))
        tag = project(fr, side, -0.2, -0.27, 0)
        text(img, tag, 'ULTRA · BERRY BURST · 75 MG', font(BEBAS, 40), LIME + (255,))

    c = project(fr, 'front', 0, 0.12, 0)
    paste_logo(img, (c[0] - 110, c[1] - 70, c[0] + 110, c[1] + 70))
    c = project(fr, 'rear', 0, 0.3, 0)
    text(img, c, 'HAWK RACING', font(UNB, 52, True), CREAM + (255,))
    c = project(fr, 'rear', 0, 0.05, 0)
    text(img, c, 'ULTRA', font(BEBAS, 70), LIME + (255,))
    return img


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
def template(car, key, mask, shade, edge, crease):
    img = Image.new('RGBA', (SIZE, SIZE), (232, 234, 240, 255))
    d = ImageDraw.Draw(img)
    for name, r in REGIONS.items():
        d.rectangle((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']), fill=(250, 250, 252, 255), outline=(180, 186, 200, 255), width=3)
    body = Image.merge('RGBA', (shade, shade, shade, mask))
    img.alpha_composite(body)
    lime = Image.new('RGBA', (SIZE, SIZE), LIME + (255,))
    img.paste(lime, (0, 0), edge)
    dark = Image.new('RGBA', (SIZE, SIZE), (40, 48, 80, 255))
    img.paste(dark, (0, 0), crease.point(lambda v: int(v * 0.55)))
    f = font(CHAKRA, 30)
    for name, r in REGIONS.items():
        d.text((r['x'] + 16, r['y'] + 12), r['label'], font=f, fill=(30, 40, 90, 255))
    # notes strip
    y = 1735
    d.text((40, y), f"HAWK RACING · {car['name'].upper()} LIVERY TEMPLATE · 2048 x 2048 px", font=font(UNB, 34, True), fill=(10, 20, 80, 255))
    notes = [
        'Paint the whole rectangle around each view: colours bleed a little at the curved edges, so extend backgrounds past the outline.',
        'Keep important logos/text inside the lime outline, away from the edges. The cockpit floor is not shown.',
        f'Export as PNG 2048 x 2048 and save it as public/liveries/{key}.png (replace the file), then reload the game.',
    ]
    for i, n in enumerate(notes):
        d.text((40, y + 60 + i * 44), n, font=font(CHAKRA, 26), fill=(40, 48, 80, 255))
    return img


def guide(edge, crease):
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    img.paste(Image.new('RGBA', (SIZE, SIZE), LIME + (255,)), (0, 0), edge)
    img.paste(Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 200)), (0, 0), crease.point(lambda v: int(v * 0.7)))
    f = font(CHAKRA, 30)
    for name, r in REGIONS.items():
        d.rectangle((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']), outline=(255, 255, 255, 160), width=2)
        d.text((r['x'] + 16, r['y'] + 12), r['label'], font=f, fill=(255, 255, 255, 230))
    return img


os.makedirs(os.path.join(ROOT, 'livery-templates'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'public', 'liveries'), exist_ok=True)
for key, car in data['cars'].items():
    mask, shade = masks_and_shading(car)
    edge, crease = outlines(mask, shade)
    template(car, key, mask, shade, edge, crease).save(os.path.join(ROOT, 'livery-templates', f'{key}-template.png'))
    guide(edge, crease).save(os.path.join(ROOT, 'livery-templates', f'{key}-guide.png'))
    liv = livery_classic(car) if key == 'classic' else livery_ultra(car)
    liv.convert('RGB').save(os.path.join(ROOT, 'public', 'liveries', f'{key}.png'), optimize=True)
    # preview: livery with the guide on top
    prev = liv.copy()
    prev.alpha_composite(guide(edge, crease))
    prev.convert('RGB').resize((1024, 1024)).save(os.path.join(ROOT, 'livery-templates', f'{key}-preview.jpg'), quality=85)
    print('wrote', key)
