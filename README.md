# Gregle

A static personal homepage and collection of browser tools, served at the domain in `CNAME`.

## App subdomains

GitHub Pages remains the only site host and this repository remains the only
source. `assets/site-routes.json` maps each content page to its canonical
hostname, for example `weather.gregle.uk` and `maps.gregle.uk`. The Cloudflare
Worker in `workers/site-router/` fetches the existing page from `gregle.uk` for
each app root and streams shared assets and generated data from the same origin.
Its `*.gregle.uk/*` route passes unlisted hosts, including Cloud, Docs and www,
to their existing origins. More-specific routes for `cloud.gregle.uk/*`,
`docs.gregle.uk/*` and `www.gregle.uk/*` have no Worker selected, so these existing
services bypass the router entirely. Keep these dashboard bypass routes when
redeploying the app router. The apex and original `.html` URLs remain available,
including existing installed app launch URLs and their browser storage.

Menus, home links, tool cards, canonical links and generated Weather/Tides links
use the new hostnames. Stable menu IDs retain the original saved ordering on
the old origin. On an app subdomain its manifest uses `/` for its ID and launch
URL; the source manifests retain their original IDs for existing installations.
Browsers keep saved app settings separately for each origin, so a newly opened
subdomain starts with its own settings; the old URL retains existing saved data.
The map API Workers explicitly allow `https://maps.gregle.uk` alongside the apex
and www origins.

To add a page, add it to `assets/site-routes.json`, add a proxied CNAME for its
hostname pointing to `gregle.uk`, regenerate the launcher, and redeploy the
router with `npx wrangler deploy --config workers/site-router/wrangler.jsonc`.
`workers/site-router/subdomains.zone` is the initial set of app DNS records;
import with **Proxy imported DNS records** checked. Keep the existing seven
apex/www/Cloud/Docs records. Reverting the router route and this change restores
the original navigation without moving or deleting any site files.

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

The sports dashboard uses the same validated generator with `--feed sport` and
BBC Sport’s official `https://feeds.bbci.co.uk/sport/rss.xml` feed. The separate
`bbc-sport.yml` workflow refreshes `data/bbc-sport.json` every 15 minutes and
requests a Pages rebuild. The sports ticker polls every five minutes while
visible, pauses on hover/focus, and respects reduced motion with manual
horizontal scrolling. Its neutral background and rounded BBC blocks match the
homepage ticker, with yellow branding for Sport. Failed or expired feeds link to BBC
Sport; usable recent headlines survive temporary outages.

The sports page provides team/category filters, a team or competition search,
Today/Next 7 days filters, a clear-filters control, fixtures/results/live views,
and compact standings with a More stats control. All 22 followed teams, live
stats and TV listings remain available. Search and date filters affect the
match list; team/category filters also update the two spotlight cards. Standings
always show the selected league in full.

## Finance

Finance separates Markets, Explore and Currencies into three keyboard-accessible
tabs. Each view has a full-width chart or quote list, and widgets load when their
view is first opened. Search results and favourites open Explore automatically;
symbol query links and view fragments remain shareable. Theme changes refresh
the visible widgets and apply to other views when opened.

Favourites remain in `gregle-finance-favourites` in this browser. Use Edit to
remove them, or Save beside a search result to add one. The currency view keeps
the CAD ticker, currency lists and a From/To selector for opening a pair's chart.
Provider failures retain a retry button and a direct TradingView link.

The Calculator button opens a non-modal panel above the page. Drag its title
with a mouse or touch, or focus the title and use arrow keys (Shift moves farther;
Home resets the position). It stays visible while scrolling, keeps its position
and calculation until the page reloads, and stays inside the visible viewport
after resizing. Close it with its close button, the Calculator button or Escape.
Numbers and operators work from the keyboard while the panel has focus; Enter
calculates, Backspace deletes a digit, and C or Delete clears. Arithmetic runs in
the order entered; percentages support additions such as 200 + 10% = 220. The
calculator runs locally and follows the page's light/dark theme.

Run `node --test tests/finance*.test.cjs` for lookup, storage, tab navigation,
deep links, theme changes, widget fallbacks and calculator interaction checks.

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

