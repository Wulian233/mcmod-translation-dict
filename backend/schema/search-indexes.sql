-- Bootstrap ONLY into an empty, local SQLite database containing `dict`.
-- Do not run this full build against D1 Free: projection and FTS writes count
-- towards its 100,000-row daily write allowance.
-- Existing tables intentionally cause an error instead of being destroyed.
-- For updates, build locally and use tools/search_snapshot.py to prepare a delta.

CREATE TABLE dict_search AS
WITH ModBundles AS (
  SELECT
    trans_name,
    origin_name,
    modid,
    modid || ' (' || GROUP_CONCAT(version, '/') || ')' AS mod_with_ver,
    GROUP_CONCAT(DISTINCT "key") AS unique_keys,
    GROUP_CONCAT(DISTINCT COALESCE(curseforge, '')) AS unique_cfs
  FROM dict
  GROUP BY trans_name, origin_name, modid
),
OrderedModBundles AS (
  SELECT *
  FROM ModBundles
  ORDER BY trans_name, origin_name, modid
)
SELECT
  trans_name,
  origin_name,
  GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
  GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
  GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
  GROUP_CONCAT(modid, ',') AS all_modids,
  COUNT(*) AS frequency
FROM OrderedModBundles
GROUP BY trans_name, origin_name;

CREATE INDEX idx_dict_search_frequency
ON dict_search(frequency DESC, origin_name);

CREATE VIRTUAL TABLE dict_search_fts USING fts5(
  origin_name,
  trans_name,
  content='dict_search',
  content_rowid='rowid'
);

INSERT INTO dict_search_fts(rowid, origin_name, trans_name)
SELECT rowid, origin_name, trans_name
FROM dict_search;

-- Trigram MATCH narrows literal substrings with at least three Unicode characters.
-- One/two-character searches still scan the projection when no other positive
-- search term can narrow the candidates.
CREATE VIRTUAL TABLE dict_search_trigram USING fts5(
  origin_name,
  trans_name,
  content='dict_search',
  content_rowid='rowid',
  tokenize='trigram'
);

INSERT INTO dict_search_trigram(rowid, origin_name, trans_name)
SELECT rowid, origin_name, trans_name
FROM dict_search;

PRAGMA optimize;
