# Weather notifications

Web Push for the Weather PWA. The shared root service worker loads `weather-sw.js` on the Weather hostname. The settings panel registers a device only after notification permission is granted, synchronises the selected city or a pinned city, and removes its server subscription when disabled.

The Cloudflare Worker checks every five minutes for sunrise/sunset advance reminders, forecast rain transitions, and Environment Canada / UK Met Office warnings, updates and withdrawals. It reuses the site's tested warning parsers and SunCalc. Native 15-minute model rain data is requested for supported North American and Central European locations; other locations and provider failures fall back to hourly forecasts. Alert text states the interval. These are weather-model forecasts, not minute-by-minute radar nowcasts.

## Deploy

Apply `schema.sql` to the D1 database without removing existing subscription data. Deploy `worker.mjs` with Wrangler, or run `node build.mjs <output-path>` for a dependency-free module upload. Preserve the `VAPID_PRIVATE` Worker secret when uploading. `VAPID_PUBLIC` is a public configuration value in `wrangler.jsonc`. Generate the corresponding ECDSA P-256 private JWK once and store it as the `VAPID_PRIVATE` secret; never commit it or rotate it casually, as subscriptions are tied to that key pair.

Enable the workers.dev endpoint and the `*/5 * * * *` cron trigger. Public endpoints: `GET /public-key`, `GET /health`. Device endpoints: `POST /subscribe`, `POST /unsubscribe`, `POST /test`; they require the full browser push subscription. Existing subscriptions are matched by endpoint and device keys. Endpoint hosts are restricted to recognised push providers. The test endpoint sends at most one test per minute per subscription. A successful `/health` reports signing readiness and the last scheduled check.

Delivery claims in D1 prevent duplicate notifications during overlapping scheduled checks. Failed sends remain retryable; expired push subscriptions are removed. Successful delivery records expire after 30 days. Device subscriptions persist while enabled, including when the PWA stays closed. Turning notifications off removes the subscription and its delivery history. Changes made while offline show a retry action and are synchronised when connectivity returns.

## Verify

`node --test tests/weather-notifications.test.cjs tests/weather-alerts.test.cjs`

The focused suite checks independent decryption and signature verification, subscription access, provider restrictions, location links, alert timing, duplicate suppression, withdrawals, expired subscriptions, iOS permission gestures and selected-city updates. On an iPhone, install Weather using Add to Home Screen, open the installed app, enable notifications and select **Send test notification**. Physical iPhone delivery requires that device's permission and subscription.
