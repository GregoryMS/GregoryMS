"""Render Calculator’s rectangle-based SVG master into its browser and app icons."""
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets' / 'calc-app'
SCALE = 4
canvas = Image.new('RGB', (512 * SCALE, 512 * SCALE), '#232323')
draw = ImageDraw.Draw(canvas)

def render(node, inherited=None):
    fill = node.get('fill', inherited)
    if node.tag.rsplit('}', 1)[-1] == 'rect':
        x, y = float(node.get('x', 0)), float(node.get('y', 0))
        w, h = float(node.get('width')), float(node.get('height'))
        box = (round(x*SCALE), round(y*SCALE), round((x+w)*SCALE)-1, round((y+h)*SCALE)-1)
        draw.rounded_rectangle(box, radius=round(float(node.get('rx', 0))*SCALE), fill=fill)
    for child in node:
        render(child, fill)

render(ET.parse(ASSETS / 'icon.svg').getroot())
for filename, size in [('apple-touch-icon.png',180), ('icon-192.png',192), ('icon-512.png',512), ('favicon-32.png',32)]:
    canvas.resize((size,size), Image.Resampling.LANCZOS).save(ASSETS / filename, optimize=True)
canvas.resize((256,256), Image.Resampling.LANCZOS).save(ASSETS / 'favicon.ico', sizes=[(16,16),(32,32),(48,48)])
