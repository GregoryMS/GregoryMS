# Nearest-city weather index

Source: GeoNames cities1000.zip and admin1CodesASCII.txt, downloaded 2026-11-16 from https://download.geonames.org/export/dump/.

© GeoNames contributors, Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/. GeoNames: https://www.geonames.org/.

This compact derivative keeps city/town and administrative-seat records (PPL, PPLC, PPLG, PPLA*) and excludes neighbourhoods and historical/abandoned places. It contains cities/towns with at least 1,000 residents and administrative seats, according to the GeoNames source; very small settlements may not appear. The nearest indexed settlement is selected by great-circle distance in a browser worker. No clicked coordinates go to GeoNames or a reverse-geocoding service.

Each record is [GeoNames ID, name, latitude, longitude, country code, first-level region, IANA time zone]. The JSON array is gzip-compressed deterministically. It is fetched on demand for weather lookup, rather than added to every offline map download.

Rebuild:

    curl -fL https://download.geonames.org/export/dump/cities1000.zip -o work/cities1000.zip
    curl -fL https://download.geonames.org/export/dump/admin1CodesASCII.txt -o work/admin1CodesASCII.txt
    python3 scripts/build_map_weather_cities.py --cities work/cities1000.zip --admin work/admin1CodesASCII.txt

Forecasts come from Environment Canada for Canadian locations, with Open-Meteo as fallback and for other countries. Each card attributes the forecast provider and links to the same city in Gregle Weather.
