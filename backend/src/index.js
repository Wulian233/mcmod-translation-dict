const ITEMS_PER_PAGE = 50
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7
const COUNT_CACHE_TTL_MS = 5 * 60 * 1000
const COUNT_CACHE_MAX_ENTRIES = 200

const countCache = new Map()

function isMissingOptimizedTableError(err) {
  return /no such table:\s*(dict_mod_bundle|dict_bundle_fts)/i.test(err?.message || '')
}

function setCountCache(key, total) {
  if (countCache.has(key)) countCache.delete(key)
  countCache.set(key, { total, expiresAt: Date.now() + COUNT_CACHE_TTL_MS })

  if (countCache.size > COUNT_CACHE_MAX_ENTRIES) {
    const oldestKey = countCache.keys().next().value
    countCache.delete(oldestKey)
  }
}

function getCountCache(key) {
  const cached = countCache.get(key)
  if (!cached) return null

  if (cached.expiresAt < Date.now()) {
    countCache.delete(key)
    return null
  }

  return cached.total
}

function buildHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
  }
}

function validateQuery(query) {
  if (!query || query.trim() === '') return '查询参数不能为空'
  if (query.length > 50) return '搜索词长度不能超过50个字符'
  return null
}

function quoteFts(value) {
  return `"${value.replace(/"/g, '""')}"`
}

function hasCjk(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(value)
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function getCjkSearchToken(token) {
  if (token.endsWith('+') && hasCjk(token.slice(0, -1))) {
    return token.slice(0, -1)
  }

  return hasCjk(token) ? token : ''
}

export function buildSearchPlan(raw, column) {
  const ftsIncludeParts = []
  const ftsExcludeParts = []
  const sqlConditions = []
  const sqlParams = []
  let includeCount = 0
  const pattern = /"([^"]+)"|\S+/g
  let match

  while ((match = pattern.exec(raw)) !== null) {
    const isPhrase = Boolean(match[1])
    let token = match[1] || match[0]

    const isExclude = token.startsWith('-')
    if (isExclude) token = token.slice(1)

    if (!token) continue

    const cjkSearchToken = isPhrase ? token : getCjkSearchToken(token)
    const tokenHasCjk = hasCjk(cjkSearchToken)
    let expr

    if (isPhrase && tokenHasCjk) {
      expr = `${column} ${isExclude ? 'NOT ' : ''}LIKE ? ESCAPE '\\'`
      sqlConditions.push(expr)
      sqlParams.push(`%${escapeLike(cjkSearchToken)}%`)
      if (!isExclude) includeCount += 1
      continue
    } else if (isPhrase) {
      expr = `${column}:${quoteFts(token)}`
    } else if (token.endsWith('+')) {
      const base = token.slice(0, -1)
      if (!base) continue
      if (hasCjk(base)) {
        expr = `${column} ${isExclude ? 'NOT ' : ''}LIKE ? ESCAPE '\\'`
        sqlConditions.push(expr)
        sqlParams.push(`%${escapeLike(base)}%`)
        if (!isExclude) includeCount += 1
        continue
      }
      expr = `(${column}:${quoteFts(base)}* NOT ${column}:${quoteFts(base)})`
    } else if (tokenHasCjk) {
      expr = `${column} ${isExclude ? 'NOT ' : ''}LIKE ? ESCAPE '\\'`
      sqlConditions.push(expr)
      sqlParams.push(`%${escapeLike(cjkSearchToken)}%`)
      if (!isExclude) includeCount += 1
      continue
    } else if (token.endsWith('*')) {
      const base = token.slice(0, -1)
      if (!base) continue
      expr = `${column}:${quoteFts(base)}*`
    } else {
      expr = `${column}:${quoteFts(token)}`
    }

    if (isExclude) {
      ftsExcludeParts.push(expr)
    } else {
      ftsIncludeParts.push(expr)
      includeCount += 1
    }
  }

  if (includeCount === 0) {
    return { ftsQuery: '', sqlConditions: [], sqlParams: [] }
  }

  const ftsQuery =
    ftsIncludeParts.length === 0
      ? ''
      : [...ftsIncludeParts, ...ftsExcludeParts.map((expr) => `NOT ${expr}`)].join(' ')

  return { ftsQuery, sqlConditions, sqlParams }
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

