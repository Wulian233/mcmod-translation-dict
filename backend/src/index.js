export default { 
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname: path, searchParams } = url;

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Content-Type-Options": "nosniff",
    };

    const jsonResponse = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...headers, "Content-Type": "application/json" },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: headers });
    }

    const cache = caches.default;
    const cacheTtl = 60 * 60 * 24 * 7; // 7天

    function validateQuery(q) {
      if (!q || q.trim() === "") return "查询参数不能为空";
      if (q.length > 50) return "搜索词长度不能超过50个字符";
      return null;
    }

    function parseAdvancedQuery(raw, column) {
      const terms = [], exclude = [], fts = [];
      const pattern = /"([^"]+)"|\S+/g;
      let match;

      while ((match = pattern.exec(raw)) !== null) {
        if (match[1]) {
          const phrase = match[1];
          if (/[\u4e00-\u9fa5]/.test(phrase)) {
            fts.push(`(${column}:"${phrase}" OR ${column}:${phrase}*)`);
          } else {
            fts.push(`${column}:"${phrase}"`);
          }
        } else {
          const word = match[0];
          if (word.startsWith("-")) {
            exclude.push(word.slice(1));
          } else if (word.endsWith("*")) {
            terms.push(`${column}:${word}`);
          } else if (word.endsWith("+")) {
            const base = word.slice(0, -1);
            terms.push(`${column}:${base}*`);
            exclude.push(base);
          } else if (/[\u4e00-\u9fa5]/.test(word)) {
            fts.push(`(${column}:"${word}" OR ${column}:${word}*)`);
          } else {
            terms.push(`${column}:"${word}"`);
          }
        }
      }

      if (terms.length) fts.push(...terms);
      if (exclude.length) fts.push(...exclude.map(w => `NOT ${column}:${w}`));
      return fts.join(" ");
    }

    if (path === "/search") {
      const query = searchParams.get("q");
      const page = parseInt(searchParams.get("page")) || 1;
      const mode = searchParams.get("mode") || "en2zh";
      const offset = (page - 1) * 50;

      const error = validateQuery(query);
      if (error) return jsonResponse({ error }, 400);

      const searchColumn = mode === "en2zh" ? "origin_name" : "trans_name";
      const searchTermFts = parseAdvancedQuery(query.trim(), searchColumn);

      const cacheKey = new Request(request.url, request);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      try {
        const resultsQuery = `
          WITH RankedMatches AS (
            SELECT
              d.trans_name, d.origin_name, d.modid, d.version, d.key, d.curseforge,
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
              trans_name, origin_name, modid,
              MIN(match_weight) AS min_match_weight_mod,
              GROUP_CONCAT(version) AS versions,
              GROUP_CONCAT("key") AS keys,
              GROUP_CONCAT(curseforge) AS curseforges
            FROM RankedMatches
            GROUP BY trans_name, origin_name, modid
          )
          SELECT
            am.trans_name, am.origin_name,
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
          env.DB.prepare(resultsQuery).bind(query.trim(), searchTermFts, offset).all(),
          env.DB.prepare(countQuery).bind(searchTermFts).first()
        ]);

        const response = jsonResponse({
          query,
          results: resultsData.results || [],
          total: countResult?.total || 0,
          page,
          mode,
        });

        ctx.waitUntil(cache.put(cacheKey, response.clone(), { expirationTtl: cacheTtl }));
        return response;

      } catch (err) {
        console.error("Database query failed:", err);
        return jsonResponse({ error: "数据库查询失败", details: err.message }, 500);
      }
    }

    return new Response("Not Found", { status: 404, headers: headers });
  },
};
