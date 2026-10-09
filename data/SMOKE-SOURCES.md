# Wildfire smoke forecast

Source: [BlueSky Canada / FireSmoke.ca](https://firesmoke.ca/),
[raw NetCDF forecast](https://firesmoke.ca/forecasts/current/dispersion.nc).

FireSmoke's [FAQ](https://firesmoke.ca/faq/) permits new publicly available
products based on its data with attribution; it prohibits embedding its existing
maps/products. Gregle renders its own overlays from the raw PM25 ground-level
concentration grid. No FireSmoke map, PNG, JavaScript or iframe is embedded.

`scripts/update_smoke_forecast.py` converts the latitude/longitude grid to a
Web Mercator image, using nearest-neighbour sampling and a custom palette.
Concentration thresholds are 1, 10, 28, 60, 120 and 250 µg/m³. Values below 1
are transparent. These are concentration bands, not AQHI health-risk categories.
The NetCDF timestamps indicate hour ends; Gregle labels hour starts, matching
the source's documented convention. Frames are sampled every three hours, with
the final available hour also retained.

The `smoke-forecast.yml` workflow checks hourly. It validates projection, units,
time sequence, freshness and finite concentrations before atomically replacing
`smoke-forecast.json`, which contains both metadata and our generated PNGs.
There is no raw NetCDF download in the visitor's browser. A failed refresh keeps
the last published file; the browser rejects forecasts older than 36 hours or
whose final hour has ended, and identifies forecasts older than 18 hours.

Run with Python, NumPy, SciPy and Pillow installed:

```sh
python scripts/update_smoke_forecast.py
python -m unittest discover -s tests -p 'test_smoke_forecast.py'
node --test tests/weather-smoke.test.cjs tests/weather-map-layers.test.cjs
```
