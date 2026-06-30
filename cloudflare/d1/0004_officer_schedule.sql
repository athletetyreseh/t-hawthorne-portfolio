CREATE TABLE IF NOT EXISTS officer_schedule_requests (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  officer_name TEXT NOT NULL,
  officer_email TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL CHECK (request_type IN ('pto', 'unpaid', 'late-in', 'late-out')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  requested_time TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  denial_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS officer_schedule_requests_owner_status
  ON officer_schedule_requests (owner_email, status, start_date);

CREATE INDEX IF NOT EXISTS officer_schedule_requests_owner_dates
  ON officer_schedule_requests (owner_email, start_date, end_date);

CREATE TABLE IF NOT EXISTS officer_schedule_acknowledgements (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  officer_name TEXT NOT NULL,
  officer_email TEXT NOT NULL DEFAULT '',
  week_start TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  signed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS officer_schedule_ack_unique
  ON officer_schedule_acknowledgements (owner_email, officer_name, week_start);
