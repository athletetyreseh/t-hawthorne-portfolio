CREATE TABLE IF NOT EXISTS private_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS private_permissions (
  user_email TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('view', 'edit')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_email, resource_key),
  FOREIGN KEY (user_email) REFERENCES private_users(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  requested_level TEXT NOT NULL DEFAULT 'view' CHECK (requested_level IN ('view', 'edit')),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  FOREIGN KEY (user_email) REFERENCES private_users(email) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending
  ON access_requests (user_email, resource_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS access_requests_status_requested
  ON access_requests (status, requested_at DESC);

CREATE TABLE IF NOT EXISTS staff_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  site TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'leave', 'inactive')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS staff_records_status_name
  ON staff_records (status, full_name COLLATE NOCASE);
