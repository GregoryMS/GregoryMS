# 3D navigation

Open Directions, choose the endpoints and show a driving route. Choose **3D mode**
to start live navigation in perspective, or start regular navigation and tap its
**3D mode** button. **2D mode** restores the regular map; Stop releases the GPS
watch and the WebGL map. Walking retains the regular navigation view.

The phone layout places compact guidance above the map. Larger screens use a
side card and wider touch controls, including the existing vehicle layout.
Dragging the 3D map pauses camera following; Recenter resumes it. Voice guidance
uses the existing browser speech controls. Reduced motion disables camera easing.

3D uses Mapbox Standard and Mapbox Directions, with optional traffic controlled by
the existing switch. It updates the same route used by the guidance and regular
map, including reroutes. Lane arrows come only from mapped intersections and
appear within 800 metres. Recommended lanes use Mapbox's active lanes, falling
back to valid lanes when active lanes are unavailable. Missing lane data produces
ordinary turn guidance. Speed limits retain the provider's km/h or mph unit;
current GPS speed is displayed in km/h. Unknown limits are hidden. Stale or poor
GPS hides lane and speed information until a fresh fix arrives.

## Cloudflare

`workers/mapbox/worker.mjs` serves the fixed `/config` and `/route` endpoints.
The deployed Worker is `gregle-mapbox`, using the `MAPBOX_PUBLIC_TOKEN` secret.
There are no token values in this repository. `/config` returns the **public**
Mapbox token at runtime because GL JS needs it in the browser. This keeps the
value out of GitHub; it does not make a public browser token confidential. Use
Mapbox token URL restrictions for the production Gregle origins when configuring
credentials; verify both browser map access and server-side directions after any
restriction changes.

The Worker accepts Gregle origins, validates and bounds request bodies, fixes
upstream endpoints and parameters, limits requests per IP, bounds responses and
suppresses provider error details. CORS is a browser control, not authentication.
Route data is not cached. Request coordinates are sent to Cloudflare and Mapbox;
Mapbox GL JS also contacts Mapbox for map assets and normal usage telemetry.

Deploy with the existing Wrangler configuration or Cloudflare API. Set the secret
through Cloudflare, never a tracked config file. Enable the workers.dev URL. The
frontend's endpoint is declared in `assets/maps-routing.js`.

Live navigation still requires internet and browser location permission. Actual
Tesla GPS availability and performance need checking in the car. WebGL or map
load failures restore the regular map while keeping the navigation session.

Tesla browsers use the lighter Mapbox Navigation Day/Night style in perspective,
without Standard's 3D objects. A 32-tile cache per source, one worker, four parallel
image requests, reduced pitch, and immediate GPS camera updates limit rendering
and memory pressure. Other browsers retain Mapbox Standard. Graphics context
loss still falls back to 2D; this cannot recover a browser process killed by the
car. Real driving stability must be confirmed on the vehicle.

In car mode, directions, location results, and panel changes no longer focus text
fields automatically. Tap a field to type. Directions defaults to My location
when opened without a chosen start. Ordinary map visits request current location;
shared map views and pins retain their position, and denied GPS keeps the map usable.
