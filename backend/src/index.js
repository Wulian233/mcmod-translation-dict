const ITEMS_PER_PAGE = 50
const QUERY_LIMIT = ITEMS_PER_PAGE + 1
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7

let preferredSchemaAvailable = null
let bundledSchemaAvailable = null

function isMissingTableError(err, tableNames) {
  const message = err?.message || ''
  return tableNames.some((tableName) =>
    new RegExp(`no such table:\\s*(?:main\\.)?${tableName}`, 'i').test(message),
  )
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

function validateModFilter(mod) {
  if (mod.length > 100) return '模组 ID 长度不能超过100个字符'
  if (mod.includes(',')) return '模组 ID 不能包含逗号'
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
  const substringFilters = []
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
    if (hasCjk(cjkSearchToken)) {
      substringFilters.push({
        exclude: isExclude,
        value: `%${escapeLike(cjkSearchToken)}%`,
      })
      if (!isExclude) includeCount += 1
      continue
    }

    let expression
    if (isPhrase) {
      expression = `${column}:${quoteFts(token)}`
    } else if (token.endsWith('+')) {
      const base = token.slice(0, -1)
      if (!base) continue
      expression = `(${column}:${quoteFts(base)}* NOT ${column}:${quoteFts(base)})`
    } else if (token.endsWith('*')) {
      const base = token.slice(0, -1)
      if (!base) continue
      expression = `${column}:${quoteFts(base)}*`
    } else {
      expression = `${column}:${quoteFts(token)}`
    }

    if (isExclude) {
      ftsExcludeParts.push(expression)
    } else {
      ftsIncludeParts.push(expression)
      includeCount += 1
    }
  }

  if (includeCount === 0) {
    return { ftsQuery: '', ftsExcludeQuery: '', substringFilters: [] }
  }

  const ftsQuery = ftsIncludeParts.length
    ? [...ftsIncludeParts, ...ftsExcludeParts.map((part) => `NOT ${part}`)].join(' ')
    : ''
  const ftsExcludeQuery = ftsIncludeParts.length ? '' : ftsExcludeParts.join(' OR ')

  return { ftsQuery, ftsExcludeQuery, substringFilters }
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

function buildPreferredSearch(searchPlan, searchColumn, hasModFilter) {
  const joins = []
  const conditions = []
  const params = []
  const positiveSubstringFilters = searchPlan.substringFilters.filter((filter) => !filter.exclude)
  const negativeSubstringFilters = searchPlan.substringFilters.filter((filter) => filter.exclude)

  if (searchPlan.ftsQuery) {
    joins.push('JOIN dict_search_fts ON dict_search_fts.rowid = s.rowid')
    conditions.push('dict_search_fts MATCH ?')
    params.push(searchPlan.ftsQuery)
  }

  if (positiveSubstringFilters.length) {
    joins.push('JOIN dict_search_trigram ON dict_search_trigram.rowid = s.rowid')
    for (const filter of positiveSubstringFilters) {
      conditions.push(`dict_search_trigram.${searchColumn} LIKE ? ESCAPE '\\'`)
      params.push(filter.value)
    }
  }

  for (const filter of negativeSubstringFilters) {
    conditions.push(`s.${searchColumn} NOT LIKE ? ESCAPE '\\'`)
    params.push(filter.value)
  }

  if (searchPlan.ftsExcludeQuery) {
    conditions.push(`s.rowid NOT IN (
      SELECT rowid FROM dict_search_fts WHERE dict_search_fts MATCH ?
    )`)
    params.push(searchPlan.ftsExcludeQuery)
  }

  if (hasModFilter) {
    conditions.push(`INSTR(',' || LOWER(s.all_modids) || ',', ',' || LOWER(?) || ',') > 0`)
  }

  const sql = `
    SELECT
      s.trans_name,
      s.origin_name,
      s.all_mods,
      s.all_keys,
      s.all_curseforges,
      s.frequency
    FROM dict_search AS s
    ${joins.join('\n')}
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      CASE WHEN LOWER(s.${searchColumn}) = LOWER(?) THEN 1 ELSE 0 END DESC,
      s.frequency DESC,
      s.origin_name
    LIMIT ? OFFSET ?;
  `

  return { sql, params }
}

const bundledResultsQueryWithFts = `
  WITH RankedMatches AS (
    SELECT
      b.trans_name,
      b.origin_name,
      b.mod_with_ver,
      b.unique_keys,
      b.unique_cfs,
      CASE WHEN LOWER(b.__SEARCH_COLUMN__) = LOWER(?) THEN 1 ELSE 0 END AS exact_match
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
  __BUNDLED_MOD_HAVING__
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

const bundledResultsQueryWithoutFts = `
  WITH RankedMatches AS (
    SELECT
      b.trans_name,
      b.origin_name,
      b.mod_with_ver,
      b.unique_keys,
      b.unique_cfs,
      CASE WHEN LOWER(b.__SEARCH_COLUMN__) = LOWER(?) THEN 1 ELSE 0 END AS exact_match
    FROM dict_mod_bundle AS b
    WHERE __SQL_FILTER__ __BUNDLED_FTS_EXCLUDE__
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
  __BUNDLED_MOD_HAVING__
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
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
      CASE WHEN LOWER(d.__SEARCH_COLUMN__) = LOWER(?) THEN 1 ELSE 0 END AS exact_match
    FROM dict_fts
    JOIN dict AS d ON d.rowid = dict_fts.rowid
    WHERE dict_fts MATCH ? __SQL_FILTER__
  ),
  ModBundles AS (
    SELECT
      trans_name,
      origin_name,
      modid,
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
  __LEGACY_MOD_HAVING__
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
      CASE WHEN LOWER(d.__SEARCH_COLUMN__) = LOWER(?) THEN 1 ELSE 0 END AS exact_match
    FROM dict AS d
    WHERE __SQL_FILTER__ __LEGACY_FTS_EXCLUDE__
  ),
  ModBundles AS (
    SELECT
      trans_name,
      origin_name,
      modid,
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
  __LEGACY_MOD_HAVING__
  ORDER BY MAX(exact_match) DESC, frequency DESC, origin_name
  LIMIT ? OFFSET ?;
`

function buildFallbackSearch({
  query,
  searchPlan,
  searchColumn,
  normalizedQuery,
  modFilter,
  itemsPerPage,
  offset,
  bundled,
}) {
  const hasFtsQuery = Boolean(searchPlan.ftsQuery)
  const alias = bundled ? 'b' : 'd'
  const substringConditions = searchPlan.substringFilters.map(
    (filter) => `${alias}.${searchColumn} ${filter.exclude ? 'NOT ' : ''}LIKE ? ESCAPE '\\'`,
  )
  const sqlFilter = substringConditions.length
    ? `${hasFtsQuery ? ' AND ' : ''}${substringConditions.join(' AND ')}`
    : hasFtsQuery
      ? ''
      : '1 = 1'
  const ftsTable = bundled ? 'dict_bundle_fts' : 'dict_fts'
  const ftsExclude = searchPlan.ftsExcludeQuery
    ? ` AND ${alias}.rowid NOT IN (SELECT rowid FROM ${ftsTable} WHERE ${ftsTable} MATCH ?)`
    : ''
  const hasModFilter = Boolean(modFilter)
  const bundledModHaving = hasModFilter
    ? `HAVING MAX(CASE
        WHEN LOWER(SUBSTR(mod_with_ver, 1, INSTR(mod_with_ver, ' (') - 1)) = LOWER(?)
        THEN 1 ELSE 0 END) = 1`
    : ''
  const legacyModHaving = hasModFilter
    ? 'HAVING MAX(CASE WHEN LOWER(modid) = LOWER(?) THEN 1 ELSE 0 END) = 1'
    : ''

  const sql = query
    .replaceAll('__SEARCH_COLUMN__', searchColumn)
    .replaceAll('__SQL_FILTER__', sqlFilter)
    .replaceAll('__BUNDLED_FTS_EXCLUDE__', bundled ? ftsExclude : '')
    .replaceAll('__LEGACY_FTS_EXCLUDE__', bundled ? '' : ftsExclude)
    .replaceAll('__BUNDLED_MOD_HAVING__', bundledModHaving)
    .replaceAll('__LEGACY_MOD_HAVING__', legacyModHaving)

  const params = [normalizedQuery]
  if (hasFtsQuery) params.push(searchPlan.ftsQuery)
  params.push(...searchPlan.substringFilters.map((filter) => filter.value))
  if (searchPlan.ftsExcludeQuery) params.push(searchPlan.ftsExcludeQuery)
  if (hasModFilter) params.push(modFilter)
  params.push(itemsPerPage, offset)

  return { sql, params }
}

async function runSearchQuery({
  env,
  normalizedQuery,
  searchPlan,
  searchColumn,
  modFilter,
  offset,
}) {
  if (preferredSchemaAvailable !== false) {
    const preferred = buildPreferredSearch(searchPlan, searchColumn, Boolean(modFilter))
    const params = [
      ...preferred.params,
      ...(modFilter ? [modFilter] : []),
      normalizedQuery,
      QUERY_LIMIT,
      offset,
    ]

    try {
      const result = await env.DB.prepare(preferred.sql)
        .bind(...params)
        .all()
      preferredSchemaAvailable = true
      return result
    } catch (err) {
      if (!isMissingTableError(err, ['dict_search', 'dict_search_fts', 'dict_search_trigram'])) {
        throw err
      }
      preferredSchemaAvailable = false
    }
  }

  const hasFtsQuery = Boolean(searchPlan.ftsQuery)
  if (bundledSchemaAvailable !== false) {
    const fallback = buildFallbackSearch({
      query: hasFtsQuery ? bundledResultsQueryWithFts : bundledResultsQueryWithoutFts,
      searchPlan,
      searchColumn,
      normalizedQuery,
      modFilter,
      itemsPerPage: QUERY_LIMIT,
      offset,
      bundled: true,
    })

    try {
      const result = await env.DB.prepare(fallback.sql)
        .bind(...fallback.params)
        .all()
      bundledSchemaAvailable = true
      return result
    } catch (err) {
      if (!isMissingTableError(err, ['dict_mod_bundle', 'dict_bundle_fts'])) throw err
      bundledSchemaAvailable = false
    }
  }

  const fallback = buildFallbackSearch({
    query: hasFtsQuery ? legacyResultsQueryWithFts : legacyResultsQueryWithoutFts,
    searchPlan,
    searchColumn,
    normalizedQuery,
    modFilter,
    itemsPerPage: QUERY_LIMIT,
    offset,
    bundled: false,
  })
  return env.DB.prepare(fallback.sql)
    .bind(...fallback.params)
    .all()
}

function buildCacheKey(request, normalizedQuery, page, mode, modFilter) {
  const url = new URL(request.url)
  url.search = ''
  url.searchParams.set('q', normalizedQuery)
  url.searchParams.set('page', String(page))
  url.searchParams.set('mode', mode)
  if (modFilter) url.searchParams.set('mod', modFilter.toLowerCase())
  return new Request(url.toString(), { method: 'GET' })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname: path, searchParams } = url
    const headers = buildHeaders()

    if (request.method === 'OPTIONS') return new Response(null, { headers })
    if (request.method !== 'GET')
      return new Response('Method Not Allowed', { status: 405, headers })
    if (path !== '/search') return new Response('Not Found', { status: 404, headers })

    const query = searchParams.get('q')
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const mode = searchParams.get('mode') === 'zh2en' ? 'zh2en' : 'en2zh'
    const modFilter = (searchParams.get('mod') || '').trim()
    const offset = (page - 1) * ITEMS_PER_PAGE

    const error = validateQuery(query) || validateModFilter(modFilter)
    if (error) return jsonResponse({ error }, 400, headers)

    const searchColumn = mode === 'en2zh' ? 'origin_name' : 'trans_name'
    const normalizedQuery = query.trim()
    const searchPlan = buildSearchPlan(normalizedQuery, searchColumn)
    if (!searchPlan.ftsQuery && searchPlan.substringFilters.length === 0) {
      return jsonResponse({ error: '搜索词不能只包含排除条件' }, 400, headers)
    }

    const cache = caches.default
    const cacheKey = buildCacheKey(request, normalizedQuery, page, mode, modFilter)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    try {
      const resultsData = await runSearchQuery({
        env,
        normalizedQuery,
        searchPlan,
        searchColumn,
        modFilter,
        offset,
      })
      const fetchedResults = resultsData.results || []
      const hasMore = fetchedResults.length > ITEMS_PER_PAGE
      const results = hasMore ? fetchedResults.slice(0, ITEMS_PER_PAGE) : fetchedResults

      // Backwards-compatible lower bound. Exact COUNT(*) doubled reads on broad searches.
      const total = offset + results.length + (hasMore ? 1 : 0)
      const response = jsonResponse(
        {
          query: normalizedQuery,
          results,
          total,
          totalIsExact: !hasMore,
          hasMore,
          page,
          mode,
          mod: modFilter,
          usage: { rowsRead: resultsData.meta?.rows_read ?? null },
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
