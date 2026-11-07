CREATE TABLE badge_rate_limits (
  client_hash TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
