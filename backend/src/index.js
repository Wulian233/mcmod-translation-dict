const ITEMS_PER_PAGE = 50
const QUERY_LIMIT = ITEMS_PER_PAGE + 1
const MAX_PAGE = 100
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7
const CACHE_VERSION = '5'
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60

function errorChainMessages(error) {
  const messages = []
  const seen = new Set()
  let current = error

  while (current !== null && current !== undefined) {
    if (seen.has(current)) break
    seen.add(current)
    if (typeof current === 'string') {
      messages.push(current)
      break
    }
    if (typeof current.message === 'string') messages.push(current.message)
    try {
      current = current.cause
    } catch {
      break
    }
  }
  return messages
}

function isMissingTableError(err, tableNames) {
  return errorChainMessages(err).some((message) =>
    tableNames.some((tableName) =>
      new RegExp(`no such table:\\s*(?:main\\.)?${tableName}`, 'i').test(message),
    ),
  )
}

function isDailyQuotaError(err) {
  return errorChainMessages(err).some((message) =>
    /D1['’]s free tier daily row (?:read|write)s? limit/i.test(message),
  )
}

function buildHeaders(cacheControl = 'no-store') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
  }
}

function parsePage(rawPage) {
  if (rawPage === null || /^[0-9]+$/.test(rawPage)) {
    const page = rawPage === null ? 1 : Number(rawPage)
    if (Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE) return page
  }
  return null
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
        value: cjkSearchToken,
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

export function filterResultForMod(result, modFilter) {
  if (!modFilter) return result

  const selectedMod = modFilter.toLowerCase()
  const mods = String(result.all_mods || '').split(', ')
  const keys = String(result.all_keys || '').split(',')
  const curseforges = String(result.all_curseforges || '').split(',')
  const selectedIndexes = []

  mods.forEach((mod, index) => {
    const match = mod.match(/^(.*) \(.*\)$/)
    const modId = (match ? match[1] : mod).trim().toLowerCase()
    if (modId === selectedMod) selectedIndexes.push(index)
  })

  if (selectedIndexes.length === 0) return null

  return {
    ...result,
    all_mods: selectedIndexes.map((index) => mods[index]).join(', '),
    all_keys: selectedIndexes.map((index) => keys[index] || '').join(','),
    all_curseforges: selectedIndexes.map((index) => curseforges[index] || '').join(','),
  }
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

  // MATCH treats quoted trigrams literally, including %, _ and backslashes.
  // Short substrings still need a scan unless another positive term narrows it.
  const trigramParts = positiveSubstringFilters
    .filter((filter) => Array.from(filter.value).length >= 3)
    .map((filter) => `${searchColumn}:${quoteFts(filter.value)}`)
  if (trigramParts.length) {
    joins.push('JOIN dict_search_trigram ON dict_search_trigram.rowid = s.rowid')
    conditions.push('dict_search_trigram MATCH ?')
    params.push(trigramParts.join(' AND '))
  }

  // Verify literal substrings with SQLite's ASCII case folding, matching the
  // previous LIKE semantics without its ESCAPE/index and pattern-byte limits.
  for (const filter of [...positiveSubstringFilters, ...negativeSubstringFilters]) {
    conditions.push(`INSTR(LOWER(s.${searchColumn}), LOWER(?)) ${filter.exclude ? '=' : '>'} 0`)
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
      s.origin_name,
      s.rowid
    LIMIT ? OFFSET ?;
  `

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
  const { sql, params } = buildPreferredSearch(searchPlan, searchColumn, Boolean(modFilter))
  return env.DB.prepare(sql)
    .bind(...params, ...(modFilter ? [modFilter] : []), normalizedQuery, QUERY_LIMIT, offset)
    .all()
}

function buildCacheKey(request, normalizedQuery, page, mode, modFilter) {
  const url = new URL(request.url)
  url.search = ''
  url.searchParams.set('q', normalizedQuery)
  url.searchParams.set('page', String(page))
  url.searchParams.set('mode', mode)
  if (modFilter) url.searchParams.set('mod', modFilter.toLowerCase())
  url.searchParams.set('_cache', CACHE_VERSION)
  return new Request(url.toString(), { method: 'GET' })
}

function classifySearchPath(searchPlan) {
  const hasFts = Boolean(searchPlan.ftsQuery)
  const hasTrigram = searchPlan.substringFilters.some(
    (filter) => !filter.exclude && Array.from(filter.value).length >= 3,
  )
  if (hasFts && hasTrigram) return 'fts+trigram'
  if (hasFts) return 'fts'
  if (hasTrigram) return 'trigram'
  return 'substring'
}

function logSearchMetrics({ resultsData, mode, page, modFilter, searchPlan }) {
  const meta = resultsData?.meta
  console.log({
    event: 'search',
    mode,
    page,
    filter: modFilter ? 'mod' : 'none',
    search_path: classifySearchPath(searchPlan),
    rows_read: meta?.rows_read ?? null,
    rows_written: meta?.rows_written ?? null,
    duration: meta?.duration ?? null,
  })
}

async function checkRateLimit(request, env) {
  const limiter = env?.SEARCH_RATE_LIMITER
  if (!limiter || typeof limiter.limit !== 'function') return 'unavailable'
  try {
    const decision = await limiter.limit({
      key: `/search:${request.headers.get('CF-Connecting-IP') || 'unknown'}`,
    })
    if (!decision || typeof decision.success !== 'boolean') return 'unavailable'
    return decision.success ? 'allowed' : 'denied'
  } catch {
    return 'unavailable'
  }
}

function utcResetRetryAfter(now = new Date()) {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return String(Math.max(1, Math.ceil((reset - now.getTime()) / 1000)))
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
    const page = parsePage(searchParams.get('page'))
    if (page === null) {
      return jsonResponse({ error: '页码必须是1到100之间的整数' }, 400, headers)
    }

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
    let cached
    try {
      cached = await cache.match(cacheKey)
    } catch {
      return jsonResponse({ error: '缓存服务暂不可用，请稍后重试。' }, 503, headers)
    }
    if (cached) return cached

    const rateLimit = await checkRateLimit(request, env)
    if (rateLimit === 'unavailable') {
      return jsonResponse({ error: '搜索限流服务暂不可用，请稍后重试。' }, 503, headers)
    }
    if (rateLimit === 'denied') {
      return jsonResponse({ error: '搜索请求过于频繁，请稍后重试。' }, 429, {
        ...headers,
        'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS),
      })
    }

    try {
      const resultsData = await runSearchQuery({
        env,
        normalizedQuery,
        searchPlan,
        searchColumn,
        modFilter,
        offset,
      })
      logSearchMetrics({ resultsData, mode, page, modFilter, searchPlan })

      const fetchedResults = (resultsData.results || [])
        .map((result) => filterResultForMod(result, modFilter))
        .filter(Boolean)
      const hasExtraResult = fetchedResults.length > ITEMS_PER_PAGE
      const hasMore = hasExtraResult && page < MAX_PAGE
      const pageLimitReached = page === MAX_PAGE && hasExtraResult
      const results = hasExtraResult ? fetchedResults.slice(0, ITEMS_PER_PAGE) : fetchedResults

      // An empty offset page does not prove that any earlier rows exist.
      const emptyOffsetPage = offset > 0 && results.length === 0
      const total = emptyOffsetPage ? null : offset + results.length + (hasExtraResult ? 1 : 0)
      const response = jsonResponse(
        {
          query: normalizedQuery,
          results,
          total,
          totalIsExact: !hasExtraResult && !emptyOffsetPage,
          hasMore,
          pageLimitReached,
          page,
          mode,
          mod: modFilter,
        },
        200,
        buildHeaders(`public, max-age=${CACHE_TTL_SECONDS}`),
      )

      ctx.waitUntil(cache.put(cacheKey, response.clone()))
      return response
    } catch (err) {
      console.error('Database query failed:', err)
      if (isMissingTableError(err, ['dict_search', 'dict_search_fts', 'dict_search_trigram'])) {
        return jsonResponse(
          { error: '搜索索引尚未准备好，请完成索引部署后重试；不会回退扫描原始词典。' },
          503,
          { ...headers, 'Retry-After': '60' },
        )
      }
      if (isDailyQuotaError(err)) {
        return jsonResponse(
          { error: 'D1 今日免费读写额度已用尽，请在 UTC 00:00 额度重置后重试。' },
          503,
          { ...headers, 'Retry-After': utcResetRetryAfter() },
        )
      }
      return jsonResponse({ error: '数据库查询失败，请稍后重试。' }, 500, headers)
    }
  },
}
