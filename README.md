# Gregle

A static personal homepage and collection of browser tools, served at the domain in `CNAME`.

- `index.html`: search, recent searches, local weather and BBC headlines.
- `sports.html`: football fixtures and results for five men’s clubs, three women’s clubs, and the men’s and women’s national teams of Canada, Norway, Scotland, Sweden and England; current Premier League, Bundesliga, MLS conference and Women’s Super League tables.
- `finance.html`: searchable stocks, world-market and currency dashboards, and browser-saved favourites.
- `weather.html`: automatic local weather, Environment Canada across Canada and Open-Meteo worldwide.
- `petrol.html`: fuel-cost calculator with map-based routing.
- `ev.html`: EV trip-cost calculator with charging losses, unit conversion and map-based routing.
- `xkcd.html`: comic search using archive titles and context clues.
- `radio.html`: live internet radio with featured BBC/NRK stations and worldwide station/country search.
- `earthquakes.html`: recent earthquakes, a world/west-coast map and NOAA tsunami bulletins.
- `astro.html`: observing conditions, a 48-hour forecast, Clear Sky Charts and an interactive observing-site/light-pollution map.
- `bookmarks.html`: searchable saved websites, preserving the exported folder hierarchy.
- `contact.html` and `donate.html`: contact and support pages.

`environment-canada.html` redirects older bookmarks to `weather.html`. `Victoria_weather.html` remains a standalone Victoria forecast page.

## Local preview

No build step or package installation is required. Serve this directory with any static web server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. Weather, headlines, autocomplete, map routing and live comic archives use external services and require network access. Browser storage and clipboard access may be restricted; the pages provide fallbacks for these cases.

## BBC headlines

The homepage reads `data/bbc-news.json` from Gregle itself. The
`bbc-news.yml` workflow refreshes it from BBC's official front-page RSS feed
every 15 minutes and requests a Pages rebuild, following the existing data
workflows. GitHub's scheduler can delay runs. The browser checks for updates
every five minutes while visible and when returning to the page.

`scripts/update_bbc_news.py` validates the feed date and BBC article URLs before
atomically replacing the snapshot; failed refreshes leave the last good file
intact. The ticker retains usable headlines during transient request failures,
times out stalled requests after eight seconds and falls back to a BBC News
link when the feed is more than six hours old. It no longer uses rss2json.

Run `node --test tests/bbc-news.test.cjs` and
`python3 -m unittest discover -s tests -p 'test_bbc_news.py'` for focused checks.

## Search suggestions

Typing in the homepage search box requests up to eight suggestions from Google's autocomplete feed after a short pause. Queries are sent to Google for suggestions; selecting one (by click, tap, or arrow keys and Enter) searches Brave. The Search Gregle button continues to use Gregle. Escape, Tab, or leaving the field dismisses suggestions. Matching recent searches appear immediately and remain available if the external service fails. Suggestions are cached only in memory for the current page visit; recent searches continue to use local browser storage.

This is a static-site JSONP integration with a public, undocumented endpoint, so provider availability is not guaranteed. No API key or third-party proxy is used.

## Checks

Run the regression suite with Node.js 18 or newer, without installing dependencies:

```sh
node --test tests/*.test.cjs
```

GitHub Actions runs the suite on pull requests and pushes to `main`. The tests exercise page JavaScript with small DOM and service doubles, covering escaping, stored data, asynchronous requests, routing, EV energy and cost calculations, forecasts, wallet copying and local icon paths. They do not verify the availability of live external services or replace browser checks.

## Adding a tool

Add your HTML page, then copy a `.tool-card` in `links.html` and update its URL, title, description and icon. The homepage **Tools** menu item opens this directory. `links.html`, `xkcd.html`, `petrol.html` and `ev.html` share `assets/tools.css` and `assets/theme.js`, including the existing `gregle-theme` preference. The fuel and EV calculators share their layout in `assets/fuel.css` and routing in `assets/route-planner.js`. EV calculations run locally in `assets/ev.js`; electricity prices are examples that users replace with their own tariff.

The shared nine-dot app launcher includes Radio and Dictionary. Its three-row icon area scrolls independently of the homepage's More links section, keeping the original menu size. Drag icons to rearrange them, or hold before dragging on touch screens. With an icon focused, Alt + arrow keys changes its position; ordinary arrow keys navigate. Order is saved in `gregle-app-order` in this browser and shared across Gregle pages. Dropping outside the icon area cancels a drag. The launcher and scrolling links also work without JavaScript; ordering uses `assets/site-menu.js`. Update the app list in `scripts/update_site_menu.py`, run it to regenerate every page, and use `--check` to verify it is in sync.

## Maps

