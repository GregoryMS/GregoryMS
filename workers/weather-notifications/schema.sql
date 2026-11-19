CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  prefs TEXT NOT NULL, location TEXT NOT NULL, pending TEXT, last_sent TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  endpoint TEXT NOT NULL, event_id TEXT NOT NULL, sent_at INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(endpoint,event_id)
);
CREATE INDEX IF NOT EXISTS deliveries_sent_at ON deliveries(sent_at);
CREATE TABLE IF NOT EXISTS service_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
