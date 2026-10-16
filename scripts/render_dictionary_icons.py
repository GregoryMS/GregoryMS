"""Reproduce the Dictionary vector mark as opaque Gregle app and favicon assets."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'dictionary-app'
OUT.mkdir(parents=True, exist_ok=True)
S = 4
BG = '#232323'
WHITE = '#faf9f6'
VIOLET = '#9850ff'
image = Image.new('RGB', (512*S, 512*S), BG)
draw = ImageDraw.Draw(image)
def rect(box, radius, fill):
    draw.rounded_rectangle(tuple(round(v*S) for v in box), radius=radius*S, fill=fill)
def stroke(points, width, fill):
    points = [(round(x*S), round(y*S)) for x, y in points]
    draw.line(points, fill=fill, width=width*S, joint='curve')
    r = width*S/2
    for x, y in points:
        draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)
rect((118,90,394,422),38,VIOLET)
rect((144,364,382,407),12,WHITE)
rect((150,112,382,367),10,VIOLET)
stroke([(169,108),(169,350)],6,'#bc8bff')
stroke([(170,382),(366,382)],4,'#d7c8e7')
stroke([(170,391),(366,391)],4,'#d7c8e7')
stroke([(210,290),(259,169),(308,290)],14,WHITE)
stroke([(225,251),(293,251)],14,WHITE)
draw.polygon([(x*S,y*S) for x,y in [(324,90),(354,90),(354,164),(339,152),(324,164)]],fill=WHITE)
for name,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512),('favicon-32.png',32)]:
    image.resize((size,size), Image.Resampling.LANCZOS).save(OUT/name,optimize=True)
image.resize((256,256),Image.Resampling.LANCZOS).save(OUT/'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
