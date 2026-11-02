# Private TomTom connection

The existing `gregle-site-router` Worker serves a private default connection on
`maps.gregle.uk`. Store the default credential only as the Worker secret
`TOMTOM_API_KEY`. It is not a Wrangler variable, source constant, browser key,
or value returned by an endpoint. Keep the existing `GOOGLE_MAPS_BROWSER_KEY`
secret when deploying.

## Browser behavior

Both traffic tiles and traffic-aware navigation default off. Explicit visitor
preferences are remembered. Startup checks `/api/maps/tomtom-config`, which
returns only `{ "enabled": true }` or `{ "enabled": false }` and is not cached.
No route or tile request is made by this availability check.

Visitors can keep using the existing personal-key form. A valid personal key
stored in `gregle-maps-tomtom-key` takes precedence in that browser. Its requests
go directly to TomTom with the visitor's key in a header. If it is declined,
Gregle does not silently use the private default. Forgetting it restores the
private connection's availability and turns the tile layer off. The layer's
“API key required for traffic” text remains until a personal key is saved.

## Worker endpoints

- `GET /api/maps/tomtom-config`: availability only; supports HEAD.
- `POST /api/maps/tomtom/route`: bounded JSON with numeric `from` and `to`
  coordinates. The Worker builds one fixed traffic-aware driving request.
- `GET /api/maps/tomtom/tiles/{z}/{x}/{y}`: validated raster tile coordinates.

Endpoints accept the Maps origin only, reject cross-site browser requests,
permit only their documented methods, and never accept an arbitrary upstream
URL. The default key is added to an upstream header. Upstream redirects are not
followed. Provider headers and error bodies are not exposed; responses are
bounded and routing bodies containing an accidental credential echo are rejected.
No coordinates or credentials are logged by the handler. Route responses are
no-store; PNG responses have a private 60-second browser cache.

Native Worker rate-limit bindings allow 30 route calculations and 600 tiles per
60 seconds per IP within a Cloudflare location. These local limits do not enforce
a monthly allowance. TomTom still enforces account quotas and credit limits.
No paid TomTom plan or prepaid credit is set up by this feature.

## Deployment

Set `TOMTOM_API_KEY` through Cloudflare's secret UI or authenticated secret API.
Do not paste its value into a config, CLI argument, file, commit, or browser.
Bundle and deploy `workers/site-router/wrangler.jsonc`; retain all existing
`secret_text` bindings and include its two rate-limit bindings. Deploy the
GitHub Pages source as usual. The Worker must be deployed before the frontend.

The key must permit Orbis Traffic and Routing access. A server-held default
must permit Worker requests; browser referrer restrictions intended for personal
keys may prevent those requests. Review the key's API restrictions in TomTom.

Run `node --test tests/maps-tomtom-worker.test.cjs tests/maps-routing.test.cjs
 tests/maps-navigation*.test.cjs tests/maps-layers.test.cjs tests/site-router.test.cjs`.
Live checks covered the private route and tile endpoints using a public-landmark
journey. Test doubles cover personal-key precedence, default-off behavior,
invalid requests, response bounds, rate limits and credential redaction.
