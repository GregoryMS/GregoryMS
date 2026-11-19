# Canadian station radar

`gregle-canadian-radar` provides read-only, cached access to the ECCC DPQPE
rainfall-rate station images for CASAG (Aldergrove) and CASHP (Halfmoon Peak).
It has no credentials, storage bindings or scheduled jobs.

Routes:

- `GET /stations/CASAG/frames` (or CASHP): actual published scans, up to two hours.
- `GET /stations/CASAG/images/20261119T2000Z.gif`: a recent, dated source image.
- `GET /health`: supported stations and service status.

The proxy only fetches the fixed `dd.weather.gc.ca` radar directories. It rejects
other stations, arbitrary URLs, redirects, oversized bodies and out-of-window
image requests. Directory responses are cached for 60 seconds and dated GIFs
for one day. Yesterday's directory is included around UTC midnight. Contingency
composites are excluded so a station selection never silently becomes a mosaic.

The frontend (`assets/weather-radar-canada.js`) decodes the 580 x 480 GIF. It
uses the 480 x 480 station-centred image area at 1 km per source pixel, samples
its azimuthal-equidistant grid into Web Mercator tiles, and keeps only the
fourteen DPQPE precipitation palette colours. The source basemap, frame,
national banner and legend are omitted. Source dimensions and legend colours
are checked before rendering; a changed format fails explicitly. Grid lookups
are bounded to 24 tiles and decoded source images to three frames.

These are 1 km rainfall-rate estimates (mm/h), not NEXRAD super-resolution
reflectivity or velocity. No echo, missing coverage and terrain blockage cannot
always be distinguished from the GIF alone; the UI explains this limitation.
Source-image labels and boundaries can also obscure a small number of pixels.

Source documentation:

- https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radarimage-datamart_en/
- https://www.canada.ca/en/environment-climate-change/services/weather-general-tools-resources/radar-overview/radar-story.html

The source data is provided by Environment and Climate Change Canada under its
open-data terms. ECCC attribution is displayed on the map.

Deployment uses the accompanying Wrangler configuration (compatibility date
2026-11-19). Logs and sampled traces are enabled. The initial deployment was
uploaded through the connected Cloudflare API; keep the source and deployment
configuration together when updating it.

Validation:

```sh
node --test tests/canadian-radar-worker.test.cjs tests/weather-radar-canada.test.cjs tests/weather-radar-playback.test.cjs
```
