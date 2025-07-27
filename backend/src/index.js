export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const queryParams = url.searchParams;

    // 为CORS提供标准响应头
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const cacheTtl = 60 * 60 * 24 * 7; // 缓存7天
    const cache = caches.default;

    if (path === "/search") {
      const query = queryParams.get("q");
      const page = parseInt(queryParams.get("page")) || 1;
      const mode = queryParams.get("mode") || "en2zh";
      const offset = (page - 1) * 50;

      if (!query || query.trim() === "") {
        return new Response(JSON.stringify({ error: "查询参数不能为空" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      if (query.length > 50) {
        return new Response(JSON.stringify({ error: "搜索词长度不能超过50个字符" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      const searchTerm = query.trim().toLowerCase();
      const likePattern = `${searchTerm}%`;
      const searchColumn = mode === 'en2zh' ? 'origin_name' : 'trans_name';

      const cacheKey = new Request(request.url, request);
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) return cachedResponse;

      try {
        const resultsQuery = `
          WITH FilteredDict AS (
            SELECT origin_name, trans_name, modid, version, key, curseforge
            FROM dict
            WHERE LOWER(${searchColumn}) LIKE ?
          ),
          Frequencies AS (
            SELECT origin_name, trans_name, COUNT(*) AS frequency
            FROM FilteredDict
            GROUP BY origin_name, trans_name
          ),
          RankedMatches AS (
            SELECT
              d.trans_name,
              d.origin_name,
              d.modid,
              d.version,
              d.key,
              d.curseforge,
              f.frequency,
              CASE
                WHEN LOWER(d.${searchColumn}) = ? THEN 3 ELSE 2
              END AS match_weight,
              ROW_NUMBER() OVER (PARTITION BY d.origin_name, d.trans_name ORDER BY d.version DESC) AS rn
            FROM FilteredDict d
            JOIN Frequencies f ON d.origin_name = f.origin_name AND d.trans_name = f.trans_name
          )
          SELECT
            trans_name, origin_name, modid, version, key, curseforge, frequency
          FROM RankedMatches
          WHERE rn = 1
          ORDER BY match_weight DESC, frequency DESC, origin_name
          LIMIT 50 OFFSET ?;
        `;

        const countQuery = `
          SELECT COUNT(*) as total FROM (
            SELECT 1 FROM dict
            WHERE LOWER(${searchColumn}) LIKE ?
            GROUP BY origin_name, trans_name
          );
        `;

        const [resultsData, countResult] = await Promise.all([
          env.DB.prepare(resultsQuery).bind(likePattern, searchTerm, offset).all(),
          env.DB.prepare(countQuery).bind(likePattern).first()
        ]);

        const results = resultsData.results || [];
        const total = countResult ? countResult.total : 0;

        const responseData = {
          query,
          results,
          total,
          page,
          mode,
        };

        const response = new Response(JSON.stringify(responseData), {
          headers: { ...headers, "Content-Type": "application/json" },
        });

        // 将缓存操作放入后台执行，不阻塞响应返回
        ctx.waitUntil(cache.put(cacheKey, response.clone(), {
          expirationTtl: cacheTtl,
        }));

        return response;

      } catch (err) {
        console.error("Database query failed:", err);
        return new Response(JSON.stringify({ error: "数据库查询失败", details: err.message }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404, headers });
  },
};