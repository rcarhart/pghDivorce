CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  county TEXT,
  divorce_stage TEXT,
  children_involved TEXT,
  asset_complexity TEXT,
  description TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT
);
