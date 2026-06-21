CREATE TABLE IF NOT EXISTS scheduler_state (
  owner_email TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduler_history_owner_created
  ON scheduler_history (owner_email, id DESC);

