# Gregle

A static personal homepage and collection of browser tools, served at the domain in `CNAME`.

- `index.html`: search, recent searches, local weather and BBC headlines.
- `weather.html`: automatic local weather, Environment Canada across Canada and Open-Meteo worldwide.
- `petrol.html`: fuel-cost calculator with map-based routing.
- `ev.html`: EV trip-cost calculator with charging losses, unit conversion and map-based routing.
- `xkcd.html`: comic search using archive titles and context clues.
- `radio.html`: live internet radio with featured BBC/NRK stations and worldwide station/country search.
- `earthquakes.html`: recent earthquakes, a world/west-coast map and NOAA tsunami bulletins.
- `bookmarks.html`: searchable saved websites, preserving the exported folder hierarchy.
- `contact.html` and `donate.html`: contact and support pages.

`environment-canada.html` redirects older bookmarks to `weather.html`. `Victoria_weather.html` remains a standalone Victoria forecast page.

## Local preview

No build step or package installation is required. Serve this directory with any static web server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. Weather, headlines, autocomplete, map routing and live comic archives use external services and require network access. Browser storage and clipboard access may be restricted; the pages provide fallbacks for these cases.

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

## Local and worldwide weather

`weather.html` requests browser location access on opening (HTTPS or localhost required). While access is pending or unavailable, it shows the saved Vancouver, Victoria or Chilliwack shortcut, defaulting to Vancouver. Visitors can search for a city worldwide or retry **My location**. A manual choice cancels pending location/search work so late responses cannot change the selected city. Weather and earthquake pages have reciprocal, labelled icon shortcuts.

With permission, coordinates are rounded to two decimal places and sent to BigDataCloud's browser reverse-geocoding endpoint to identify the city/country, then to the forecast provider. No detected coordinates or searched cities are saved; only the existing Canadian shortcut preference is stored. The page explains these services beside its source attribution. If city lookup fails, a global forecast still works at the approximate coordinates.

Canadian locations use the nearest Environment and Climate Change Canada city forecast within 150 km, clearly naming that forecast city and its distance. The public city directory is fetched once per page visit. Existing BC shortcuts retain their direct endpoints. Open-Meteo provides seven local-calendar-day forecasts elsewhere and when the Canadian feed is unavailable or has no nearby station. Its current conditions are labelled as modelled estimates; high/low semantics and timezone are shown for each provider. Requests have bounded timeouts, cancellation, empty/error states and source links. City search uses Open-Meteo/GeoNames. No backend, API key or proxy is required.

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
