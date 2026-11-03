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

If a provider key is missing, the Worker can still delegate to the original
Worker through `MAPS_API`. If that call throws, configuration reports disabled
and other API requests return a controlled 503. The original Worker is retained
for diagnosis; restoring Maps no longer depends on clearing its killed state.

Do not deploy `workers/site-router/wrangler.jsonc` or
`workers/calculator/wrangler.jsonc` with their routes until their Workers are
healthy: those configurations would reclaim routes from this recovery Worker.
The legacy calculator ROM proxy remains unavailable. Automatic TI-89 setup now
downloads directly from the public Gregle Cloud share, with CORS enabled only
for that file; it does not depend on the legacy proxy.

Verification: all 21 app subdomain roots, the apex, and four key assets returned
HTTP 200 without redirecting to the apex. Google Places loaded in a browser;
both provider configurations, a TomTom traffic PNG, and a TomTom route returned
HTTP 200. Run
`node --test tests/site-router-recovery.test.cjs tests/site-router.test.cjs tests/maps-tomtom-worker.test.cjs`.
