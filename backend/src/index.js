export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname: path, searchParams } = url

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff',
    }

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: headers })
    }

    const cache = caches.default
    const cacheTtl = 60 * 60 * 24 * 7 // 7天

    function validateQuery(q) {
      if (!q || q.trim() === '') return '查询参数不能为空'
      if (q.length > 50) return '搜索词长度不能超过50个字符'
      return null
    }

    function parseAdvancedQuery(raw, column) {
      const ftsParts = []

      const pattern = /"([^"]+)"|\S+/g
      let match

      while ((match = pattern.exec(raw)) !== null) {
        let token = match[1] || match[0]

        const isExclude = token.startsWith('-')
        if (isExclude) token = token.slice(1)

        const hasChinese = /[\u4e00-\u9fa5]/.test(token)

        let expr
        if (hasChinese) {
          // 中文整体前缀匹配
          expr = `${column}:${token}*`
        } else {
          // 英文：保持你原来的逻辑
          if (token.endsWith('*')) {
            expr = `${column}:${token}`
          } else {
            expr = `${column}:"${token}"`
          }
        }

        if (isExclude) {
          ftsParts.push(`NOT ${expr}`)
        } else {
          ftsParts.push(expr)
        }
      }

      return ftsParts.join(' ')
    }

    if (path === '/search') {
      const query = searchParams.get('q')
      const page = parseInt(searchParams.get('page')) || 1
      const mode = searchParams.get('mode') || 'en2zh'
      const offset = (page - 1) * 50

      const error = validateQuery(query)
      if (error) return jsonResponse({ error }, 400)

      const searchColumn = mode === 'en2zh' ? 'origin_name' : 'trans_name'
      const searchTermFts = parseAdvancedQuery(query.trim(), searchColumn)

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
                WHEN LOWER(d.${searchColumn}) = LOWER(?) THEN 3 
                ELSE 1 
              END AS match_weight
            FROM dict_fts
            JOIN dict AS d ON d.rowid = dict_fts.rowid
            WHERE dict_fts MATCH ?
          ),
          ModBundles AS (
            SELECT 
              trans_name, 
              origin_name,
              min(match_weight) as min_weight,
              modid || ' (' || GROUP_CONCAT(version, '/') || ')' as mod_with_ver,
              /* 使用 DISTINCT 移除重复的 Key，只保留唯一的 Key */
              GROUP_CONCAT(DISTINCT "key") as unique_keys, 
              /* 同理，Curseforge ID 通常也是一样的，也可以去重 */
              GROUP_CONCAT(DISTINCT COALESCE(curseforge, '')) as unique_cfs
            FROM RankedMatches
            GROUP BY trans_name, origin_name, modid
          )
          SELECT 
            trans_name, 
            origin_name,
            GROUP_CONCAT(mod_with_ver, ', ') AS all_mods,
            /* 这里的 unique_keys 已经去重，如果该模组只有一个 Key，结果就不含分隔符 */
            GROUP_CONCAT(REPLACE(unique_keys, ',', '|'), ',') AS all_keys,
            GROUP_CONCAT(REPLACE(unique_cfs, ',', '|'), ',') AS all_curseforges,
            COUNT(*) AS frequency
          FROM ModBundles
          GROUP BY trans_name, origin_name
          ORDER BY MIN(min_weight) DESC, frequency DESC, origin_name
          LIMIT 50 OFFSET ?;
        `

        const countQuery = `
          SELECT COUNT(*) as total
          FROM (
            SELECT 1 FROM dict_fts
            WHERE dict_fts MATCH ?
            GROUP BY origin_name, trans_name
          );
        `

        const [resultsData, countResult] = await Promise.all([
          env.DB.prepare(resultsQuery).bind(query.trim(), searchTermFts, offset).all(),
          env.DB.prepare(countQuery).bind(searchTermFts).first(),
        ])

        const response = jsonResponse({
          query,
          results: resultsData.results || [],
          total: countResult?.total || 0,
          page,
          mode,
        })

        ctx.waitUntil(cache.put(cacheKey, response.clone(), { expirationTtl: cacheTtl }))
        return response
      } catch (err) {
        console.error('Database query failed:', err)
        return jsonResponse({ error: '数据库查询失败', details: err.message }, 500)
      }
    }

    return new Response('Not Found', { status: 404, headers: headers })
  },
}
