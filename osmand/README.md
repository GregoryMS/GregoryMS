# OSMAnd theme: BC Custom Highway Shields

This folder contains a GitHub-friendly (no binaries) OSMAnd rendering style package source:

- `BC_Custom_Highway_Shields.render.xml`
- `custom_shields/*.svg` (editable source artwork/templates)
- `custom_shields/README.md`

## Direct download links (all files)

Use these links in GitHub to download individual files:

- [Download style XML](./BC_Custom_Highway_Shields.render.xml)
- [Download BC shield SVG template](./custom_shields/bc-provincial-shield.svg)
- [Download Trans-Canada shield SVG template](./custom_shields/trans-canada-shield.svg)
- [Download custom shields notes](./custom_shields/README.md)

## Optional: create ZIP package locally

If you want a distributable ZIP before sharing to devices:

```bash
cd osmand
zip -r BC_Custom_Highway_Shields.zip BC_Custom_Highway_Shields.render.xml README.md custom_shields
```

## What this style changes

- **Blue BC provincial shields** for route relations tagged `network=ca:bc`.
- **Green Trans-Canada / Yellowhead shields** for route relations tagged `network=ca:transcanada` or `network=ca:yellowhead`.
- Preserves the rest of OSMAnd default rendering (`depends="default"`).

## Install in OSMAnd

1. Copy `BC_Custom_Highway_Shields.render.xml` to your device.
2. In OSMAnd, open:
   - **Menu → Configure map → Map rendering style**
3. Choose **Install from file** (wording may vary by app version).
4. Select `BC_Custom_Highway_Shields.render.xml`.
5. Activate **BC Custom Highway Shields**.

## About real-life custom PNG/SVG shields

- This repo includes `custom_shields/` SVG templates so you can use/edit user-supplied artwork.
- Current OSMAnd external style import mainly supports built-in `textShield` assets in `.render.xml`.
- Therefore this style uses closest built-in shield shapes/colors for immediate compatibility.
- If you later build a custom OSMAnd resource bundle/fork, you can wire the SVG/PNG artwork directly.
