ALTER TABLE staff_records ADD COLUMN guard_card_expiration TEXT NOT NULL DEFAULT '';
ALTER TABLE staff_records ADD COLUMN cpr_expiration TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS staff_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  occurrence_date TEXT NOT NULL,
  occurrence_type TEXT NOT NULL CHECK (occurrence_type IN ('call_off', 'no_call_no_show', 'late', 'left_early', 'documentation')),
  points INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS staff_occurrences_staff_date
  ON staff_occurrences (staff_id, occurrence_date DESC);

CREATE TABLE IF NOT EXISTS staff_email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('bcc', 'separate')),
  recipient_count INTEGER NOT NULL,
  subject TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  provider_ids_json TEXT NOT NULL DEFAULT '[]'
);
