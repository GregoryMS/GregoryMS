# Custom shield source artwork (SVG)

This folder contains **editable SVG templates** for BC-focused route shields:

- `bc-provincial-shield.svg`
- `trans-canada-shield.svg`

## Important OSMAnd limitation

For imported external `.render.xml` styles, OSMAnd reliably supports built-in `textShield` assets.
Directly loading arbitrary custom shield SVG/PNG files as `textShield` from a user style package is limited.

So this repo ships a practical approach:

1. The style file (`../BC_Custom_Highway_Shields.render.xml`) uses the closest built-in shield assets.
2. These SVG files are provided as **real-life visual references** you can edit and keep as source.
3. If you build a custom OSMAnd fork/resources bundle, you can convert these SVGs to app resources and wire them in.

## Using your own supplied artwork

If you have official/user-supplied PNG/SVG files:

- Replace these SVG templates with your files.
- Keep similar aspect ratios so route numbers stay legible.
- If you decide to build a custom OSMAnd resource package, map your custom drawables to `textShield` names in rendering resources.