const optimizedResultsQueryWithFts = `
  WITH RankedMatches AS (
    SELECT
      b.trans_name,
      b.origin_name,
      b.mod_with_ver,
      b.unique_keys,
      b.unique_cfs,
      CASE
        WHEN LOWER(b.__SEARCH_COLUMN__) = LOWER(?) THEN 1
        ELSE 0
      END AS exact_match
    FROM dict_bundle_fts
    JOIN dict_mod_bundle AS b ON b.rowid = dict_bundle_fts.rowid
    WHERE dict_bundle_fts MATCH ? __SQL_FILTER__
  )
  SELECT
    trans_name,
    origin_name,
    GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
    GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
    GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
    COUNT(*) AS frequency
  FROM RankedMatches
  GROUP BY trans_name, origin_name
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

const optimizedResultsQueryWithoutFts = `
  WITH RankedMatches AS (
    SELECT
      b.trans_name,
      b.origin_name,
      b.mod_with_ver,
      b.unique_keys,
      b.unique_cfs,
      CASE
        WHEN LOWER(b.__SEARCH_COLUMN__) = LOWER(?) THEN 1
        ELSE 0
      END AS exact_match
    FROM dict_mod_bundle AS b
    WHERE __SQL_FILTER__
  )
  SELECT
    trans_name,
    origin_name,
    GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
    GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
    GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
    COUNT(*) AS frequency
  FROM RankedMatches
  GROUP BY trans_name, origin_name
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

const optimizedCountQueryWithFts = `
  SELECT COUNT(*) as total
  FROM (
    SELECT 1
    FROM dict_bundle_fts
    JOIN dict_mod_bundle AS b ON b.rowid = dict_bundle_fts.rowid
    WHERE dict_bundle_fts MATCH ? __SQL_FILTER__
    GROUP BY b.trans_name, b.origin_name
  );
`

const optimizedCountQueryWithoutFts = `
  SELECT COUNT(*) as total
  FROM (
    SELECT 1
    FROM dict_mod_bundle AS b
    WHERE __SQL_FILTER__
    GROUP BY b.trans_name, b.origin_name
  );
`

const legacyResultsQueryWithFts = `
  WITH RankedMatches AS (
    SELECT
      d.trans_name,
      d.origin_name,
      d.modid,
      d.version,
      d.key,
      d.curseforge,
      CASE
        WHEN LOWER(d.__SEARCH_COLUMN__) = LOWER(?) THEN 1
        ELSE 0
      END AS exact_match
    FROM dict_fts
    JOIN dict AS d ON d.rowid = dict_fts.rowid
    WHERE dict_fts MATCH ? __SQL_FILTER__
  ),
  ModBundles AS (
    SELECT
      trans_name,
      origin_name,
      MAX(exact_match) AS exact_match,
      modid || ' (' || GROUP_CONCAT(version, '/') || ')' AS mod_with_ver,
      GROUP_CONCAT(DISTINCT "key") AS unique_keys,
      GROUP_CONCAT(DISTINCT COALESCE(curseforge, '')) AS unique_cfs
    FROM RankedMatches
    GROUP BY trans_name, origin_name, modid
  )
  SELECT
    trans_name,
    origin_name,
    GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
    GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
    GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
    COUNT(*) AS frequency
  FROM ModBundles
  GROUP BY trans_name, origin_name
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

const legacyResultsQueryWithoutFts = `
  WITH RankedMatches AS (
    SELECT
      d.trans_name,
      d.origin_name,
      d.modid,
      d.version,
      d.key,
      d.curseforge,
      CASE
        WHEN LOWER(d.__SEARCH_COLUMN__) = LOWER(?) THEN 1
        ELSE 0
      END AS exact_match
    FROM dict AS d
    WHERE __SQL_FILTER__
  ),
  ModBundles AS (
    SELECT
      trans_name,
      origin_name,
      MAX(exact_match) AS exact_match,
      modid || ' (' || GROUP_CONCAT(version, '/') || ')' AS mod_with_ver,
      GROUP_CONCAT(DISTINCT "key") AS unique_keys,
      GROUP_CONCAT(DISTINCT COALESCE(curseforge, '')) AS unique_cfs
    FROM RankedMatches
    GROUP BY trans_name, origin_name, modid
  )
  SELECT
    trans_name,
    origin_name,
    GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
    GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
    GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
    COUNT(*) AS frequency
  FROM ModBundles
  GROUP BY trans_name, origin_name
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

const legacyCountQueryWithFts = `
  SELECT COUNT(*) as total
  FROM (
    WITH ModBundles AS (
      SELECT d.trans_name, d.origin_name, d.modid
      FROM dict_fts
      JOIN dict AS d ON d.rowid = dict_fts.rowid
      WHERE dict_fts MATCH ? __SQL_FILTER__
      GROUP BY d.trans_name, d.origin_name, d.modid
    )
    SELECT 1
    FROM ModBundles
    GROUP BY trans_name, origin_name
  );
`

