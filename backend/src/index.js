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

    const cacheTtl = 60 * 60 * 24 * 6; // 缓存6天
    const cache = caches.default;

    if (path === "/search") {
      const query = queryParams.get("q");
      const page = parseInt(queryParams.get("page")) || 1;
      const mode = queryParams.get("mode") || "en2zh"; // 默认为英译中
      const offset = (page - 1) * 50;

      if (!query || query.trim() === "") {
        return new Response(JSON.stringify({ error: "查询参数不能为空" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      
      const searchTerm = query.trim().toLowerCase();
      const likePattern = `${searchTerm}%`;
      const searchColumn = mode === 'en2zh' ? 'origin_name' : 'trans_name';

      // 使用完整的请求URL作为缓存键，确保分页结果被正确缓存
      const cacheKey = new Request(request.url, request);
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const aliasedSearchColumnLower = `LOWER(d.${searchColumn})`;
        const searchColumnLower = `LOWER(${searchColumn})`;
        
        const resultsQuery = `
          WITH Frequencies AS (
            SELECT
              origin_name,
              trans_name,
              COUNT(*) AS frequency
            FROM dict
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
                WHEN ${aliasedSearchColumnLower} = ? THEN 3
                ELSE 2
              END AS match_weight,
              ROW_NUMBER() OVER(PARTITION BY d.origin_name, d.trans_name ORDER BY d.version DESC) as rn
            FROM dict d
            JOIN Frequencies f ON d.origin_name = f.origin_name AND d.trans_name = f.trans_name
            WHERE ${aliasedSearchColumnLower} LIKE ?
          )
          SELECT *
          FROM RankedMatches
          WHERE rn = 1
          ORDER BY match_weight DESC, frequency DESC, origin_name
          LIMIT 50 OFFSET ?;
        `;

        // 统计唯一的翻译对数量
        const countQuery = `
          SELECT COUNT(*) as total FROM (
            SELECT DISTINCT origin_name, trans_name
            FROM dict
            WHERE ${searchColumnLower} LIKE ?
          );
        `;

        const resultsPromise = env.DB.prepare(resultsQuery)
          .bind(searchTerm, likePattern, offset)
          .all();

        const countPromise = env.DB.prepare(countQuery)
          .bind(likePattern)
          .first();

        const [resultsData, countResult] = await Promise.all([
          resultsPromise,
          countPromise,
        ]);

        const total = countResult ? countResult.total : 0;
        const results = resultsData.results || [];

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