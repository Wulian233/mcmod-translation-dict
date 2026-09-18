-- Rebuild the read-optimized search projection after importing/replacing `dict`.
-- This is intentionally a deployment step, never something the Worker runs per request.

DROP TABLE IF EXISTS dict_search_trigram;
DROP TABLE IF EXISTS dict_search_fts;
DROP TABLE IF EXISTS dict_search;

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

-- Trigram makes LIKE '%关键词%' index-backed when the pattern contains at least
-- three consecutive Unicode characters. One/two-character searches still scan
-- dict_search, which is much smaller than the raw dict table.
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
