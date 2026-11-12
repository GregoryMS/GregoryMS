# App subdomain recovery

This Worker currently owns `*.gregle.uk/*`. Cloud, Docs and www retain their
existing more-specific bypass routes. The temporary apex redirect rules are
disabled, but retained for rollback.

On 2026-11-03, the original `gregle-site-router` returned error 1101 even after
a clean upload. Calling it through an internal service binding revealed the
exception `This script has been killed.` An isolated copy of the router code
worked normally, including its rate-limit bindings. Cloudflare's dashboard
showed no blocked-content notice. The reason for the killed state is unknown;
redeploying did not clear it.

The recovery Worker serves existing GitHub Pages content using the original
router. Google Maps and TomTom credentials have now been configured as secrets
on the recovery Worker, so it serves those APIs directly with the original
validation and rate limits. Secret values must never be committed to the repo.
`GOOGLE_MAPS_BROWSER_KEY` is the browser-restricted Google key; `TOMTOM_API_KEY`
stays server-side. Deployments must preserve both secret bindings.

If a provider key is missing, configuration reports disabled and other API
requests return a controlled 503. There is no dependency on the original Worker.

The killed `gregle-site-router` and `gregle-calculator` Workers were retired on
2026-11-03 after their replacements were verified. Their deployment configs were
removed to prevent recreating them or reclaiming the recovery router's routes.
The shared router code remains in `workers/site-router/`; deploy only this
recovery Worker's configuration. The unused calculator proxy source remains
in `workers/calculator/` for reference. Automatic TI-89 setup now
downloads directly from the public Gregle Cloud share, with CORS enabled only
for that file; it does not depend on the legacy proxy.

Verification: all 21 app subdomain roots, the apex, and four key assets returned
HTTP 200 without redirecting to the apex. Google Places loaded in a browser;
both provider configurations, a TomTom traffic PNG, and a TomTom route returned
HTTP 200. Run
`node --test tests/site-router-recovery.test.cjs tests/site-router.test.cjs tests/maps-tomtom-worker.test.cjs`.

Maps place/address search uses overpass.ch through `/api/maps/search`. Configure
`OVERPASS_GEOCODING_API_KEY` as a Worker secret and preserve it on deployments,
along with the Google and TomTom secrets. Search sends it only as an `X-API-Key`
header to `api.overpass.ch`; public configuration and source contain no value.
Search, Directions suggestions and saved-place address searches never call
TomTom. Missing search credentials return 503; provider failures return 502/429
without using navigation quota. Run `node --test tests/maps-search-worker.test.cjs`.
