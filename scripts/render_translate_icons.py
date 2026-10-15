"""Reproduce the Translate vector icon as opaque, supersampled app icons."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'/'translate-app'
S=4
BG='#232323'; WHITE='#faf9f6'; VIOLET='#9850ff'
image=Image.new('RGB',(512*S,512*S),BG)
draw=ImageDraw.Draw(image)
def rect(box,radius,fill):
    draw.rounded_rectangle(tuple(round(v*S) for v in box),radius=radius*S,fill=fill)
def stroke(points,width,fill):
    points=[(round(x*S),round(y*S)) for x,y in points]
    draw.line(points,fill=fill,width=width*S,joint='curve')
    r=width*S/2
    for x,y in points:
        draw.ellipse((x-r,y-r,x+r,y+r),fill=fill)
def bezier(p0,p1,p2,p3):
    result=[]
    for i in range(121):
        t=i/120; u=1-t
        result.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return result
rect((112,118,322,328),28,WHITE)
rect((208,214,400,394),26,BG)
rect((222,228,400,394),22,VIOLET)
stroke([(154,265),(193,167),(232,265)],18,BG)
stroke([(166,235),(220,235)],18,BG)
stroke([(257,274),(365,274)],14,WHITE)
stroke([(311,255),(311,274)],14,WHITE)
stroke(bezier((342,274),(330,317),(305,342),(261,359)),14,WHITE)
stroke(bezier((277,296),(291,327),(316,346),(360,359)),14,WHITE)
for name,size in [('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512),('favicon-32.png',32)]:
    image.resize((size,size),Image.Resampling.LANCZOS).quantize(colors=128,method=Image.Quantize.FASTOCTREE).save(OUT/name,optimize=True)
image.resize((256,256),Image.Resampling.LANCZOS).save(OUT/'favicon.ico',sizes=[(16,16),(32,32),(48,48)])
