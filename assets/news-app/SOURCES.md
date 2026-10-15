# News app icon

Original geometric newspaper artwork created for Gregle News on 2026-10-15.
The Astro, Finance and Radio app icons supplied the style reference: full-bleed
charcoal #232323, warm-white #faf9f6 geometry, rounded details and a single
violet #9850ff accent. No stock or third-party artwork.

`icon.svg` is the editable master. The newspaper, violet masthead and folded
edge remain inside the central mask-safe circle of radius 40% of the canvas.
The background is opaque and square; iOS applies its own rounded mask.

Exports:

- `apple-touch-icon.png`: 180 × 180, iPhone and iPad Home Screen.
- `icon-192.png`: 192 × 192, web app icon.
- `icon-512.png`: 512 × 512, web app and maskable icon.
- `favicon-32.png`: 32 × 32, browser tab.
- `favicon.ico`: 16, 32 and 48 pixel browser icons.

`scripts/render_news_icons.py` reproduces these exports from the master SVG
rectangle geometry with supersampling and Lanczos downsampling. All PNGs are
opaque RGB images. HTML and manifest links share a version for cache refresh.
An existing iOS Home Screen shortcut may need to be removed and added again
to adopt the new icon.
