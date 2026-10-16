# Dictionary app icon

Original dictionary-book vector artwork made for Gregle. It uses the same opaque charcoal (#232323), violet (#9850ff) and warm white (#faf9f6) palette as the Translate app icon. No external imagery or fonts.

`icon.svg` is the scalable master. Rebuild the matching supersampled PNG and ICO assets with `python3 scripts/render_dictionary_icons.py` (Pillow required). Square, opaque source images let iOS apply its own corner mask. The artwork is inset for maskable app icon use.

Exports: 180px Apple touch icon, 192px and 512px web app icons, 32px PNG favicon, and multi-resolution 16/32/48px ICO favicon.
