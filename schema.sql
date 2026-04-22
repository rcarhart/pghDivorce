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
  ip_address TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);

CREATE TABLE IF NOT EXISTS weekly_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_ending TEXT NOT NULL,
  total_leads INTEGER,
  qualified_leads INTEGER,
  spam_leads INTEGER,
  duplicate_leads INTEGER,
  ad_spend REAL,
  cost_per_lead REAL
);
