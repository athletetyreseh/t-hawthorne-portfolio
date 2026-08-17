CREATE TABLE IF NOT EXISTS life_manager_pairings (
  id TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  verifier_challenge TEXT NOT NULL,
  owner_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS life_manager_pairings_code_status
  ON life_manager_pairings (user_code, status, expires_at);

CREATE TABLE IF NOT EXISTS life_manager_devices (
  owner_email TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (owner_email, device_id)
);

CREATE TABLE IF NOT EXISTS life_manager_sync_cursors (
  owner_email TEXT PRIMARY KEY,
  cursor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS life_manager_records (
  owner_email TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL,
  client_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (owner_email, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS life_manager_records_owner_sequence
  ON life_manager_records (owner_email, sequence);

CREATE TABLE IF NOT EXISTS life_manager_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload_json TEXT,
  version INTEGER NOT NULL,
  client_updated_at TEXT NOT NULL,
  deleted_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('replaced', 'conflict')),
  archived_at TEXT NOT NULL,
  archived_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS life_manager_history_owner_archived
  ON life_manager_history (owner_email, id DESC);

CREATE TABLE IF NOT EXISTS life_manager_photos (
  owner_email TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (owner_email, photo_id)
);

CREATE INDEX IF NOT EXISTS life_manager_photos_owner_hash
  ON life_manager_photos (owner_email, sha256);
