# Earthquake and tsunami notifications

The existing notification Worker serves `/earthquakes/public-key`, `/earthquakes/subscribe`, `/earthquakes/unsubscribe`, `/earthquakes/test` and `/earthquakes/health` for `https://earthquakes.gregle.uk`. It reuses the push signing key, with separate `quake_subscriptions` and `quake_deliveries` tables. Apply `earthquakes-schema.sql` once before deploying this extension.

The one-minute scheduled handler checks earthquakes and tsunami products every minute. Weather checks retain their original five-minute cadence. Build the upload module using `node workers/weather-notifications/build.mjs /absolute/path/worker.mjs`; retain the existing D1 binding and VAPID secret when deploying. The Wrangler configuration declares the one-minute trigger.

Earthquake events use the USGS all-day GeoJSON feed. BC/Pacific covers latitude 40–65 N and longitude 115–160 W. Regional and worldwide filters use independent minimum magnitudes from M1 to M9 in half-magnitude steps. A quake matching both filters produces one notification per device. Newly enabled devices receive earthquakes occurring after activation, avoiding a backlog of old quakes. USGS coverage of smaller events varies outside the US.

Global tsunami alerts use every NOAA product already monitored by the earthquake page. Active warnings, watches, advisories and threat bulletins are independent of magnitude settings. The parser accepts NOAA's data assignment and decimal literals such as `28.`, without evaluating the script. Unavailable or malformed products count as failures in `/earthquakes/health`; successful products remain eligible for alerts.

Each device has an opt-in master switch plus individual category controls. Settings persist locally and synchronize to the server while enabled. Turning notifications off removes the server subscription and unsubscribes the browser. Failed deliveries remain retryable, and expired push endpoints are removed. Atomic delivery claims prevent duplicate sends on overlapping checks.

`earthquakes-sw.js` displays background notifications and opens the earthquake site on click. iPhone/iPad users must first install the Home Screen app. Permission/subscription prompts start in a user tap handler. Test notifications allow users to verify delivery on their own device.

Theme placement mirrors Weather: the existing theme control moves into Settings at widths up to 700px and whenever installed mode hides the launcher. Desktop browsers keep dark mode in the app menu.

Validation: `node --test tests/earthquake-notifications.test.cjs tests/earthquakes.test.cjs tests/weather-notifications.test.cjs`. Live device delivery requires a real browser push subscription; feed checks and service readiness are exposed by `/earthquakes/health`.
