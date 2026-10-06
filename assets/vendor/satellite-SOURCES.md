# Satellite.js

Satellite.js 6.0.1 (MIT), pinned and vendored for the browser and Node tests.

- Project: https://github.com/shashwatak/satellite-js
- Distribution: https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/dist/satellite.min.js
- License: https://cdn.jsdelivr.net/npm/satellite.js@6.0.1/LICENSE.md
- Retrieved: 2026-10-05

SGP4 propagation uses CelesTrak OMM JSON records. Positions, velocities,
geodetic coordinates and observing-location elevation are calculated locally.
The 90-minute ground track is sampled at one-minute intervals and split at
the date line. It is an orbital estimate, not a telemetry feed or a guarantee
of visual visibility. The pinned UMD distribution supports this static site
without a build step.
