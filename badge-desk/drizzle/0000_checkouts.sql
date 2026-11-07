CREATE TABLE checkouts (
  id TEXT PRIMARY KEY NOT NULL,
  badge TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo_key TEXT,
  checked_out_at TEXT NOT NULL,
  returned_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX checkouts_one_active ON checkouts (badge) WHERE returned_at IS NULL;
--> statement-breakpoint
CREATE INDEX checkouts_history ON checkouts (checked_out_at DESC);
