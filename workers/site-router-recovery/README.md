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
router. It delegates Maps API requests to the original Worker, retaining the
original secrets there. If that call throws, provider configuration reports
disabled and other API calls return a controlled 503. Basic OpenStreetMap
functionality remains available. The original API will work again through the
service binding if Cloudflare restores that Worker.

Do not deploy `workers/site-router/wrangler.jsonc` or
`workers/calculator/wrangler.jsonc` with their routes until their Workers are
healthy: those configurations would reclaim routes from this recovery Worker.
The calculator's automatic TI-89 ROM proxy remains unavailable; existing saved
ROMs and local ROM import still work.

Verification: all 21 app subdomain roots, the apex, and four key assets returned
HTTP 200 without redirecting to the apex. Maps rendered in a browser. Run
`node --test tests/site-router-recovery.test.cjs tests/site-router.test.cjs tests/maps-tomtom-worker.test.cjs`.
