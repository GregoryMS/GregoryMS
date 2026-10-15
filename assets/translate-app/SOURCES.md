# Translate app icon

Original geometric language-symbol artwork for Gregle, 2026-10-15. Two
overlapping language cards use the same charcoal #232323, warm-white #faf9f6
and violet #9850ff palette as the News, Radio, Astro and Finance app family.
The editable vector master is `icon.svg`. No stock artwork or external font.

Exports have opaque square backgrounds; the operating system supplies the
rounded mask. All foreground artwork fits inside a central circle with a
radius of 40% of the canvas width.

- `apple-touch-icon.png`: 180 × 180 for iPhone and iPad.
- `icon-192.png`: 192 × 192 web app icon.
- `icon-512.png`: 512 × 512 general and maskable icon.
- `favicon-32.png`: 32 × 32 browser icon.
- `favicon.ico`: 16, 32 and 48 pixel browser icons.

`scripts/render_translate_icons.py` reproduces the raster exports using
supersampling, Lanczos downsampling and opaque 128-colour palette exports.
Versioned links refresh web caches.
