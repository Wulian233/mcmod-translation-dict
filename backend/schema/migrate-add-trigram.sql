-- One-time, resumable migration for an existing database that already has a
-- compatible dict_search table and dict_search_fts, but no trigram index.
--
-- Check that dict_search contains all_modids before running this file.
-- This file only prepares the empty index and migration command. Run the
-- command documented in README repeatedly to index 1,000 source rows per call.

CREATE VIRTUAL TABLE IF NOT EXISTS dict_search_trigram USING fts5(
  origin_name,
  trans_name,
  content='dict_search',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS dict_search_trigram_migration_state(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_rowid INTEGER NOT NULL
);

INSERT OR IGNORE INTO dict_search_trigram_migration_state(id, last_rowid)
VALUES(1, 0);

CREATE VIEW IF NOT EXISTS dict_search_trigram_migration AS
SELECT NULL AS run WHERE 0;

CREATE TRIGGER IF NOT EXISTS dict_search_trigram_migration_next
INSTEAD OF INSERT ON dict_search_trigram_migration
BEGIN
  INSERT INTO dict_search_trigram(rowid, origin_name, trans_name)
  SELECT rowid, origin_name, trans_name
  FROM dict_search
  WHERE rowid > (
    SELECT last_rowid FROM dict_search_trigram_migration_state WHERE id = 1
  )
  ORDER BY rowid
  LIMIT 1000;

  UPDATE dict_search_trigram_migration_state
  SET last_rowid = COALESCE(
    (
      SELECT MAX(rowid)
      FROM (
        SELECT rowid
        FROM dict_search
        WHERE rowid > dict_search_trigram_migration_state.last_rowid
        ORDER BY rowid
        LIMIT 1000
      )
    ),
    last_rowid
  )
  WHERE id = 1;
END;
