# Gregle Radio icon

Original retro portable-radio artwork in `icon.svg`, using the Gregle icon
family's charcoal (#232323), off-white (#faf9f6), and purple (#9850ff).

Run `python3 scripts/render_radio_icons.py` with Pillow installed to reproduce
the opaque 180px Apple touch icon, 192px/512px app icons, and browser favicons.
The square background lets iOS apply its own Home Screen corner shape.

The app manifest ID, start URL, standalone display, and iOS web app metadata
remain unchanged. Existing iOS shortcuts may need to be added again to refresh
their cached artwork.
