"""Render the Notes SVG geometry as matching opaque, supersampled app icons."""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'notes-app'
SCALE = 4
BG, WHITE, PURPLE = '#232323', '#faf9f6', '#9850ff'
image = Image.new('RGB', (512*SCALE, 512*SCALE), BG)
draw = ImageDraw.Draw(image)
def box(bounds): return tuple(round(v*SCALE) for v in bounds)
def stroke(points, width, fill=WHITE):
 points=[(round(x*SCALE),round(y*SCALE)) for x,y in points]
 draw.line(points,fill=fill,width=width*SCALE)
 r=width*SCALE/2
 for x,y in points: draw.ellipse((x-r,y-r,x+r,y+r),fill=fill)
draw.rounded_rectangle(box((110,76,414,436)),radius=46*SCALE,fill=WHITE)
draw.rounded_rectangle(box((134,100,390,412)),radius=22*SCALE,fill=BG)
draw.line([(184*SCALE,93*SCALE),(184*SCALE,419*SCALE)],fill=WHITE,width=18*SCALE)
draw.polygon([(x*SCALE,y*SCALE) for x,y in [(304,100),(304,198),(334,178),(364,198),(364,100)]],fill=PURPLE)
for y,end in [(264,350),(310,350),(356,306)]: stroke([(234,y),(end,y)],18)
for y in (166,234,302,370): stroke([(104,y),(142,y)],18)
for name,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512),('favicon-32.png',32)]:
 image.resize((size,size),Image.Resampling.LANCZOS).save(OUT/name,optimize=True)
image.resize((256,256),Image.Resampling.LANCZOS).save(OUT/'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
