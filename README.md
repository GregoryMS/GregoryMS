# Gregle

A static personal homepage and collection of browser tools, served at the domain in `CNAME`.

- `index.html`: search, recent searches, local weather and BBC headlines.
- `weather.html`: Environment Canada forecasts for Vancouver, Victoria and Chilliwack.
- `petrol.html`: fuel-cost calculator with map-based routing.
- `xkcd.html`: comic search using archive titles and context clues.
- `contact.html` and `donate.html`: contact and support pages.

`environment-canada.html` redirects older bookmarks to `weather.html`. `Victoria_weather.html` remains a standalone Victoria forecast page.

## Local preview

No build step or package installation is required. Serve this directory with any static web server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000`. Weather, headlines, autocomplete, map routing and live comic archives use external services and require network access. Browser storage and clipboard access may be restricted; the pages provide fallbacks for these cases.

## Checks

Run the regression suite with Node.js 18 or newer, without installing dependencies:

```sh
node --test tests/*.test.cjs
```

GitHub Actions runs the suite on pull requests and pushes to `main`. The tests exercise inline JavaScript with small DOM and service doubles, covering escaping, stored data, asynchronous requests, routing, forecasts, wallet copying and local icon paths. They do not verify the availability of live external services or replace browser checks.
