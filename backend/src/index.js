export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const queryParams = url.searchParams;

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const cacheTtl = 60 * 60 * 24 * 6; // Cache for 6 days
    const cache = caches.default;

    if (path === "/search") {
      const query = queryParams.get("q");
      const page = parseInt(queryParams.get("page")) || 1;
      const mode = queryParams.get("mode") || "en2zh"; // Default to English-to-Chinese
      const offset = (page - 1) * 50;

      if (!query) {
        return new Response(JSON.stringify({ error: "查询参数不能为空" }), {
          status: 400,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      const rawWords = query.trim().toLowerCase().split(/\s+/);
      const likePatterns = rawWords.map((w) => `${w}%`);

      const normalizedUrl = new URL(request.url);
      normalizedUrl.searchParams.set("q", query.trim().toLowerCase());
      const cacheKey = new Request(normalizedUrl.toString(), { method: "GET" });

      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const sqlLike = likePatterns
          .map(() =>
            mode === "en2zh"
              ? "LOWER(origin_name) LIKE ?"
              : "LOWER(trans_name) LIKE ?"
          )
          .join(" OR ");

        const resultsQuery = `
          SELECT trans_name, origin_name, modid, version, key, curseforge, COUNT(*) AS frequency,
            CASE
              WHEN ${
                mode === "en2zh" ? "LOWER(origin_name)" : "LOWER(trans_name)"
              } = ? THEN 3
              WHEN ${sqlLike} THEN 2
              ELSE 1
            END AS match_weight
          FROM dict
          WHERE ${sqlLike}
          GROUP BY trans_name, origin_name, modid, version, key, curseforge
          ORDER BY match_weight DESC, frequency DESC
          LIMIT 50 OFFSET ?
        `;

        const countQuery = `
          SELECT COUNT(*) AS total
          FROM dict
          WHERE ${sqlLike}
        `;

        const resultsPromise = env.DB.prepare(resultsQuery)
          .bind(
            query.trim().toLowerCase(),
            ...likePatterns,
            ...likePatterns,
            offset
          )
          .all();

        const countPromise = env.DB.prepare(countQuery)
          .bind(...likePatterns)
          .first();

        const [results, countResult] = await Promise.all([
          resultsPromise,
          countPromise,
        ]);

        const response = new Response(
          JSON.stringify({
            query,
            results,
            total: countResult.total,
            mode,
          }),
          {
            headers: { ...headers, "Content-Type": "application/json" },
          }
        );

        await cache.put(cacheKey, response.clone(), {
          expirationTtl: cacheTtl,
        });
        return response;
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};
