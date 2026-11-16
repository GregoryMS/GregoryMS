# Offline vector-map assets

- Map styles generated with `@versatiles/style` 9.1.0 (`osm`, themes `muted` and `muted-dark`, text language `en`, landcover disabled). MIT licence included. Glyph/sprite URLs replaced with local URLs; the PMTiles source is supplied by Gregle.
- Base sprites: https://github.com/versatiles-org/versatiles-style/releases/download/v9.1.0/sprites.tar.gz (base and base@2x).
- Glyphs: https://tiles.versatiles.org/assets/glyphs/{noto_sans_regular,noto_sans_bold}/{range}.pbf. Noto Sans, SIL Open Font License 1.1; OFL.txt included. Cached ranges: 0–1535, 4608–5887, 7424–8703. CJK is rendered with MapLibre's device-font support.
- Tiles: VersaTiles OSM Shortbread snapshots, https://download.versatiles.org/. © OpenStreetMap contributors, ODbL 1.0; https://www.openstreetmap.org/copyright. Each package catalog records its dated upstream snapshot.

Browser libraries: MapLibre GL JS 5.6.2 (BSD-3-Clause), PMTiles JS 4.5.0 (BSD-3-Clause; bundled fflate MIT), @mapbox/vector-tile 2.0.4 (BSD-3-Clause), pbf 4.0.1 and @mapbox/point-geometry 1.1.0 (ISC). Full licence files are in assets/vendor/maplibre and assets/vendor/pmtiles. The tile-search helper bundles the latter two libraries and vector-tile to decode only the currently searched local tiles.
