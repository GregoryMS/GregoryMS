# Satellite base map

Choose **Base map → Satellite** for Esri World Imagery. Native overlays stay
available, and saved preferences and copied links retain `base=satellite`.
Satellite imagery stays selected in the page's dark theme and supports zoom 23.
High-resolution screens request tiles one source zoom closer for sharper detail,
without requesting beyond Esri level 23. Where detailed tiles are missing, the
map steps down to available imagery while preserving the view. If even level 19
imagery fails completely, Gregle returns to the street map with a notice.
Other base maps retain their existing zoom 19 limit. Actual image detail varies
by location; closer zoom cannot add detail absent from the source photography.

The browser loads only
`https://gregle-esri.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.jpg`.
The Worker authenticates to Esri with the encrypted `ESRI_API_KEY` binding.
No key is included in HTML, JavaScript, configuration, storage or shared links.
Esri/provider credits appear in the map attribution while Satellite is active.

Deploy `workers/esri/wrangler.jsonc`, preserving the `ESRI_API_KEY` secret.
Set or rotate that binding through Cloudflare's encrypted secret input or
`wrangler secret put ESRI_API_KEY --config workers/esri/wrangler.jsonc`.
Never put a key value in configuration, source, command arguments or commits.

Only the Gregle map/site origins are accepted. The endpoint accepts bounded
tile coordinates through zoom 23, rejects extra parameters, follows no upstream
redirects, validates image signatures and bounds response sizes. Successful
tiles are cached for an hour; a shared limit of 240 cache misses per minute per
Cloudflare location reduces upstream demand. Origin checks and this approximate
limit are abuse controls, not visitor authentication or an account spending cap.
Provider failures return generic errors without exposing the upstream response.

Run `node --test tests/maps-esri-worker.test.cjs tests/maps-layers.test.cjs tests/maps.test.cjs`.

Sources: [Esri basemap tiles](https://developers.arcgis.com/maplibre-gl-js/maps/raster-tile-basemaps/display-multiple-basemap-layers/),
[World Imagery credits](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer),
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
