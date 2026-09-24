# Gregle

A static personal homepage and collection of browser tools, served at the domain in `CNAME`.

- `index.html`: search, recent searches, local weather and BBC headlines.
- `weather.html`: Environment Canada forecasts for Vancouver, Victoria and Chilliwack.
- `petrol.html`: fuel-cost calculator with map-based routing.
- `ev.html`: EV trip-cost calculator with charging losses, unit conversion and map-based routing.
- `xkcd.html`: comic search using archive titles and context clues.
- `radio.html`: live internet radio with featured BBC/NRK stations and worldwide station/country search.
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
