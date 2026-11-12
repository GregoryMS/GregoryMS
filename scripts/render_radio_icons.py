"""Export the Radio SVG's geometry as opaque, supersampled app icons (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'radio-app'
SCALE = 4
BG, WHITE, PURPLE = '#232323', '#faf9f6', '#9850ff'
image = Image.new('RGB', (512 * SCALE, 512 * SCALE), BG)
draw = ImageDraw.Draw(image)

def box(bounds):
    return tuple(round(value * SCALE) for value in bounds)

def stroke(points, width, fill=WHITE):
    points = [(round(x * SCALE), round(y * SCALE)) for x, y in points]
    draw.line(points, fill=fill, width=width * SCALE)
    radius = width * SCALE / 2
    for x, y in points:
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=fill)

# Match icon.svg, including SVG strokes centred on their shapes.
stroke([(133, 197), (349, 115)], 22)
draw.rounded_rectangle(box((78, 178, 434, 432)), radius=54*SCALE, fill=WHITE)
draw.rounded_rectangle(box((102, 202, 410, 408)), radius=30*SCALE, fill=BG)
stroke([(133, 243), (379, 243)], 14, PURPLE)
for y in (292, 328, 364):
    stroke([(139, y), (265, y)], 15)
draw.ellipse(box((286, 280, 400, 394)), fill=WHITE)
draw.ellipse(box((306, 300, 380, 374)), fill=BG)
stroke([(343, 337), (360, 314)], 12, PURPLE)
draw.ellipse(box((332, 256, 354, 278)), fill=PURPLE)

for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192),
                   ('icon-512.png', 512), ('favicon-32.png', 32)]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)
image.resize((256, 256), Image.Resampling.LANCZOS).save(
    OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
