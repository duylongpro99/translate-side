# Generates the toolbar icons in public/icon/ and the store icon in docs/store/assets/
# from the official logo, docs/brand/kwaii_translate.svg (a PNG embedded in an SVG).
# Run: python3 scripts/make-icons.py   (needs Pillow)
import base64
import io
import re
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
svg = (root / 'docs/brand/kwaii_translate.svg').read_text()
data = re.search(r'base64,([A-Za-z0-9+/=\s]+)"', svg).group(1)
logo = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')

# Trim the transparent border, then centre the artwork on a transparent square.
logo = logo.crop(logo.getbbox())
side = max(logo.size)
square = Image.new('RGBA', (side, side))
square.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2))


def fit(size, margin=0):
    canvas = Image.new('RGBA', (size, size))
    art = square.resize((size - 2 * margin,) * 2, Image.LANCZOS)
    canvas.paste(art, (margin, margin))
    return canvas


for s in (16, 32, 48, 128):
    fit(s).save(root / f'public/icon/{s}.png', optimize=True)

# The store asks for the artwork at 96 px inside a 16 px transparent margin.
fit(128, 16).save(root / 'docs/store/assets/store-icon-128.png', optimize=True)