const legacyCountQueryWithoutFts = `
  SELECT COUNT(*) as total
  FROM (
    WITH ModBundles AS (
      SELECT d.trans_name, d.origin_name, d.modid
      FROM dict AS d
      WHERE __SQL_FILTER__
      GROUP BY d.trans_name, d.origin_name, d.modid
    )
    SELECT 1
    FROM ModBundles
    GROUP BY trans_name, origin_name
  );
`

async function runSearchQueries({
  env,
  normalizedQuery,
  searchPlan,
  searchColumn,
  itemsPerPage,
  offset,
  cachedTotal,
}) {
  const hasFtsQuery = Boolean(searchPlan.ftsQuery)
  const sqlFilter = searchPlan.sqlConditions.length
    ? ` AND ${searchPlan.sqlConditions.join(' AND ')}`
    : ''
  const standaloneSqlFilter = searchPlan.sqlConditions.length
    ? searchPlan.sqlConditions.join(' AND ')
    : '1 = 1'
  const searchParams = hasFtsQuery
    ? [searchPlan.ftsQuery, ...searchPlan.sqlParams]
    : [...searchPlan.sqlParams]

  const buildQuery = (query) =>
    query
      .replaceAll('__SEARCH_COLUMN__', searchColumn)
      .replaceAll('__SQL_FILTER__', hasFtsQuery ? sqlFilter : standaloneSqlFilter)

  const bindResults = (query) =>
    env.DB.prepare(buildQuery(query)).bind(normalizedQuery, ...searchParams, itemsPerPage, offset)

  const bindCount = (query) => env.DB.prepare(buildQuery(query)).bind(...searchParams)

  const runQueryPair = async (resultsQuery, countQuery) => {
    const resultsStatement = bindResults(resultsQuery)

    if (cachedTotal !== null) {
      const resultsData = await resultsStatement.all()
      return [resultsData, { total: cachedTotal }]
    }

    const [resultsData, countData] = await env.DB.batch([resultsStatement, bindCount(countQuery)])
    return [resultsData, countData.results?.[0] ?? { total: 0 }]
  }

  try {
    return await runQueryPair(
      hasFtsQuery ? optimizedResultsQueryWithFts : optimizedResultsQueryWithoutFts,
      hasFtsQuery ? optimizedCountQueryWithFts : optimizedCountQueryWithoutFts,
    )
  } catch (err) {
    if (!isMissingOptimizedTableError(err)) throw err
    return runQueryPair(
      hasFtsQuery ? legacyResultsQueryWithFts : legacyResultsQueryWithoutFts,
      hasFtsQuery ? legacyCountQueryWithFts : legacyCountQueryWithoutFts,
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname: path, searchParams } = url
    const headers = buildHeaders()

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    if (path !== '/search') {
      return new Response('Not Found', { status: 404, headers })
    }

    const query = searchParams.get('q')
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const mode = searchParams.get('mode') === 'zh2en' ? 'zh2en' : 'en2zh'
    const offset = (page - 1) * ITEMS_PER_PAGE

    const error = validateQuery(query)
    if (error) return jsonResponse({ error }, 400, headers)

    const searchColumn = mode === 'en2zh' ? 'origin_name' : 'trans_name'
    const normalizedQuery = query.trim()
    const searchPlan = buildSearchPlan(normalizedQuery, searchColumn)
    if (!searchPlan.ftsQuery && searchPlan.sqlConditions.length === 0) {
      return jsonResponse({ error: '搜索词不能只包含排除条件' }, 400, headers)
    }

    const cache = caches.default
    const cacheKey = new Request(request.url, request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    try {
      const countKey = `${mode}::${JSON.stringify(searchPlan)}`
      const cachedTotal = getCountCache(countKey)

      const [resultsData, countResult] = await runSearchQueries({
        env,
        normalizedQuery,
        searchPlan,
        searchColumn,
        itemsPerPage: ITEMS_PER_PAGE,
        offset,
        cachedTotal,
      })

      const total = countResult?.total || 0
      if (cachedTotal === null) {
        setCountCache(countKey, total)
      }

      const response = jsonResponse(
        {
          query,
          results: resultsData.results || [],
          total,
          page,
          mode,
        },
        200,
        headers,
      )

      ctx.waitUntil(cache.put(cacheKey, response.clone(), { expirationTtl: CACHE_TTL_SECONDS }))
      return response
    } catch (err) {
      console.error('Database query failed:', err)
      return jsonResponse({ error: '数据库查询失败', details: err.message }, 500, headers)
    }
  },
}