`maps.html` provides a Gregle interface for OpenStreetMap using pinned Leaflet 1.9.4, with address/place search, purple dropped pins, optional device location, copyable map links, keyboard map controls and full screen where supported. It opens on Victoria unless a valid map link specifies another view. The `#map=zoom/latitude/longitude` fragment preserves the view; optional `pin` and `name` values preserve a selected place. Map movement replaces the fragment without filling browser history. The shared launcher and the homepage Maps link open this page.

There is no Gregle backend, account, API key or location database. The browser loads standard OSM tiles and sends explicitly submitted searches to [Photon's public demo service](https://github.com/komoot/photon#demo-server), which permits reasonable project usage without availability guarantees. Searches do not run while typing; requests are spaced by at least a second, cached in memory (up to 30 queries), time out after ten seconds, and cannot overwrite newer input. A failed search offers a link to search on OpenStreetMap. Search result text is rendered as text, with coordinates validated before use. Location permission is requested only after pressing My location; late device responses cannot override a newer map action. Coordinates are not sent to the search provider. Copying a pin link intentionally includes its coordinates in the URL.

`assets/maps-config.json` holds the tile and Photon-compatible search endpoints so they can be changed separately from the UI. Standard browser tile caching is retained, with visible OSM copyright attribution, an identifying browser Referer and a report-map-issue link. There is no offline download, tile prefetch or background refresh. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and choose a hosted provider or your own infrastructure if traffic grows. The map's cartography keeps the original OSM colours in both themes; Gregle's surrounding controls follow the saved theme. External services are best effort, with readable map/search failure states and direct OSM access.

Run `node --test tests/maps.test.cjs tests/site-menu.test.cjs` for coordinate/link validation, search normalization, provider configuration and launcher consistency. Browser checks also cover real map tiles and search, mobile layout, pin sharing, location permission outcomes, request races and failure fallbacks.

## Astronomy observations

`astro.html` uses the shared tool theme and is linked from Tools. It opens on Vancouver, with Victoria and Chilliwack shortcuts, worldwide city search, and an explicit My location button. Searches use GeoNames via Open-Meteo. Browser coordinates are rounded to two decimals and never persisted. Selecting a location cancels previous forecast/search work and invalidates pending geolocation, so late responses cannot replace a new selection.

Astronomy can also be added to the iPhone Home Screen as a separate web app. Its `astro.webmanifest` uses `/astro.html` as its stable ID and launch page, with the name **Gregle Astronomy**, short name **Astro**, and standalone display. The custom crescent-and-star artwork includes an opaque 180px Apple touch icon, 192/512px manifest icons, and a 32px favicon. Open the astronomy page in Safari, then choose Share → Add to Home Screen. Re-add an existing shortcut if iOS retains its older icon. Live forecasts still require a network connection; no offline cache is introduced. See `assets/astro-app/SOURCES.md` for artwork provenance and the generation brief.

Open-Meteo supplies modelled current cloud cover, temperature, wind and humidity, plus 48 hours of cloud, rain probability, temperature, dew point, wind, humidity and visibility. Epoch timestamps are formatted in the forecast destination's IANA timezone. Missing samples remain unknown; stale current estimates are omitted. Refreshes occur every 15 minutes while visible and on return after that interval. The outlook is an explicitly documented cloud/rain/wind heuristic during astronomical darkness; it does not claim to predict atmospheric seeing or transparency or account for moonlight.

Sun and Moon calculations use locally vendored [SunCalc 1.9.0](https://github.com/mourner/suncalc) under its retained BSD license. Darkness windows sample solar altitude at 15-minute intervals over the next 48 hours, including polar day/night. Moon illumination, the named current phase and above-horizon status help assess moonlight. The next four major phase dates come from the public [US Naval Observatory API](https://aa.usno.navy.mil/data/api), validated and displayed in the selected location’s time zone. If unavailable, locally calculated SunCalc dates are explicitly labelled estimates that can differ by a day. No API key is required. The header weather icon opens the weather tool with the selected coordinates, name and time zone. The weather page has a reciprocal astronomy icon that preserves the location. Moon graphics are monochrome SVG discs with a calculated illuminated portion, rather than platform emoji.

The primary view is a Leaflet observing-site map, with a David Lorenz 2024 light-pollution overlay and 5,861 selectable Clear Sky Chart locations from the [user-selected directory](https://test.cleardarksky.com/browse/map.html). Markers are clustered for performance; their colours and estimated Bortle labels come from that directory. A list offers keyboard-accessible search by site name/key and up to 12 nearby sites within 200 km. Selecting a marker or list entry changes the chart and weather location together. A city search centres the map and selects the nearest chart within 200 km, explicitly displaying its distance. No matching site produces an empty chart state, not an unrelated forecast.

The chart is the provider’s original colour-block GIF, such as [Winer Observatory](https://test.cleardarksky.com/c/WnrObAZ/chart.gif), with cloud models, transparency, seeing, darkness and ground-weather rows where supplied. Its original dates, timezone offset and attribution remain visible; horizontally scroll the image on mobile. The image links to the provider’s site-specific explanations and legend. The source host is intentionally `test.cleardarksky.com`, matching the user’s references; the same new-style image path on the production www host returned 404 when checked. Image retrieval has an eight-second timeout, race protection and an explicit failure state. Retrieval time is not presented as the forecast issue time. Direct links remain available when images or map libraries fail.

The factual site directory lives at `data/astro-sites.json`; no provider HTML or descriptive paragraphs are copied. It is a dated snapshot, not a live directory API. Refresh it with `python3 scripts/update_astro_sites.py`, which retrieves the original map, parses only its JSON location array and validates keys, coordinates, colours, duplicates and completeness before writing. The updater can also accept a saved source HTML path for offline parsing. The directory is fetched from this site; site-name search stays local. City search, map tiles, chart images and forecasts require external network access.

Map attribution: [OpenStreetMap](https://www.openstreetmap.org/copyright), [David Lorenz](https://djlorenz.github.io/astronomy/lp/), and Clear Sky Chart / Dark Dragons Astronomy. The Lorenz 2024 tile layer uses the same URL and grid parameters as the reference map, including 1024px tiles and zoom offset −2. The overlay is modelled artificial sky brightness; the site’s estimated Bortle labels are not live measurements. Markers do not imply public access. Cloud, seeing and transparency regional maps remain available through the Environment Canada footer link. The existing iOS icon, manifest and standalone behaviour are retained.

Run `node --test tests/*.test.cjs` and `python3 -m unittest discover -s tests -p 'test_*.py'`. Astronomy checks cover missing/stale forecasts, asynchronous selection and geolocation races, directory validation, nearby-site coverage and polar astronomy. Browser checks also verify actual site selection, GIF loading, map layers and mobile overflow.

## Local and worldwide weather

Environment Canada warnings, watches, advisories and special weather statements appear above the weather heading only while active. `assets/weather-alerts.js` reads the official City Page Weather `warnings` array independently of the forecast, so forecast fallback does not suppress an available alert. It uses `alertColourLevel.en` (yellow, orange or red), with the explicitly coloured official title as a fallback; it never derives a colour from the alert type. Statements use a neutral style. Each card names the issuing forecast location and links to the official bulletin. For searched locations, alerts refer to the same nearest Canadian forecast city used by the forecast, rather than claiming exact-coordinate coverage.

Alerts refresh every five minutes while visible and immediately on returning to the page or changing location. Expired/cancelled alerts are removed, an empty feed hides the section, and non-Canadian locations do not request Canadian alerts. Failed, malformed or more-than-two-hour-old feeds hide unconfirmed cards and show a small official-source fallback beside the weather status; they are never reported as an all-clear. Feed text is rendered as text, and bulletin links are restricted to official HTTPS weather hosts. See [ECCC's colour-coded alert guidance](https://www.canada.ca/en/services/environment/weather/severeweather/weather-alerts/colour-coded-alerts.html). Tests cover colours, expiry, cancellation, failures, location races and refresh behaviour.

The satellite updater stops all provider requests on an error. Temporary HTTP 500/502/503/504 or network failures leave the existing file and its timestamps untouched and log a workflow warning only when all five cached orbits validate and both retrieval and orbit ages are within 48 hours. Older or incomplete data, permanent HTTP errors, redirects and malformed responses still fail the workflow. The next scheduled run attempts the refresh again; there is no immediate retry loop.

`weather.html` requests browser location access on opening (HTTPS or localhost required). While access is pending or unavailable, it shows the saved Vancouver, Victoria or Chilliwack shortcut, defaulting to Vancouver. Visitors can search for a city worldwide or retry **My location**. A manual choice cancels pending location/search work so late responses cannot change the selected city. Weather and earthquake pages have reciprocal, labelled icon shortcuts.

With permission, coordinates are rounded to two decimal places and sent to BigDataCloud's browser reverse-geocoding endpoint to identify the city/country, then to the forecast provider. No detected coordinates or searched cities are saved; only the existing Canadian shortcut preference is stored. The page explains these services beside its source attribution. If city lookup fails, a global forecast still works at the approximate coordinates.

Canadian locations use the nearest Environment and Climate Change Canada city forecast within 150 km, clearly naming that forecast city and its distance. The public city directory is fetched once per page visit. Existing BC shortcuts retain their direct endpoints. Open-Meteo provides seven local-calendar-day forecasts elsewhere and when the Canadian feed is unavailable or has no nearby station. Its current conditions are labelled as modelled estimates; high/low semantics and timezone are shown for each provider. Requests have bounded timeouts, cancellation, empty/error states and source links. City search uses Open-Meteo/GeoNames. No backend, API key or proxy is required.

Current conditions include pressure in kPa with ↑ rising, ↓ falling or → steady. Environment Canada station pressure and its reported tendency take priority. The fallback uses Open-Meteo sea-level pressure and compares hourly samples three hours apart (changes within 0.5 hPa are steady); a missing tendency has no arrow. Current, daily and hourly feels-like values use Open-Meteo apparent temperature. Daily feels-like high/low values cover the location's calendar day, including when the main Canadian forecast pairs daytime with the following night. Missing measurements stay unknown, and late responses cannot overwrite a newly selected location.

The Photography section below tides offers a full-day colour timeline for night, twilight, blue hour, golden hour and daylight, plus seven days of sunrise, sunset, solar noon and daylight duration. The timeline follows the actual local day, including 23- and 25-hour DST days; its Now marker appears only on today. Selecting a light phase or a labelled photography window highlights its exact times. The vendored SunCalc calculates golden windows at −4° to +6° solar altitude and blue windows at −6° to −4°, formatted in the destination time zone. The next or active window is highlighted, with nearby hourly cloud cover, precipitation probability, wind and visibility. Time-zone, DST, date-line, polar, missing-data and location-race cases are covered by `tests/weather-details.test.cjs`.

Provider documentation: [ECCC city forecasts](https://eccc-msc.github.io/open-data/msc-data/citypage-weather/readme_citypageweather_en/), [Open-Meteo forecast API](https://open-meteo.com/en/docs), [city search](https://open-meteo.com/en/docs/geocoding-api), [BigDataCloud browser geocoding](https://www.bigdatacloud.com/docs/free-api).

## Earthquakes and tsunamis

`earthquakes.html` shares the existing Gregle theme and is linked from `links.html`. Leaflet 1.9.4 (pinned with integrity checks) displays OpenStreetMap tiles, M2.5+ USGS events, and the source epicentres of active NOAA tsunami bulletins. The map opens on the west coast; period and magnitude filters apply to the worldwide list and earthquake markers. The banner always shows the latest M2.5+ earthquake in the past 24 hours, independently of the magnitude filter. USGS coverage of smaller earthquakes outside the U.S. is incomplete, and reports are preliminary.

Earthquakes load directly from the [USGS real-time GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php). Tsunami data uses the 15 current regional JavaScript products loaded by [NOAA's tsunami.gov map](https://www.tsunami.gov/), covering NTWC and PTWC bulletins, including Canada. The exact product names are in `assets/earthquake-core.js`. These are public website feeds, not a versioned API: upstream format changes fail to an unknown status. NOAA's PHP JSONP endpoint is deliberately avoided because its `text/html`/`nosniff` response is blocked by browsers. No proxy, API key or backend is required.

The page checks once per minute while visible and on return to the page. Each request has a 15-second timeout. All regional products must load and validate before a no-alert status is shown. Partial failures preserve available warnings and clearly mark the overall status unconfirmed. Last successful checks older than three minutes are marked unconfirmed; a failed earthquake refresh retains the previous results and labels them delayed. NOAA products are event-driven and may have old issue dates after cancellation; those dates are not treated as fetch timestamps. Persistent alert areas and bulletin segments are both inspected, so a cancellation for one coast does not hide an alert still in effect elsewhere. A USGS `tsunami` flag never creates a warning.

Warning, advisory, watch and threat cards show the issuing product, affected-area text/instructions when provided, issue time and official bulletin link. Map diamonds identify **source earthquakes**, not inundation areas or evacuation boundaries. This is a monitoring page, not an emergency notification service; official bulletins and local authorities remain the source for protective actions. Tests cover cancellation, partial failures, stale status, retained alerts, feed validation and time/magnitude filters.

## Refreshing the xkcd index

The browser searches `data/xkcd-index.json` on this site, avoiding cross-origin archive requests and third-party proxies. The checked-in snapshot includes all official titles through the recorded `latest` comic, excluding xkcd’s deliberately missing #404. It is a title index with selected context clues, not a full-transcript index.

To include newly published comics, run this with Python 3.10+ and curl, then commit the updated JSON:

```sh
python3 scripts/update_xkcd_index.py
```

The updater reads the official archive and latest-comic JSON, decodes HTML entities, and refuses to overwrite the existing index if comic IDs are missing or inconsistent. The page shows the index date and latest comic; **Reload index** fetches the copy currently deployed on Gregle. New comics appear after an updated index is committed and deployed.

The parser has separate offline checks:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

## Bookmarks

`bookmarks.html` contains the 23 September 2026 export as static, escaped HTML, so links and folders also work without JavaScript. `assets/bookmarks.js` adds local search across titles, URLs and ancestor folder names; no searches or bookmarks are sent to a service. Clearing search restores the previous folder expansion state. The page uses the shared tool theme, with its layout in `assets/bookmarks.css`.

The import preserves order and duplicate bookmarks: 933 web links from 937 entries in 106 folders. Three JavaScript bookmarklets and one browser-internal URL were omitted. Two private order URLs were replaced with the provider’s public homepage; the original export, browser metadata and private order identifiers are not published.


## Internet radio

`radio.html` uses the shared tool theme with `assets/radio.css`, `assets/radio-core.js` (station data, directory client and player), and `assets/radio.js` (page interactions). Ten featured stations are available without a directory request. BBC Radio 1 and NRK P3 have prominent one-click cards; the rest include BBC Radio 2/6 Music, NRK P2/mP3/P3 Musikk/Jazz, FIP and Radio Paradise.

Station and country search uses the public [Radio Browser API](https://docs.radio-browser.info/), filtering for working HTTPS streams, with 30-row pagination, deduplication, request cancellation, timeouts, server discovery and retry. The country selector includes a checked-in snapshot of country codes from the directory, labelled in English. Search failure preserves locally featured matches and the current audio. Names and metadata are rendered as text; stream and website URLs are validated. User-initiated directory plays are recorded through the directory's click endpoint.

BBC streams use verified HTTPS worldwide HLS playlists. Browsers with native HLS use their audio player; other compatible browsers use HLS.js 1.6.13 from jsDelivr, pinned with SHA-384 integrity. NRK and the other featured stations use native MP3 playback. Only one audio instance is active; switching stations, Stop and page exit release the previous stream. Playback starts on a user click, never on page load, and errors offer reconnect and the station website. There is no proxy, recording, API key or bypass of broadcaster restrictions. Keep the page open while listening.

Sources checked 23 September 2026: [BBC international live-listening guidance](https://help.bbc.com/hc/en-us/articles/42652680528659-Update-on-access-to-BBC-Sounds-outside-the-UK), [NRK official stream directory](https://lyd.nrk.no/), [NRK listening help](https://info.nrk.no/radio/), [HLS.js](https://github.com/video-dev/hls.js). Stream URLs and country availability can change; update the featured list when needed.


### iPhone Now Playing and station artwork

The radio player publishes the selected station name, “Live radio · Gregle”, and artwork through the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession). Metadata follows station changes and remains available when paused. Lock-screen/Control Centre play, pause and stop actions control the active stream. Stop and playback failure clear the session; live radio does not supply a fabricated track duration or seek handlers. The page title is exactly the selected station name, set before playback starts and refreshed on playback and page visibility changes as a fallback. Radio script and stylesheet URLs are versioned to avoid reusing the previous player from the browser cache. Unsupported Media Session features never prevent playback.

BBC Radio 1 and NRK P3 logos appear on their cards, in the page player, and as Now Playing artwork. Other stations receive Gregle Radio artwork, so the previous station's logo is never reused. Local PNGs with absolute metadata URLs avoid cross-origin image dependencies and SVG artwork compatibility issues. See `assets/radio-logos/SOURCES.md` for the broadcaster assets and conversion details.

On iPhone, reload the radio page after an update and start a station. iOS chooses the final Lock Screen/Control Centre layout; desktop browser emulation cannot verify a physical iPhone's system UI.

### Gregle Radio Home Screen app

`radio.html` has its own `radio.webmanifest`, a 180px Apple touch icon, and 192px/512px app icons. Its stable installation name is **Gregle Radio**, independent of the playing station title, and its launch URL is `/radio.html`. The icon is an original G/broadcast mark made with the built-in image-generation tool. The two featured broadcaster logos are also included directly in the HTML so they render before JavaScript starts.

For a new iPhone installation, open the radio page in Safari and use Share → Add to Home Screen. Remove an older radio shortcut and add it again if it retains the old icon. This configures the Home Screen experience, not offline radio playback. Apple documents page-specific icons and app names at https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html.


### Tide tracker

`tides.html` shares the weather page’s styles and offers coastal location search,
location shortcuts, a seven-day tide curve, predicted level and high/low times.
The Weather icon and the weather page’s tide icon/Today’s tides card preserve the
selected coordinates, name, country and timezone through URL parameters. Explicit
location links take precedence over automatic weather geolocation. The Tools
page includes a Tide tracker card.

- Canada: the nearest CHS station within 30 km offering both `wlp` and `wlp-hilo`
  from `https://api-sine.dfo-mpo.gc.ca/api/v1`, with 15-minute curves and official
  turning-point times. Heights are metres above chart datum; the station name
  and distance are shown because it may differ from the selected city.
- Elsewhere, or if CHS is unavailable: Open-Meteo Marine’s hourly
  `sea_level_height_msl`, restricted to a sea grid cell within 25 km. These are
  explicitly labelled model estimates, include weather effects, and use mean
  sea level rather than chart datum. High/low times are approximate hourly
  turning points. Missing samples are never treated as zero or bridged.
- Inland/uncovered locations and service failures show distinct empty/error
  states. No API key or backend is needed. Times use the destination’s timezone;
  searches provide its IANA timezone. Device geolocation uses the browser’s zone.
- Both pages refresh tide data while visible every 15 minutes. Forecast dates
  are padded to classify turning points around midnight. The chosen location
  is included in links, but is not persisted to local storage by the tide page.

Provider references: [CHS web services](https://www.tides.gc.ca/en/web-services-offered-canadian-hydrographic-service)
and [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api).
Run `node --test tests/*.test.cjs` and
`python3 -m unittest discover -s tests -p 'test_*.py'` for regression checks.

Weather and Tides can be added to an iPhone home screen as separate web apps.
Each page has its own manifest ID, start URL, short name, standalone display,
180 px Apple touch icon, 192/512 px manifest icons and 32 px favicon. Open the
page in Safari and use Share → Add to Home Screen. Re-add existing shortcuts
if iOS retains the old icon. These apps require a network connection for live
forecasts; no offline forecast cache is introduced.
Artwork provenance and generation prompts are in `assets/weather-app/SOURCES.md`
and `assets/tides-app/SOURCES.md`.

### Weather radar

`weather.html` includes a location-aware Leaflet radar map below the forecast, with
play/pause, a keyboard-accessible history slider, refresh and recenter. RainViewer
supplies up to two hours of observed precipitation frames in ten-minute steps;
there is no future radar forecast. Composite generation times use the selected
location’s timezone. A clear map does not confirm dry weather: coverage varies.

`assets/weather-radar.js` loads the map when near the viewport, checks for updates
every five minutes while visible, pauses playback when hidden, validates the feed
and tile host, and reports failed tiles, refresh failures and delayed imagery.
It keeps the current image and timestamp visible until the next frame is fully
loaded, preloads one frame ahead during playback, and pauses briefly at the latest
observation before looping. Viewed layers are cached and dropped on map movement
to avoid fetching hidden layers for new areas. The 512px tiles use the supported
Universal Blue palette with separate snow colours (`1_1` tile options), and at most
provider zoom 7 (closer views overzoom). Separate rain and snow legends use the
provider’s colour table; precipitation type follows RainViewer’s classification.
Map-area tile requests go directly to RainViewer and OpenStreetMap. No key or
backend is required. Provider references: [API](https://www.rainviewer.com/api/weather-maps-api.html),
[2026 limits](https://www.rainviewer.com/api/transition-faq.html).

### Astronomical events calendar

The bottom of `astro.html` includes a month grid, accessible event list and native event-detail dialog. Moon phases and the four equinoxes/solstices come from the US Naval Observatory annual APIs. Dates are converted to the selected observing location's time zone. January and December also load the adjacent year for events crossing local midnight. Requests time out after eight seconds; `data/astro-events.json` provides verified 2026–2027 fallback dates, retrieved 2026-10-02. Missing dates outside that fallback range are explicitly reported, with Retry available.

Meteor shower entries are approximate annual peak-night reminders, with year-specific corrections for the 2026 Leonids and 2027 Lyrids from the [AMS 2026/2027 calendar](https://www.amsmeteors.org/calendar/), checked 2026-10-02. They link to the current AMS calendar for updates; they are not predictions of local visibility or exact peak times. The [NASA shower guide](https://science.nasa.gov/solar-system/meteors-meteorites/meteor-showers/) provides additional context.

Each event offers an iCalendar `.ics` download and a Google Calendar template link; a whole month can also be downloaded. Exports are snapshots, not subscriptions. Timed astronomical instants use UTC and a one-minute calendar marker; meteor peak nights use two-day all-day reminders with exclusive end dates. Stable UIDs, escaped text, CRLF separators and 75-byte UTF-8 line folding follow iCalendar conventions. No calendar account access is requested. Core date conversion and export tests are in `tests/astro-calendar.test.cjs`.

The calendar also calculates year-specific planetary oppositions (Mars through Neptune), Mercury/Venus greatest elongations, and global solar/lunar eclipse peaks using the locally vendored MIT-licensed Astronomy Engine 2.1.19. These events work without a remote ephemeris request and use the same timezone conversion and iCalendar/Google exports as the original events. Solar eclipse labels describe the greatest-eclipse point; they do not predict visibility or totality at the selected observing site. NASA links, local-visibility notes and solar-viewing guidance are included. The version and exact source are recorded in `assets/vendor/astronomy-engine-SOURCES.md`.

Full moons are annotated in place, retaining their UIDs: monthly blue moons use the selected timezone, while the explicitly disclosed supermoon convention is a geocentric distance of at most 365,000 km at full moon. This is an informal threshold, not an official definition. The Draconids are included as an approximate October 8–9 peak-night reminder with an IMO source. Sea and Sky is linked as an additional guide; its prose is not copied. New event generation, NASA eclipse fixtures, timezone-dependent labels and export stability are covered by the calendar tests.


### Wind and cloud forecast maps

The weather map offers a keyboard-accessible Radar / Wind / Clouds selector.
Radar retains RainViewer's observed precipitation playback. Wind and Clouds use
[Windy's official map embed](https://embed.windy.com/config/map), centred on the
selected weather location with ECMWF, surface wind in km/h and cloud cover.
Windy's own renderer supplies smooth shading, animated wind particles, map labels,
colour scale and forecast timeline. Forecasts are explicitly distinguished from
radar observations. Switching to forecasts pauses radar playback and its automatic
feed refresh; returning restores the existing radar view and checks for updates.

`assets/weather-map-layers.js` creates only the active forecast iframe. Radar is
the default and sends no request to Windy. Selecting a different city, Refresh or
Recenter recreates the forecast frame. Returning to Radar removes the frame;
back-forward restoration recreates the selected forecast. The forecast view has
its own pan/zoom state. A loading timeout and always-available full-map link cover
slow or blocked embeds. An iframe load event confirms its document only, not the
availability of cross-origin weather tiles; Windy manages its own data errors.
The selected coordinates are sent to Windy only while a forecast layer is selected.

## Finance tracker

`finance.html` is linked from Tools and the homepage Finance menu. It uses official TradingView Advanced Chart, Market Overview and Ticker Tape embeds. The top ticker shows GBP, EUR, SEK, NOK, AUD, NZD, USD, CHF and JPY in CAD per one unit, with daily changes and links back to the relevant chart. The chart includes full symbol search; Gregle’s quick lookup offers a deliberately small company directory, ten currencies and their pairs, and explicit exchange:ticker lookup. Index CFDs and ETFs are labelled as such. Quotes, exchange status and delays remain provider-rendered; the site does not manufacture prices or treat widget load time as a quote timestamp.

Widget symbols can be opened using `?symbol=NASDAQ:AAPL` or TradingView’s `?tvwidgetsymbol=FX_IDC:USDCAD`. Input is validated before configuration. Favourites (up to 12) are stored in `gregle-finance-favourites` in localStorage, with corrupt/blocked-storage fallback. They are shortcuts, not holdings or portfolio valuations. The shared theme is applied to all widgets; changing it recreates embeds, resetting any changes made inside the chart itself.

A failed script or missing iframe after 20 seconds shows a retry action; direct provider links remain available. An iframe appearing does not prove its underlying quote feed is available: errors/delays inside it remain TradingView’s responsibility and presentation. Attribution is retained. No API keys, private APIs or proxy service are required. Sources: [Advanced Chart](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/), [Market Overview](https://www.tradingview.com/widget-docs/widgets/watchlists/market-overview/), [currency overview](https://www.tradingview.com/widget-docs/widgets/watchlists/market-overview/), [widget navigation](https://www.tradingview.com/widget-docs/tutorials/build-page/navigation/).

### Satellite tracker

The last section of `astro.html` tracks ISS, Tiangong, Hubble, Terra and Aqua
on a Leaflet/OpenStreetMap map. The selector changes the marker, details and
location-specific Heavens-Above pass link. The map shows a violet recent track
and an optional dashed orange projection for the next 90 minutes, sampled once
per minute. Both paths break at the date line; the recent track also breaks
after polling gaps and retains at most thirty minutes of displayed positions.

`assets/astro-satellite-core.js` propagates CelesTrak OMM orbit records with
vendored MIT-licensed Satellite.js 6.0.1. Coordinates, altitude, speed and elevation
above the selected observing location update every ten seconds while visible.
These are orbital estimates, not live telemetry. Elevation assumes sea level
and does not establish visual visibility. The orbit epoch and age are shown;
data over two days old has a caution and data over seven days old is rejected.
Switching satellites clears the previous marker, paths and readings.

`data/satellite-orbits.json` is served from this site. The
`satellite-orbits.yml` GitHub workflow refreshes it every six hours using
`scripts/update_satellite_orbits.py`, requesting only the five tracked objects
from the documented [CelesTrak GP API](https://celestrak.org/NORAD/documentation/gp-data-formats.php).
It stops on any provider error and replaces the file only after validating all
five records. Changed records are committed and a Pages rebuild is requested
explicitly because bot commits do not trigger ordinary push workflows.
The browser rechecks the same-site file hourly or on Reload orbit data; request
failures preserve usable orbit records with an explicit message.

Follow satellite can be turned off to pan the map. Pass links default to UTC
and share the observing coordinates with Heavens-Above when opened. Provider
links remain available when orbit data or map tiles are unavailable.

## Home Screen icon family

Astro, Tides, Weather, Finance and Earthquakes share Gregle Radio’s charcoal, white and violet icon style. Each page includes versioned 180px Apple touch and 32px browser icons, plus 192/512px manifest icons. The 512px artwork is safe for both ordinary and maskable installation; opaque square backgrounds let the OS choose the corner shape. PNG palettes keep the files small. Stable manifest IDs and launch pages preserve each app’s identity. The launch background is charcoal; the pages retain their light/dark theme preference. Safe-area padding protects controls around notches and the home indicator.

On iPhone or iPad, open the specific page in Safari and choose Share → Add to Home Screen. On supporting desktop/Android browsers, use the browser’s Install app option. Re-add an existing iOS shortcut if it retains the old icon. Forecasts and maps still need a network connection.

Finance now has its own `finance.webmanifest`, stable `/finance.html` app ID and launch URL, and **Finance** Home Screen label. Its white bar chart and violet rising arrow follow the same icon family. Install from the Finance page; existing generic shortcuts may need to be re-added. Market widgets still need a network connection. See `assets/finance-app/SOURCES.md` for artwork and export details.

Earthquakes has its own `earthquakes.webmanifest`, stable `/earthquakes.html` app ID and launch URL, and **Quakes** Home Screen label. Its white-and-violet seismic trace follows the same icon family. Install from the Earthquakes page; existing generic shortcuts may need to be re-added. Live earthquake and tsunami data still requires a network connection. See `assets/earthquakes-app/SOURCES.md` for artwork and export details.

## Fog and waves maps

The weather map includes Fog alongside Radar, Wind and Clouds, using the same Windy ECMWF forecast controls. The tides page includes a matching Windy ECMWF WAM waves map in Surf conditions. It loads near the viewport, follows the selected tide location even if the tide or surf data service fails, and has its own independent forecast timeline. Recenter and Refresh recreate the embedded map; frame failures and slow loads offer a full-map link. Wave heights use metres. Both embeds receive the selected coordinates.


## Sports tracker

`sports.html` is linked from Tools and shares the Gregle theme. ESPN’s public JSON feeds supply all-competition team schedules (separate fixtures and results) and current league standings. No API key, proxy or build is required. The page requests data when opened and once per minute while visible, with six concurrent requests and 15-second request timeouts. Refresh retries failed feeds. Provider data and crest images are requested directly from ESPN; these public, undocumented feeds may change or omit fixtures. Empty schedules are distinguished from failed requests. Partial failures are identified beside matches, teams and tables; previously loaded data is retained with an older-data notice. Nothing is shown as a fabricated score or standing.

Men’s and women’s team IDs remain separate. Fixtures include domestic cups, European competitions and internationals when the provider publishes them. Overlapping team schedules are deduplicated by event ID. All dates use the device time zone, and unconfirmed kick-off times are marked TBC. Filters are saved under `gregle-sports-filters`; scores and tables are not persisted. MLS conferences are separate, tables use provider ranks and point totals, and followed clubs are highlighted. National teams have match tracking; the four league tables cover the selected clubs.

`assets/sports-core.js` handles event/status/score and table normalisation; `assets/sports.js` handles retrieval, freshness, filters and rendering. Run `node --test tests/sports.test.cjs` for focused checks, or the full regression commands above. ESPN match and table links remain available when feeds fail.

The **Live now** section appears only when the schedule feeds report a followed team playing. It includes all followed teams regardless of the match-centre filter. `assets/sports-live.js` retrieves the specific ESPN match summary every 30 seconds while visible and shows score, clock, possession, shots, shots on target, corners, fouls, yellow/red cards and offsides where published. Statistics are matched by home/away team ID. Missing stats use an em dash; failed or expired stats are not presented as current. A full-time summary hides the game immediately, even if its schedule still says live. A late response cannot bring back a removed game.

Each live match has a compact UK, Canada, Norway, Sweden and Germany TV/streaming guide. `scripts/update_sports_tv.py` fetches FotMob’s public country-specific TV listings into `data/sports-tv.json`; `.github/workflows/sports-tv.yml` refreshes them every 30 minutes and requests a Pages rebuild, matching the existing data-update workflows. The browser reloads that snapshot every five minutes during live games. Listings retain their country, home/away names, women’s-team markers and programme start time. Matching requires both teams, sides, gender and a start within 90 minutes of kick-off (to allow pre-match programmes). No general rights-holder guesses are used. Listings more than six hours old, unmatched games, and unconfirmed kick-off times show an unavailable/no-confirmed-listing message with a country guide link. Partial refresh failures retain each country’s original check time. Provider coverage and listings can change.

Run `node --test tests/sports*.test.cjs` and `python3 -m unittest discover -s tests -p 'test_sports_tv.py'` for the sports checks.


