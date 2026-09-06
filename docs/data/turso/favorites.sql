-- =====================================================================
-- HR Reporting — Person Favorites (Turso / SQLite)
-- ---------------------------------------------------------------------
-- Person-level favorites with report provenance. One favorite per person
-- per user globally (first report wins). Apply with:
--   npx tsx scripts/apply-turso-sql.mts docs/data/turso/favorites.sql
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =====================================================================

CREATE TABLE IF NOT EXISTS person_favorites (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  person_id         TEXT NOT NULL,
  employee_number   TEXT NOT NULL,
  person_name       TEXT NOT NULL,
  report_id         TEXT REFERENCES reports (id) ON DELETE SET NULL,
  report_title      TEXT NOT NULL,
  organization      TEXT NOT NULL,
  row_key           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_person_favorites_user ON person_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_person_favorites_report ON person_favorites (report_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_favorites_unique ON person_favorites (user_id, person_id);
