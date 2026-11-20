CREATE TABLE IF NOT EXISTS quake_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  prefs TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS quake_deliveries (
  endpoint TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(endpoint,event_id)
);
CREATE INDEX IF NOT EXISTS quake_deliveries_age ON quake_deliveries(sent_at);
