# Google Popular Times in Gregle Maps

Gregle keeps its existing OpenStreetMap/Leaflet map, Photon search, routing and
layers. A separate **Popular times** section uses the standard Google Places UI
Kit only after the visitor clicks **Show popular times** on an OSM place. The
visitor confirms a Google business match before the graph loads. This avoids
silently showing the wrong business. Google does not have data for every place.

The component uses `gmp-place-search` and full `gmp-place-details` with only name,
address and `gmp-place-popular-times`. It does not create a Google map, use the
Advanced widgets, or call Places API (New). Each initial search and selected
details request uses quota, so 300 requests is fewer than 300 complete views.
Google's attribution stays visible. No Google place data is scraped or cached.

## Google Cloud setup

1. In the billing-enabled Google Cloud project, enable **Maps JavaScript API**
   and **Places UI Kit**. The latter's service is `placewidgets.googleapis.com`.
2. In **APIs & Services → Credentials**, create a browser API key or use the
   dedicated Maps key. Set application restrictions to **Websites** and allow
   only `https://maps.gregle.uk/*`.
3. Restrict this key's APIs to **Maps JavaScript API** and **Places UI Kit**.
4. Under **Places UI Kit → Quotas & system limits**, edit **Places UI Kit - Query
   Requests per day** to **300** and verify the saved effective value. This is
   the standard Query quota, separate from Advanced Query and Autocomplete.
   Do not replace it with a per-minute quota.
5. Keep standard Query **per minute** and **per minute per user** above zero
   (the configured values are 30 and 10). A zero value blocks all requests even
   when the daily quota is 300. Advanced and Session quotas are unused here.

At 300 daily requests, a 31-day month has at most 9,300 standard requests. At the
time of implementation the standard Query SKU has 10,000 free monthly events.
Free usage is aggregated across projects linked to the billing account; other
apps, APIs, SKUs or projects can still incur charges. This is not an account-wide
zero-spend cap. Billing budgets are alerts and do not stop requests. Keep the
daily quota at Google: a client-side counter cannot enforce a global limit.

## Cloudflare setup

The existing `gregle-site-router` Worker provides
`https://maps.gregle.uk/api/maps/google-config` from a runtime secret:

1. Cloudflare → **Workers & Pages → gregle-site-router → Settings → Variables
   and Secrets → Add**.
2. Choose **Secret**, name it `GOOGLE_MAPS_BROWSER_KEY`, and paste the restricted
   browser key as its value. Deploy the change. Do not put it in Wrangler `vars`,
   source files, GitHub Actions, a URL, or a commit.
3. Deploy the Worker code from `workers/site-router/wrangler.jsonc`. Preserve
   existing secrets (`wrangler deploy --keep-vars`). GitHub Pages serves the
   front-end files as before.

CLI alternative: `npx wrangler secret put GOOGLE_MAPS_BROWSER_KEY --config
workers/site-router/wrangler.jsonc` prompts privately for the value. The key
never needs to be pasted in chat. `.dev.vars`, `.env` and Wrangler local state
are gitignored; do not create production credentials in the repository.

This is a **browser key**, so it will be visible in visitors' network requests.
The runtime endpoint keeps it out of the GitHub repo; it cannot make a Google
browser widget credential invisible to the browser. Google website and API
restrictions are the protection. The endpoint is no-store, same-origin, has no
CORS wildcard and does not log the key.

## Failure and quota handling

No Google request occurs from merely browsing or selecting places. If the key
is missing or a library/network load fails, an inline message offers a manual
retry and Google Maps link. An 18-second widget timeout also allows manual retry.
There is no background polling or automatic retry loop.

A widget `gmp-error` clears the widget and pauses further widget loads in that
browser session until the next midnight in `America/Los_Angeles`, including DST.
Only the cooldown timestamp is stored in session storage. Google's generic error
event does not reliably distinguish exhausted quota from a denied key; the UI
therefore says the daily allowance **may** have been reached. Google enforces the
actual project-wide 300/day limit across visitors. A configuration error fixed
the same day may require a new browser session or removal of
`gregle-maps-busyness-pause-v1` from session storage to test again.

An empty Google search and a business without popular-times data get distinct
messages. Changing pins discards stale events. Late OSM enrichment of the same
place preserves the widget, avoiding duplicate Google requests.

## Verification

Run `node --test tests/maps-busyness.test.cjs tests/maps-google-config.test.cjs
tests/site-router.test.cjs`. Before enabling production, check the saved Google
quota and restrictions, then confirm a well-known busy business renders the
real graph. Test no-data and exhausted/denied states without intentionally
consuming the daily allowance. Local DOM tests simulate these states; they do
not verify a live key or Google's billing configuration.

References: [Google Popular Times component](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details#popular_times),
[Places UI Kit setup](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started),
[Google API security](https://developers.google.com/maps/api-security-best-practices),
[Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing),
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
