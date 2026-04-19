const ITEMS_PER_PAGE = 50
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7
const COUNT_CACHE_TTL_MS = 5 * 60 * 1000
const COUNT_CACHE_MAX_ENTRIES = 200

const countCache = new Map()

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

function parseAdvancedQuery(raw, column) {
  const ftsParts = []
  const pattern = /"([^"]+)"|\S+/g
  let match

  while ((match = pattern.exec(raw)) !== null) {
    const isPhrase = Boolean(match[1])
    let token = match[1] || match[0]

    const isExclude = token.startsWith('-')
    if (isExclude) token = token.slice(1)

    if (!token) continue

    let expr
    const hasChinese = /[\u4e00-\u9fa5]/.test(token)

    if (isPhrase) {
      expr = `${column}:"${token}"`
    } else if (token.endsWith('+')) {
      const base = token.slice(0, -1)
      if (!base) continue
      expr = `(${column}:${base}* NOT ${column}:"${base}")`
    } else if (hasChinese) {
      expr = `${column}:${token}*`
    } else if (token.endsWith('*')) {
      expr = `${column}:${token}`
    } else {
      expr = `${column}:"${token}"`
    }

    ftsParts.push(isExclude ? `NOT ${expr}` : expr)
  }

  return ftsParts.join(' ')
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
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
    const searchTermFts = parseAdvancedQuery(normalizedQuery, searchColumn)

    const cache = caches.default
    const cacheKey = new Request(request.url, request)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    try {
      const resultsQuery = `
        WITH RankedMatches AS (
          SELECT
            d.trans_name,
            d.origin_name,
            d.modid,
            d.version,
            d.key,
            d.curseforge,
            CASE
              WHEN LOWER(d.${searchColumn}) = LOWER(?) THEN 1
              ELSE 0
            END AS exact_match
          FROM dict_fts
          JOIN dict AS d ON d.rowid = dict_fts.rowid
          WHERE dict_fts MATCH ?
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

      const countKey = `${mode}::${searchTermFts}`
      const cachedTotal = getCountCache(countKey)

      const resultsPromise = env.DB.prepare(resultsQuery)
        .bind(normalizedQuery, searchTermFts, ITEMS_PER_PAGE, offset)
        .all()

      const countPromise =
        cachedTotal !== null
          ? Promise.resolve({ total: cachedTotal })
          : env.DB.prepare(
              `
                SELECT COUNT(*) as total
                FROM (
                  SELECT 1 FROM dict_fts
                  WHERE dict_fts MATCH ?
                  GROUP BY origin_name, trans_name
                );
              `,
            )
              .bind(searchTermFts)
              .first()

      const [resultsData, countResult] = await Promise.all([resultsPromise, countPromise])

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
