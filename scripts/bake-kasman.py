"""Bakes a recolored Kasman sprite per board skin from src/assets/kasman.png.

Run after changing the base sprite or the table below:  python scripts/bake-kasman.py
Only the green body (hue ~155) is shifted; black outlines and whites stay put.
"""
import colorsys
from pathlib import Path
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / "src" / "assets"
BASE_HUE = 155
# skin id: (target hue in degrees, saturation multiplier, value multiplier)
SKINS = {
    "gold-rush": (44, 1.35, 1.3),
    "vaporwave": (305, 1.0, 1.05),
    "space": (200, 1.0, 1.05),
    "matrix": (128, 1.2, 1.0),
    "ocean": (18, 1.1, 1.08),
    "inferno": (358, 1.25, 0.95),
}

base = Image.open(ASSETS / "kasman.png").convert("RGBA")
for skin, (hue, sat_k, val_k) in SKINS.items():
    out = base.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if a == 0 or s < 0.15 or not 90 <= h * 360 <= 200:
                continue
            h = ((hue + h * 360 - BASE_HUE) % 360) / 360
            r, g, b = colorsys.hsv_to_rgb(h, min(1, s * sat_k), min(1, v * val_k))
            px[x, y] = (round(r * 255), round(g * 255), round(b * 255), a)
    out.save(ASSETS / f"kasman-{skin}.png", optimize=True)
    print("baked", skin)