The shared nine-dot app launcher includes Radio, Dictionary and Cloud (https://cloud.gregle.uk). Its three-row icon area scrolls independently of the homepage's More links section, keeping the original menu size. Drag icons to rearrange them, or hold before dragging on touch screens. With an icon focused, Alt + arrow keys changes its position; ordinary arrow keys navigate. Order is saved in `gregle-app-order` in this browser and shared across Gregle pages. Dropping outside the icon area cancels a drag. The launcher and scrolling links also work without JavaScript; ordering uses `assets/site-menu.js`. Update the app list in `scripts/update_site_menu.py`, run it to regenerate every page, and use `--check` to verify it is in sync.

## Maps

`maps.html` provides a Gregle interface for OpenStreetMap using pinned Leaflet 1.9.4, with address/place search, purple pins dropped by double-clicking, double-tapping or touching and holding, optional device location, copyable map links, keyboard map controls and full screen where supported. It opens on Victoria unless a valid map link specifies another view. The `#map=zoom/latitude/longitude` fragment preserves the view; optional `pin` and `name` values preserve a selected place. Touch pin placement accepts a 450 ms double-tap interval and 32 px between taps, or a 550 ms hold. Movement beyond 15 px, pinch zoom and cancelled touches discard the gesture; controls, existing markers and popups retain their own interactions. Compatibility double-clicks are suppressed after touch input so a pin is placed once. Map movement replaces the fragment without filling browser history. The shared launcher and the homepage Maps link open this page.

On screens up to 700 px wide, place details, search results, directions, layers, fuel prices, the vessel key, copy-link fallback and selected map-feature popups share one bottom drawer. Drag its header to any height, tap the header or chevron to minimize/expand, or switch between open panels with the tabs. The header also supports arrow keys, Page Up/Down, Home and End. Content scrolls independently; panning the map leaves the drawer height unchanged. Existing DOM nodes move back to their original desktop positions when the screen widens.

Maps has its own Home Screen icon and `maps.webmanifest`, with stable `/maps.html` app ID and launch URL, **Maps** label, standalone display and Gregle purple theme colour. The existing folded-map artwork is exported as opaque 180px Apple touch, 192/512px manifest and 32px favicon PNGs. On iPhone or iPad, open Maps in Safari and choose Share → Add to Home Screen; re-add an existing shortcut if it retains its old icon. Map data still needs a network connection. See `assets/maps-app/SOURCES.md` for export details.

There is no Gregle backend, account, API key or location database. The browser sends explicitly submitted searches to [Photon's public demo service](https://github.com/komoot/photon#demo-server). Nearby search is the default: requests include the current map centre, zoom and padded viewport bounds, with a minimum area extending about 15 km in each direction so nearby suburbs remain searchable at street zoom. Photon receives a bounding-box restriction and location bias; results are also filtered to that area before showing up to six places. Dateline-crossing views use location bias and the same wrap-aware client filter. Search worldwide explicitly removes the area restriction, and Search this area returns to nearby search. Moving the map cancels and hides an in-flight search; searches do not run automatically while typing or panning. The in-memory cache (up to 30 entries) includes the query, location, zoom, bounds and search scope, so moving to another city cannot reuse that query's old results. Requests remain spaced by at least one second and time out after ten seconds. Photon permits reasonable project usage without availability guarantees; failed searches offer an OpenStreetMap link with the current map view. Results remain plain text with validated coordinates. Map coordinates are sent to Photon only as part of an explicitly submitted nearby search. Device location permission is requested only after My location, and late device responses cannot override a newer map action. Copied pin links intentionally include their coordinates.

`assets/maps-config.json` holds the tile, Photon-compatible search and Overpass place endpoints so they can be changed separately from the UI. Standard browser tile caching is retained, with visible OSM copyright attribution, an identifying browser Referer and a report-map-issue link. There is no offline download, tile prefetch or background refresh. Follow the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and choose a hosted provider or your own infrastructure if traffic grows. The map's cartography keeps the original OSM colours in both themes; Gregle's surrounding controls follow the saved theme. External services are best effort, with readable map/search failure states and direct OSM access.

Double-clicking or double-tapping a mapped place at zoom 13 or closer requests nearby tagged POIs and containing buildings/parks from the [Private.coffee Overpass service](https://overpass.private.coffee/) using its current interpreter endpoint. Search results and shared `osm=node/ID`, `way/ID` or `relation/ID` pin links use the exact OSM element instead. The scrollable place card shows available phone, recorded opening hours, website, email, accessibility, cuisine and operator information, with the returned OSM tags in an expandable section. The preferred Overpass response includes all tags; fallback results are labelled Available tags. Ordinary weekly hours are expanded into Monday–Sunday rows using 24-hour times, separate lines for split shifts, explicit closed days, and holiday exceptions below the list. Midnight closing is shown as 24:00; supported overnight hours show the next-day ending. Seasonal, solar, date-specific, fallback and interacting overnight rules retain the original schedule instead of guessing a daily list. The original opening_hours tag remains available in the expandable tags. Hours do not imply a live open/closed status; absent phone/hours are explicitly identified. Nearby alternatives let users choose among overlapping or closely spaced places. Addresses and category labels, OSM source links and the provider's snapshot date are retained. External tags render as text; contact links accept only validated HTTP(S), telephone or email targets.

**Fallback service and usage limits:** If Overpass has not supplied a usable result after 800 ms (or fails sooner), [Nominatim](https://nominatim.org/release-docs/latest/api/Lookup/) supplies exact element lookups or a nearby POI reverse lookup with extra tags. Those results are displayed as soon as they arrive while Overpass can finish the full-tag lookup. A healthy Overpass response within the head start avoids the fallback request. Late full data enriches the shop already being read and adds other nearby choices without switching the selection or closing expanded details. If no place is found, an additional reverse lookup using Nominatim’s address layer displays the closest mapped address in the drawer, with its OSM source link. This lookup waits at least 1.1 seconds after the POI request, can complete while Overpass finishes, and is skipped or cancelled when a shop is available. It preserves the original pin and share-link coordinates. Addresses (including missing coverage) use the same ten-minute session cache; an unavailable address service offers a manual retry instead of an invented address. Its [public usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires user-triggered moderate use, caching, attribution, an identifying Referer and an aggregate maximum of one request per second across the application. There is no autocomplete, systematic area scanning, polling or debugging-details scraping. This personal site spaces requests by at least one second per browser and caches results; aggregate traffic must remain within the public service limit. Move to a hosted provider or a proxy with application-wide limits if use grows. Both service URLs can be switched through the configuration file.

Place queries run only for explicit map double-clicks/double-taps, selected search results, clicked pin markers or opened OSM place links. Single clicks and taps leave the selected pin unchanged. Double-click/double-tap zoom is disabled to reserve that gesture for pin placement; dragging, pinch zoom and the zoom controls remain available. Panning alone and My location do not query place details. Click coordinates or an OSM element ID are sent directly to the provider with no account, key or Gregle backend. Requests are cancellable, separated by at least one second and bounded to an 18-second total client timeout, a 6.5-second Overpass attempt and a 12-second server timeout; the cache retains up to 40 validated responses for ten minutes and reuses exact shop records without another request. A bounded copy (up to 200 KB) in sessionStorage survives reloads in the same tab; it expires with the browsing session and is separate from saved map links. An unavailable Overpass endpoint is skipped for five minutes before a later user action may try it again, with that provider cooldown also retained across reloads in the same tab. If both providers fail, requests pause for at least 30 seconds (honouring a longer Retry-After) and offer a manual retry while preserving the pin. There is no automatic polling. Refer to the provider's [usage and privacy policy](https://overpass.private.coffee/); its public data can lag the main OSM database. Tests cover element identity, geometry selection, contact-link validation, cancellation, first-result latency, late enrichment, reload cache validation, failure cooldowns and Retry-After behaviour.

Run `node --test tests/maps.test.cjs tests/maps-places.test.cjs tests/site-menu.test.cjs` for coordinate/link validation, search normalization, place tags, provider configuration and launcher consistency. Browser checks also cover real map tiles and search, mobile layout, pin sharing, location permission outcomes, request races and failure fallbacks.

### Vessel tracker

The independent **Vessel tracker** overlay plots recent AIS position reports as teal ship markers over Gregle's street/topographic map. Direction follows a reported heading or course; a dot means direction is unavailable. Popups show name, MMSI, type, flag, speed in knots, course, destination and observation time. Missing values remain unavailable. Coverage is incomplete; an empty view does not establish that no vessels are present. This is informational, not a navigation aid.

The source is the free, key-free [Open Waters AIS API](https://openwaters.io/api/ais/), through the dedicated `gregle-vessels` Cloudflare Worker in `workers/vessels/`. One GeoJSON query requests only the buffered visible area, within the anonymous 100-square-degree cap, with `kind=vessel`, `max_age=600` and `max_age_moving=600`. Dateline-crossing boxes become two ORed boxes in the same request, with the same total area limit. This replaces PocketWorld's world-wide paginated snapshots and their intermittent HTTP 409/503 failures. There is no paging through unrelated global traffic.

Only position-carrying messages qualify: Open Waters' `seen` also changes on static messages, so static-only latest messages cannot reset the age of an old position. Reports must have a valid MMSI, coordinates, and an explicit timestamp within ten minutes. Results deduplicate MMSIs using the newest observation. Up to 5,000 regional records are returned and up to 1,500 markers render in view, with a limit notice where needed. Returned source attribution is preserved as inert text in the layer's source details, alongside links to Open Waters, AISHub, AISStream, Kystverket and Fintraffic. Underlying data retains each source's terms; Open Waters documents them on its [AIS overview](https://openwaters.io/ais/).

The relay validates its Gregle origins, GET/OPTIONS method, fixed upstream URL and bounded area. Upstream bodies are bounded to 3 MB and malformed data fails explicitly. One retry is allowed for transient errors, with an 8-second first attempt and 12-second retry; provider Retry-After and shared cooldowns are honoured. Validated regional results cache for 45 seconds, with a separate five-minute last-good copy. A recent backup returns immediately while Cloudflare refreshes in the background, using a 25-second cache lease to reduce duplicate refreshes. A failed refresh never extends the backup's saved time or changes any position's observation timestamp. Expired backups are never served. There is no scheduled ingestion or polling while the map is closed.

The browser starts refreshes at most once per minute while enabled and visible, reuses buffered coverage and marker identities, and retains unexpired reports during refreshes, brief failures, and visibility changes. Updates are labelled as delayed when appropriate, and reports older than ten minutes disappear even during outages. Disabling or hiding the layer cancels browser requests; late responses cannot restore it. The independent `vessels` preference remains saved and shared, and pauses behind either embedded map. Focused checks: `node --test tests/maps-vessels.test.cjs tests/maps-vessels-worker.test.cjs tests/maps.test.cjs`.

### Map layers

The Layers button switches between the OpenStreetMap street base and [OpenTopoMap](https://wiki.opentopomap.org/about) contours/terrain, with independent Maritime, Live aircraft, Aviation, DriveBC, Google Traffic (experimental) and TomTom Traffic overlays. OpenTopoMap tiles are requested through native zoom 17 and enlarged at higher map zooms. [OpenSeaMap](https://wiki.openseamap.org/wiki/OpenSeaMap-dev:Server) supplies transparent seamarks (buoys, lights and harbour marks), with native zoom 18. Depth charts are not included. Each active provider is attributed; disabled layers do not request data. Layer preferences are saved in `gregle-maps-layers` and included in map-link fragments as `base` and `overlays`, while older map links remain valid.

**Live aircraft** adds heading-oriented purple markers using [PocketWorld’s documented regional flight API](https://pocketworld.org/api). Its observations come from OpenSky Network, adsb.fi and ADSB.lol; map credits and the expandable data-source section retain those names and links, including the OpenSky paper citation. This personal, non-commercial site uses those providers under their respective terms. Enable aircraft independently of the OpenAIP aviation charts. Click a plane for callsign, registration, type, reported altitude in feet, ground speed in knots, track, vertical speed, squawk, original provider and position time (24-hour local time), where available. Coverage and delays vary; reports older than two minutes disappear rather than being advanced to an invented position.

The browser requests only its visible area (maximum 250 nautical miles), at most once every 15 seconds while enabled and visible, with panning debounce, one in-flight request, aborts on disable/hide, and Retry-After handling. Network-failure backoff starts at 30 seconds and is capped at one minute so recovery does not leave the layer empty for five minutes. Refresh aircraft skips client backoff while still respecting the normal request cadence and the server’s Retry-After. Zoom out beyond that coverage and requests pause with a zoom-in prompt. Aircraft popups update without repeatedly moving the map. Native overlays pause in PlugShare and ADS-B Exchange modes. Selection is saved in `gregle-maps-layers` and shared as `overlays=aircraft`.

`workers/aircraft/worker.mjs` is the narrowly scoped Cloudflare relay at `gregle-aircraft.square-rain-5ded.workers.dev/aircraft`. It accepts bounded coordinates from Gregle origins and normally calls PocketWorld’s documented `wire=1&bbox=...` API, splitting dateline areas. If that source times out, fails or is cooling down, the relay falls back to ADSB.lol’s regional `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}` endpoint. Primary requests time out after 3.5 seconds and fallback requests after 4.5 seconds, within the browser’s 12-second deadline. Both sources forward no user credentials, cap response size, preserve source times and position ages, cache areas for 15 seconds, and maintain separate bounded cooldowns including Retry-After. PocketWorld’s metre/metre-per-second fields are converted to aviation units; ADSB.lol already supplies feet/knots and retains its provider attribution. Stale fallback snapshots, old positions and ground vehicles are rejected. Cache failures do not discard a valid fallback response. The fallback is best effort: hosted requests can also be throttled, and neither provider is guaranteed to be available. No API key is required. The site remains on GitHub Pages; deploy Worker source/config changes separately from Pages using `workers/aircraft/wrangler.jsonc`. Tests cover feed validation, units, dateline bounds, stale positions, polling lifecycle, panning races, rate limits and relay origin/endpoint restrictions.

**Aircraft past paths** appear when hovering over a plane (after a 150 ms dwell) or opening its popup. Hover previews do not open popups or pan the map. Click to keep a plane selected; hovering over another temporarily previews that plane, and moving away restores the selected path. Closing the popup releases the selection. Lines use the same altitude colours as the aircraft markers. Only telemetry explicitly marked non-synthetic and reliable by PocketWorld is accepted; estimated origin/destination routes are discarded. When earlier history is unavailable, the selected plane’s trail builds from the live positions received while the layer is enabled, with an explicit popup message. Paths cover up to the last two hours where source history is available, retain at most 2,000 points, leave gaps longer than three minutes and implausible jumps open, and wrap at the date line without drawing across the world. The map does not zoom or pan to fit a path. History is requested only on hover or selection, cached for 30 seconds (up to 20 aircraft), and extended locally as the regular live feed updates. Browser memory retains up to 300 recently observed aircraft; disabling the layer clears all history. Leaving a hover without a pinned selection, switching, hiding or disabling cancels the path request, and late responses cannot restore an old path. Expired aircraft lose their path along with their marker. The aircraft Worker relays only the fixed `/api/flights/track/{icao24}` endpoint through `/aircraft/track/{icao24}`, bounds the payload, removes route metadata and synthetic points, and shares history rate-limit cooldowns separately from the live-position feed.

**Aviation** displays OpenAIP flight charts with airspace boundaries, airports and navigation aids. Enable Aviation in Layers; no visitor API key is required. `workers/aviation/worker.mjs` serves the combined PNG charts through `https://gregle-aviation.square-rain-5ded.workers.dev/tiles/{z}/{x}/{y}.png`. The OpenAIP key is stored only as the Cloudflare Worker secret `OPENAIP_API_KEY` and sent to the fixed official HTTPS endpoint in a request header. It is never returned to visitors, committed to the repository or included in URLs. The previous browser-stored OpenAIP key is removed on page initialization. Deploy source/config changes with `workers/aviation/wrangler.jsonc`; set or rotate the secret separately with `wrangler secret put OPENAIP_API_KEY` from that directory.

The relay accepts only GET/OPTIONS from Gregle origins, XYZ coordinates at zooms 2–14, and no query parameters or arbitrary upstream URLs. Origin checks prevent browser hotlinking; they are not authentication for non-browser clients. Valid PNGs and empty HTTP 204 tiles are cached at the edge and in the browser for one hour. Tile bodies are bounded to 2 MiB with a ten-second upstream timeout, content-type and PNG-signature checks, no redirects, and no forwarding of visitor cookies or credentials. Uncached upstream requests are limited to 120 per minute per Cloudflare location using the `TILE_LIMITER` binding; the shared limit may temporarily pause busy locations. Source failures share a per-location cooldown, honour Retry-After up to 24 hours and return sanitized errors. Cached charts remain usable during cooldowns. The relay never logs upstream exception text, bodies or keys.

The overlay uses XYZ rows (north to south), zooms 2–14 natively and overzooms closer views. Chart opacity defaults to 85%, adjusts from 20–100% without downloading again and is saved in the browser. “Open this view on OpenAIP” follows the map centre and zoom; the provider blocks third-party framing, so its full map opens in a new tab. Only enabled/visible layers request tiles, at most three concurrently and spaced 200 ms apart. Disabling or hiding the page cancels work, and rate-limit failures require manual retry after the cooldown. Selection is saved and shared as `overlays=aviation`, independently of live aircraft. [OpenAIP attribution](https://www.openaip.net/) and [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) remain visible. Coverage varies; this is for reference, not navigation. Tests cover tile addressing, lifecycle, no-browser-key migration, cache reuse, origin and path restrictions, source validation, limits and sanitized failures. Live authenticated charts were visually checked around Victoria and the San Juan Islands against the reference map.

**DriveBC** uses the public, key-free [Open511 API](https://api.open511.gov.bc.ca/help). A province-wide ACTIVE-event snapshot is fetched at most once every three minutes during normal visible use. Panning and zooming filter that snapshot locally, preserve unchanged marker objects and never start or cancel a provider request while the feed is fresh. This avoids the HTTP 429 errors caused by repeated viewport requests. The layer renders reported events as bright markers and outlined road lines, with plain-text descriptions, update times and a DriveBC link in each popup. ACTIVE events can include planned work. The Future events toggle is off by default and includes reports whose scheduled start is later than now. Unknown schedules remain visible. Future reports use purple clock markers and dashed road lines; popups show their scheduled start in Pacific time using 24-hour notation. Filtering reuses the same cached snapshot without new requests. DriveBC interval timestamps without an explicit offset are interpreted as UTC, matching the feed; event starts use the earliest valid interval. This is a road-event feed rather than live congestion. Pagination supports up to four 500-record pages, spaces page requests, labels partial coverage and resumes the missing page after a failed request. Rate limits honour Retry-After when exposed and otherwise use a two-minute increasing cooldown; other failures retry after at least one minute. Pans and layer toggles do not bypass the cooldown. During failures, cached reports remain visible with an explicit cached timestamp for up to fifteen minutes, then are removed. Moving outside BC clears the displayed events and stops requests; returning to BC reuses fresh cached coverage. Hiding/leaving the page or disabling the layer cancels pending work, and late responses cannot restore removed reports. DriveBC information is attributed under the [Open Government Licence – BC](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc). Regression tests cover panning during loads, cache reuse, stable markers, province changes, pagination, rate-limit recovery and cache expiry.

**DriveBC webcams** is a separate, indented sublayer beneath DriveBC, usable with or without road reports. It reads the province's [official HighwayCams CSV catalogue](https://catalogue.data.gov.bc.ca/dataset/bc-highwaycams), which permits cross-origin requests and uses the Open Government Licence–BC. No backend or API key is required. Camera locations are fetched only while the enabled map is visible in BC, cached in memory for one hour, and filtered locally when panning. Failed refreshes use bounded exponential backoff, honour Retry-After and retain cached locations for at most 24 hours. Hiding/leaving the page or disabling the layer aborts requests; late responses cannot restore disabled cameras.

Each location has one purple camera marker. Its popup loads only the selected DriveBC still image, with a selector for multiple camera directions, the caption and supplied credit, a camera-specific DriveBC link and a refresh button with a one-minute cooldown. Images use a one-minute cache bucket, have a 15-second timeout, and do not poll or preload. Closing a popup, removing its marker, hiding the page or disabling the layer cancels its preview. Capture times are printed in the source images; updates vary by camera and these are not live video. Catalogue URLs are validated against each numeric camera ID and the official HTTPS DriveBC image/detail paths; external strings render as text. The `webcams` overlay preference is saved in `gregle-maps-layers` and included in shared map links independently of road events.

**EV charging** is an opt-in Open Charge Map overlay. `evProvider: "openchargemap"` and `evURL` select the `gregle-ev` Cloudflare Worker. The Worker sends the `OCM_API_KEY` secret as the case-sensitive `X-API-Key` header to the fixed `https://api.openchargemap.io/v3/poi/` endpoint and identifies Gregle with a custom User-Agent. The key is never included in browser assets, URLs, responses, local storage or source control.

The integration follows [OCM's API/fair-use conditions](https://www.openchargemap.org/develop/api) and [data terms](https://www.openchargemap.org/about/terms). Requests always use `opendata=true`, `compact=false`, `verbose=false` and `includecomments=false`; only records with an explicit open-data flag, provider name and complete licence statement are redistributed. Provider names, source links and licence text remain attached to every station, including cached records. Map attribution names Open Charge Map; popups and the EV sources/licences disclosure display the original Data Provider and licence, with links for recognised CC/ODbL licences. Data is labelled as formatted for Gregle, and station details link back to OCM for corrections. Do not assume all records use CC BY 4.0: third-party sources retain their own terms.

The browser loads stations only while the layer is enabled, visible and zoomed to at least 12. Queries are debounced, bounded and at least ten seconds apart, with one browser request in flight. Shared server caching reuses snapped areas for 24 hours; original source fetch times are retained in browser caches, with a seven-day maximum stale fallback during interruptions. An outdated shared entry can trigger one leased background refresh, while provider cooldowns and Retry-After suppress further upstream queries. The Worker limits uncached requests per client to 30 per minute, caps each upstream response at 4 MB, uses a 20-second upstream timeout and returns at most 750 stations. The browser saves at most four areas within 500,000 characters and does no periodic scanning or polling. High-volume use must move to an OCM data mirror or imported dataset rather than increasing calls to the public API.

**Tesla Superchargers** remains an independent sub-toggle with red lightning markers. Complete Open Charge Map results serve both all-station and Tesla-only selections without a second query. Explicit Tesla Supercharger names/operator metadata qualify; Tesla Destination sites and third-party NACS connectors do not. Existing shared preferences and the default Tesla highlighting are preserved. Popups show reported connector types, power, counts, charging cost, access, operator, recorded status and verification date when supplied. Recorded status is not live availability; users should confirm access, costs and availability with the operator. PlugShare data is not imported.

**OpenStreetMap data** is a source toggle inside the collapsible EV charging options. Off selects Open Charge Map; on selects OpenStreetMap through the same Cloudflare relay (`evOSMURL`, with `source=osm`). The choice is remembered and copied map links include `evdata=osm` when OSM is selected. Switching sources cancels pending requests, clears old markers and changes map attribution, the source label and licence disclosure. Provider caches and retry timers remain separate; switching back can reuse earlier coverage. OSM data is credited to OpenStreetMap contributors under ODbL and station popups link to the original OSM object. OSM queries use the publicly listed VK Maps Overpass mirror, with Private.coffee as an alternative. They are bounded, cached for a day with a seven-day stale fallback, throttled, and never receive the OCM API key. OSM access/connector details and Tesla filtering are preserved. Public Overpass instances are intended for modest usage; move to a dedicated instance if demand grows, following [their fair-use guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

The `workers/ev/wrangler.jsonc` configuration contains only non-secret settings. Keep `OCM_API_KEY` as a Cloudflare Worker secret, and preserve it when redeploying. The native rate-limit binding is `OCM_RATE_LIMIT`. Open Charge Map remains the default. The OSM source module is `workers/ev/osm.mjs`; the rate-limit binding protects both source routes. Changing the endpoint invalidates old provider-specific browser caches.

A **PlugShare** link beside OpenStreetMap opens PlugShare's website at the current Gregle map centre with the visible latitude/longitude span. Panning and zooming update it; a selected pin does not replace the observed view. Station popups also offer a PlugShare area link. This uses PlugShare's [documented region permalink parameters](https://developer.plugshare.com/permalink.html), targeting its website directly.

**PlugShare** is also a Base map option using the provider's [official full-map embed](https://developer.plugshare.com/embed), loaded only when selected. The iframe opens at the Gregle view's centre and spans, keeps PlugShare's own station search, branding and controls, and supports its geolocation control. No API key or Gregle backend is needed. Gregle's map, place search/details and overlays pause while this separate map is open; saved overlay selections and the original Gregle view/pin are retained and restored on return to Street or Topographic. The Change map button remains outside the iframe so it is always possible to return. Open full map offers a direct website fallback. Leaving the embed removes its iframe; provider load errors/long loads have a readable fallback message.

**ADS-B Exchange** is another Base map option beside PlugShare, using `https://globe.adsbexchange.com/` in an iframe. It opens at the current Gregle centre and zoom through the provider’s [documented map URL parameters](https://support.adsbexchange.com/hc/en-us/articles/44653064937741-Map-Help). Only the sidebar is initially collapsed; the provider’s map controls, branding and aircraft interaction remain available. There is no data scraping, proxy, API key or imported aircraft feed for this mode. The frame contacts ADS-B Exchange only when this map is selected. Its internal movements are independent of Gregle’s original view and shared link. The common `assets/maps-embed.js` controller keeps one provider frame at a time, removes it on switching back, protects frame pinches from zooming the whole page, and retains the frame through ordinary container resizing. Both embeds offer Change map and Open full map outside the frame; native overlays, place lookups and navigation pause, with their preferences and saved pin restored on returning to Street or Topographic. The map choices use a compact two-column grid on desktop and in the mobile drawer.

The base choice is saved in `gregle-maps-layers` and shared as `base=plugshare` or `base=adsbexchange`. PlugShare's internal map movements are independent: they cannot update Gregle's share URL or original view through the documented embed API, so Gregle's Copy map link tool is hidden in this mode. Resizing the frame does not reset its internal view. The embed loads PlugShare's own service directly; Gregle neither extracts nor redistributes its station data. Gregle's separate EV charging overlay uses Open Charge Map; PlugShare's [station API requires a commercial licence](https://company.plugshare.com/api.html).

**DriveBC ferries** is an independent Ferries sub-toggle beneath DriveBC. It shows inland ferry crossings and coastal terminals from DriveBC's public `https://www.drivebc.ca/api/ferries/` and `https://www.drivebc.ca/api/ferries/coastal/` feeds. Coastal popups list the supplied routes and official BC Ferries schedule links. Inland popups show the route description, operator/contact phone, vessels, crossing time, capacities and service hours where supplied. Schedule HTML becomes plain text and explicit AM/PM times become 24-hour notation. These are published timetable details and terminal/crossing locations; current sailing information remains available through the official links.

`scripts/update_drivebc_ferries.py` publishes `data/drivebc-ferries.json` through the existing DriveBC refresh workflow about every 15 minutes. Both source feeds must validate before replacing the previous ferry snapshot. The workflow refreshes signs and ferries independently, publishes whichever updates succeed, and reports any failed source. There is no extra runtime backend or API key. The browser requests ferry data only when this layer is enabled, visible and viewing BC; it refreshes its in-memory snapshot at most every five minutes, filters locally while panning, preserves marker identity, honours Retry-After and cancels hidden/disabled requests with late-response protection. Cached locations last at most 24 hours during outages. Snapshots older than 24 hours retain official links and locations but suppress old service hours/restrictions. Links accept only official HTTPS provider hosts, and remote text never becomes executable HTML. The `ferries` overlay is saved in browser layer preferences and copied map links independently of road events, signs and webcams.

**DriveBC signs** adds independent Variable speed signs and Message signs sublayers beneath DriveBC. Both are opt-in and their `speed`/`messages` overlay choices are saved and shared with the `future` event filter. The [official variable speed map](https://twm.th.gov.bc.ca/?c=vsls) supplies its public `https://vsls.drivebc.ca/heartbeat/geojson` feed directly to the browser. Speed signs refresh at most every two minutes during visible use in BC. Markers show the reported speed; popups show the regular maximum, direction, operational status, last change and feed-check times. A speed is unavailable if its receipt is more than 15 minutes old, the segment is disabled or the sign is not operational. Receipt age is separate from the last-change time, since an unchanged sign may still be reporting normally.

DriveBC's public `https://www.drivebc.ca/api/dms/` endpoint does not permit cross-origin browser reads. `scripts/update_drivebc_signs.py` publishes a validated, compact same-origin `data/drivebc-signs.json` snapshot instead. `.github/workflows/drivebc-signs.yml` runs approximately every 15 minutes and on updater changes, keeps the previous snapshot if fetching/validation fails, and requests a Pages rebuild after committing updated data. No running backend, account or API key is introduced. Message popups show all reported pages as inert text, sign status, last-change time and snapshot time. NTCIP layout tokens are removed. Expired/offline messages and snapshots or provider cache receipts older than 45 minutes cannot be presented as current messages; locations remain available with an unavailable-reading notice. GitHub scheduling and deployment can add delay, so the UI labels these as published snapshots rather than live messages.

Both sign feeds cache province-wide responses and filter locally when panning, preserve existing marker objects on refresh, honour Retry-After with exponential backoff, and stop requests when disabled, hidden or outside BC. Late responses cannot restore a disabled layer. In-memory feed responses expire after 15 minutes during outages; earlier reading deadlines clear stale values even while a retry is delayed. Tests cover schedule parsing and filtering, feed validation, stale/offline/expired readings, independent toggles, cache reuse, stable panning, backoff and cancellation. The automated snapshot updater has offline validation and failure-preservation tests.

**Google Traffic (experimental)** is an opt-in, transparent image-tile overlay using the unofficial source described in [this OsmAnd guide](https://www.anselms.net/blog/osmand+-and-traffic-data.html). It runs directly in the browser without a key or backend and does not provide traffic-aware routing. The layer has Google attribution, a browser-saved opacity slider (75% initially), and a five-minute refresh while visible. Disabling the layer or hiding/leaving the page removes its tiles and stops refreshes; showing the page resumes only if the source has not failed. Failed or timed-out loads clear the overlay, display an unavailable message and pause automatic retries. A manual retry is available; normal manual refreshes have a five-minute cooldown. Requests share a five-minute cache bucket, and no tiles are prefetched or saved for offline use. Layer selection is saved in `gregle-maps-layers` and shared as `overlays=google`; opacity is local to the browser in `gregle-maps-google-opacity`. This is not Google's supported TrafficLayer API: the endpoint can change or stop working, and [Google Maps Platform terms](https://cloud.google.com/maps-platform/terms) restrict use with non-Google maps. Google Traffic is off by default.

**TomTom Traffic** uses the current [Orbis v2 raster flow service](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-flow/raster-flow-tiles). A user connects their own Traffic-enabled key through Layers; the key stays in `gregle-maps-tomtom-key` in that browser and is sent directly to TomTom in the `TomTom-Api-Key` header. No key is committed, sent to Gregle, embedded in tile URLs, or included in copied map links. Forget key removes it and turns traffic off. Use a key restricted to `gregle.uk` and the Traffic API, as described in [TomTom's key guidance](https://docs.tomtom.com/platform/documentation/api-best-practices/api-key-management-best-practices). TomTom offers a free usage allowance; current limits and sign-up are linked from the key form to its [pricing page](https://docs.tomtom.com/pricing).

TomTom traffic loads only when enabled and a key is present. It refreshes at most once per minute during normal visible use; timers pause while hidden, offscreen tile fetches are aborted, and Blob URLs are released when discarded. Failed, unauthorized or throttled layers are removed, show an explicit error, and pause automatic retries. A loaded time describes the fetched tiles, not an independently verified traffic observation time; blank roads may have no coverage. Key setup, header authentication, refresh cooldown, tab visibility, 403/429 responses and key removal were tested with simulated traffic tiles; live TomTom data requires the user's own authorized key. The real topographic, maritime and DriveBC sources were checked in the browser.

### Canadian daily fuel prices

Maps has an optional **Fuel prices** layer combining the latest Kalibrate Canada Daily Pump Price Survey with OpenStreetMap petrol-station locations. It requires no paid data subscription or new API key. The public survey is produced with Government of Canada funding and covers Canadian urban markets, including Victoria, Vancouver and other BC cities: https://charting.kalibrate.com/WPPS_Public/DPPS_Public.htm . This is the public daily report, not the monthly Statistics Canada series. It remains attributed to Kalibrate Canada; no government endorsement or open licence over Kalibrate’s site is claimed. The report’s prices and observation date are retained, with no price history collected. Methodology: https://charting.kalibrate.com/KentReports/Methodology .

`workers/ev/fuel-prices.mjs` reads the fixed public report, validates its date, table headings, numeric units and market coverage, then caches one shared response for 30 minutes. No upstream URL comes from the caller. An unavailable refresh may retain the most recent survey, explicitly marked as delayed; prices older than four calendar days are hidden. The UI always shows the survey date and states when today’s report is unavailable (including gaps between publications). It never turns a retrieval time into a new price-observation date. The publisher normally posts around 2 p.m. Eastern.

The card follows the nearest surveyed city visible on the map, or within 50 km of its centre, and names that city. City markers display the selected fuel’s average in CAD/litre. These are city survey averages, not estimates for arbitrary regions or station prices. Fuel type and layer visibility persist and are included in copied map links. An area without survey coverage is reported explicitly.

Petrol-station pins load at zoom 10 or closer through `/fuel-stations` on the existing relay. `osm.mjs` uses the same bounded Overpass fetcher with a separate `fuel-v1` cache and an `amenity=fuel` query; EV caches and the Open Charge Map credential stay separate. The price card shows station loading, counts, retry status and a zoom action. Short GET queries allow the public mirror to reuse query responses, and fuel queries have a 20-second server budget. Up to six areas of validated station locations are retained in browser storage for seven days; overlapping coverage remains visible during refreshes and provider failures. Failed requests retry automatically up to three times while the page and layer are visible, respecting Retry-After. Station popups link to their original OSM records and retain OpenStreetMap/ODbL credit. Requests are debounced, cancelled when superseded, and stop when hidden or disabled. Test fixture `tests/fixtures/canada-daily-fuel.html` preserves the public report’s table structure for parser regressions.

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

Canadian alerts refresh every five minutes while visible and immediately on returning to the page or changing location. Expired/cancelled alerts are removed, an empty feed hides the section, and non-Canadian locations do not request Canadian alerts. Failed, malformed or more-than-two-hour-old Canadian feeds hide unconfirmed cards and show a small official-source fallback beside the weather status; they are never reported as an all-clear. Feed text is rendered as text, and bulletin links are restricted to official HTTPS weather hosts. See [ECCC's colour-coded alert guidance](https://www.canada.ca/en/services/environment/weather/severeweather/weather-alerts/colour-coded-alerts.html). Tests cover colours, expiry, cancellation, failures, location races and refresh behaviour.

For UK locations (`GB`, including Northern Ireland), Met Office Weather Warnings use the same cards with the official yellow, amber and red levels. The browser queries the Met Office's [public ArcGIS live warning layer](https://www.arcgis.com/home/item.html?id=3f33c180f82a460ebc6f241d68841cd7), linked from its [official data channels page](https://www.metoffice.gov.uk/services/data/external-data-channels), using an exact WGS84 point/polygon intersection. Selected coordinates are sent directly to Esri ArcGIS; no API key, proxy, national-warning guess or region-name matching is involved. Issued warnings for future weather remain visible until their validity ends; cards show issue time, validity dates in the selected time zone, unchanged headlines, expandable original warning text and an official Met Office warning link. Amber shares the Canadian orange card palette while retaining the Met Office's amber label. UK warnings refresh every two minutes while visible and on location/visibility changes. Removed, expired, duplicate, malformed, incomplete and failed results are handled explicitly, and late responses cannot restore a previous location's warnings. Unsupported countries make no warning requests. Source attribution, copyright and the required delay statement appear under About UK warnings, following the [NSWWS open licence](https://www.metoffice.gov.uk/api/assets/file/NSWWSOpenLicencepdf). The public feed is a beta service; failure shows a direct Met Office fallback instead of an all-clear.

The satellite updater stops all provider requests on an error. Temporary HTTP 500/502/503/504 or network failures leave the existing file and its timestamps untouched and log a workflow warning only when all five cached orbits validate and both retrieval and orbit ages are within 48 hours. Older or incomplete data, permanent HTTP errors, redirects and malformed responses still fail the workflow. The next scheduled run attempts the refresh again; there is no immediate retry loop.

`weather.html` requests browser location access on opening (HTTPS or localhost required). While access is pending or unavailable, it shows the saved Vancouver, Victoria or Chilliwack shortcut, defaulting to Vancouver. Visitors can search for a city worldwide or retry **My location**. A manual choice cancels pending location/search work so late responses cannot change the selected city. Weather and earthquake pages have reciprocal, labelled icon shortcuts.

With permission, coordinates are rounded to two decimal places and sent to BigDataCloud's browser reverse-geocoding endpoint to identify the city/country, then to the forecast provider. No detected coordinates or searched cities are saved; only the existing Canadian shortcut preference is stored. The page explains these services beside its source attribution. If city lookup fails, a global forecast still works at the approximate coordinates.

Canadian locations use the nearest Environment and Climate Change Canada city forecast within 150 km, clearly naming that forecast city and its distance. The public city directory is fetched once per page visit. The Environment Canada station selector appears when that location has multiple matching feeds in the directory. It matches both forecast-location and observation-station names, ignoring accents and punctuation, within the same province and 75 km of the original forecast location. This includes Victoria Gonzales under Gonzales Point, West Vancouver, and Montréal stations whose forecast locations have different names. Additional towns sharing an already represented observation are omitted. Selecting an alternative retains the complete city list and persists through manual refresh; choosing another city resets it. Victoria continues to default to Harbour. A single-feed location, international forecast or Open-Meteo fallback hides the selector. Existing BC shortcuts retain their direct endpoints. Open-Meteo provides seven local-calendar-day forecasts elsewhere and when the Canadian feed is unavailable or has no nearby station. Its current conditions are labelled as modelled estimates; high/low semantics and timezone are shown for each provider. Requests have bounded timeouts, cancellation, empty/error states and source links. City search uses Open-Meteo/GeoNames. No backend, API key or proxy is required.

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

The Match centre **TV** view adds broadcast channels to upcoming fixtures for
the UK, Canada, Norway, Sweden and Germany. Its region selector defaults to all
regions and remembers a selected region on the device. Existing team, date and
search filters also apply. It uses the same match-specific listings and
six-hour freshness limit as the live guide; unconfirmed or unavailable listings
are labelled explicitly and link to the regional guides. The TV snapshot loads
when the TV view is opened, refreshes every five minutes while that view is
visible, and retries with Refresh scores. Valid recent listings survive a
refresh failure, with a warning; expired channel names are hidden.

Run `node --test tests/sports*.test.cjs` and `python3 -m unittest discover -s tests -p 'test_sports_tv.py'` for the sports checks.



## Maps directions and live navigation

The Directions map button opens a route planner with **Driving** and **Walking** modes. Search and explicitly choose both endpoints, use **My location** for the start, or select a map place / dropped pin and choose **Start here** or **Directions here**. Swap endpoints and clear the journey from the panel. Search uses Photon with map-centre bias and no automatic lookup while typing. **Show route** sends the endpoints to OSRM's driving server or FOSSGIS's dedicated pedestrian server (`routing.openstreetmap.de/routed-foot/route/v1/foot`). Walking uses pedestrian access rules, not a relabelled driving route. Requests time out after 15 seconds, are spaced by at least 1.1 seconds, and are cancelled or ignored when superseded. Routes and location history are not persisted.

A purple route with A/B endpoints, estimated distance and duration, and expandable steps appears on the map; walking paths are dotted. **Start navigation** requests a fresh high-accuracy GPS watch, shows a moving location marker, next turn and distance, estimated arrival and remaining journey, and follows your position. Panning pauses following; **Recenter** resumes it. Optional **Voice on** uses the browser's speech synthesis when available. Sustained off-route fixes trigger recalculation after three seconds, at most once every 20 seconds; a starting location away from the preview route is recalculated immediately. Weak or stale GPS pauses turn guidance. Permission errors explain recovery. Stop, arrival and page exit release the GPS watch; stopping also aborts pending recalculation and speech. Navigation requires HTTPS (or localhost), location permission and connectivity. Location can pause when the browser is in the background. Estimates exclude live traffic and ferry waits; external Google/Apple links preserve the selected mode. Public routing services have no availability guarantee and require light use: https://routing.openstreetmap.de/about.html. No new key or server is required.

**Car layout** enlarges touch controls, fields and navigation text, and remembers only that display preference. It activates automatically for a Tesla user agent and can be toggled on other devices. Available viewport width controls the layout, including Tesla's full and half-screen browser: a side panel above 700 pixels, the existing resizable drawer at 700 pixels and below, and a separate navigation card that remains visible outside the drawer. ResizeObserver notifies Leaflet when its container changes size. Real Tesla hardware has not been tested; GPS and speech availability depend on the vehicle browser.

Run `node --test tests/maps-navigation*.test.cjs` for mode-specific routing, progress and arrival, handoff URLs, request cancellation, GPS lifecycle, weak and stale fixes, rerouting and cleanup checks.
