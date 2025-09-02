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

      const searchColumn = mode === "en2zh" ? "origin_name" : "trans_name";
      const searchTermFts = `${searchColumn}:"${query.trim()}*"`;
      const exactMatchTerm = query.trim();

      const cacheKey = new Request(request.url, request);
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }

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
                WHEN dict_fts.rank = 0 THEN 2
                ELSE 1
              END AS match_weight,
              dict_fts.rank AS fts_rank
            FROM dict AS d
            JOIN dict_fts ON d.rowid = dict_fts.rowid
            WHERE dict_fts MATCH ?
          ),
          AggregatedMods AS (
            SELECT
                trans_name,
                origin_name,
                modid,
                MIN(match_weight) AS min_match_weight_mod,
                GROUP_CONCAT(version) AS versions,
                GROUP_CONCAT("key") AS keys,
                GROUP_CONCAT(curseforge) AS curseforges
            FROM RankedMatches
            GROUP BY trans_name, origin_name, modid
          )
          SELECT
            am.trans_name,
            am.origin_name,
            GROUP_CONCAT(am.modid || " (" || am.versions || ")", ", ") AS all_mods,
            GROUP_CONCAT(am.keys) AS all_keys,
            GROUP_CONCAT(am.curseforges) AS all_curseforges,
            COUNT(*) AS frequency
          FROM AggregatedMods AS am
          GROUP BY am.trans_name, am.origin_name
          ORDER BY MIN(am.min_match_weight_mod) DESC, COUNT(*) DESC, am.origin_name
          LIMIT 50 OFFSET ?;
        `;

        const countQuery = `
          SELECT COUNT(*) as total
          FROM (
            SELECT 1 FROM dict_fts
            WHERE dict_fts MATCH ?
            GROUP BY origin_name, trans_name
          );
        `;

        const [resultsData, countResult] = await Promise.all([
          env.DB.prepare(resultsQuery).bind(exactMatchTerm, searchTermFts, offset).all(),
          env.DB.prepare(countQuery).bind(searchTermFts).first()
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