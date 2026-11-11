"""Build the web app's icon, logo and banner files from the Gemini images.

Usage (from the repo root, needs Pillow and NumPy):

    python docs/branding/build-assets.py [source-folder]

The source folder (default docs/branding/v2) holds icon-*.jpg, logo-*.jpg and
background-*.jpeg. Gemini draws them on plain white without transparency, so
this script cuts them out, crops them and writes small files:

    web/public/favicon.ico              16-64 px, the browser tab
    web/public/icon-192.png, icon-512.png   transparent rounded tile (top bar, manifest)
    web/public/icon-maskable-512.png    full-bleed tile for Android home screens
    web/public/apple-touch-icon.png     180 px, iOS home screen
    web/public/logo.png                 transparent logo mark (About, empty states)
    docs/branding/banner.jpg            README header
    docs/branding/social-preview.jpg    GitHub social preview (1280x640)
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs' / 'branding' / 'v2'
PUBLIC = ROOT / 'web' / 'public'
DOCS = ROOT / 'docs' / 'branding'


def find(pattern):
    hits = sorted(SRC.glob(pattern))
    if not hits:
        sys.exit(f'No {pattern} in {SRC}')
    return hits[0]


def min_channel(img):
    return np.asarray(img.convert('RGB'), dtype=np.int16).min(axis=2)


def bbox(mask):
    rows, cols = np.where(mask)
    return cols.min(), rows.min(), cols.max() + 1, rows.max() + 1


def square(img):
    """Pad to a centred transparent square."""
    w, h = img.size
    side = max(w, h)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - w) // 2, (side - h) // 2))
    return out


def save_png(img, path):
    """256-colour palette PNG: a fraction of the size, no visible difference here."""
    img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)


def rounded_mask(size, box, radius, scale=4):
    """Anti-aliased rounded rectangle, drawn large and scaled down."""
    big = Image.new('L', (size[0] * scale, size[1] * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle([v * scale for v in box], radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


# ---- Icon: the rounded orange tile with the white symbol ----------------------

icon_src = Image.open(find('icon-*.jpg')).convert('RGB')
mc = min_channel(icon_src)
left, top, right, bottom = bbox(mc < 200)  # the tile (white background is ~250)
# The tile's corner radius: where its top edge starts to be straight.
row = mc[top + 2, left:right]
radius = int(np.argmax(row < 200)) + 2
inset = 8  # trims the JPEG fringe against the white background
alpha = rounded_mask(icon_src.size, (left + inset, top + inset, right - inset, bottom - inset), radius)
icon = icon_src.convert('RGBA')
icon.putalpha(alpha)
icon = square(icon.crop((left, top, right, bottom)))

for px in (192, 512):
    save_png(icon.resize((px, px), Image.LANCZOS), PUBLIC / f'icon-{px}.png')
icon.resize((256, 256), Image.LANCZOS).save(
    PUBLIC / 'favicon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)])

# Full-bleed versions (the OS draws its own shape): the white symbol on a flat
# canvas of the tile's colour.
tile = np.asarray(icon_src, dtype=np.int16)[top:bottom, left:right]
tile_mc = tile.min(axis=2)
# Only inside the tile: the white background outside its corners is not symbol.
inside = np.asarray(alpha.filter(ImageFilter.MinFilter(41)))[top:bottom, left:right] == 255
tile_mc = np.where(inside, tile_mc, 0)
symbol_mask = tile_mc > 150
tile_colour = tuple(int(v) for v in np.median(tile[inside & (tile_mc < 40)], axis=0))
symbol_colour = tuple(int(v) for v in np.median(tile[tile_mc > 225], axis=0))
s_left, s_top, s_right, s_bottom = bbox(symbol_mask)
# Soft alpha from the minimum channel: orange ~0, white ~240.
sym_alpha = np.clip((tile_mc[s_top:s_bottom, s_left:s_right] - 30) / (220 - 30), 0, 1)
symbol = Image.new('RGBA', (s_right - s_left, s_bottom - s_top), symbol_colour + (255,))
symbol.putalpha(Image.fromarray((sym_alpha * 255).astype(np.uint8)))
symbol = square(symbol)


def full_bleed(px, symbol_share):
    out = Image.new('RGBA', (px, px), tile_colour + (255,))
    side = round(px * symbol_share)
    sym = symbol.resize((side, side), Image.LANCZOS)
    out.alpha_composite(sym, ((px - side) // 2, (px - side) // 2))
    return out.convert('RGB')


# Maskable: the symbol must stay inside the central 80% circle.
full_bleed(512, 0.54).save(PUBLIC / 'icon-maskable-512.png', optimize=True)
full_bleed(180, 0.62).save(PUBLIC / 'apple-touch-icon.png', optimize=True)

# ---- Logo: the detailed mark, cut out of its white background -----------------

logo_src = Image.open(find('logo-*.jpg')).convert('RGB')
mc = min_channel(logo_src)
solid = Image.fromarray(((mc < 235) * 255).astype(np.uint8))
core = np.asarray(solid.filter(ImageFilter.MinFilter(5))) > 0  # 2 px inside the edges
rgb = np.asarray(logo_src, dtype=np.float32)
# In the edge band, separate the colour from the white it was blended with.
edge_alpha = (255 - mc) / 255
a = np.where(core, 1.0, np.where(mc < 235, edge_alpha, 0.0)).astype(np.float32)
safe = np.maximum(a, 1e-3)[..., None]
unmixed = np.where(core[..., None], rgb, np.clip((rgb - 255 * (1 - a[..., None])) / safe, 0, 255))
logo = Image.fromarray(np.dstack([unmixed, a * 255]).astype(np.uint8), 'RGBA')
logo = square(logo.crop(bbox(a > 0.02)))
save_png(logo.resize((512, 512), Image.LANCZOS), PUBLIC / 'logo.png')

# ---- Banners: the background with the icon in its empty centre -----------------

background = Image.open(find('background-*.jp*g')).convert('RGB')


def banner(size, icon_share):
    w, h = size
    scale = max(w / background.width, h / background.height)
    bg = background.resize((round(background.width * scale), round(background.height * scale)), Image.LANCZOS)
    x, y = (bg.width - w) // 2, (bg.height - h) // 2
    out = bg.crop((x, y, x + w, y + h)).convert('RGBA')
    side = round(h * icon_share)
    out.alpha_composite(icon.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
    return out.convert('RGB')


banner((1280, 640), 0.42).save(DOCS / 'social-preview.jpg', quality=85, optimize=True)
banner((1376, 400), 0.5).save(DOCS / 'banner.jpg', quality=85, optimize=True)

print('tile radius', radius, '| tile colour', tile_colour, '| symbol colour', symbol_colour)
for f in ['favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'logo.png']:
    print(f'web/public/{f}', (PUBLIC / f).stat().st_size // 1024, 'KB')
for f in ['banner.jpg', 'social-preview.jpg']:
    print(f'docs/branding/{f}', (DOCS / f).stat().st_size // 1024, 'KB')
