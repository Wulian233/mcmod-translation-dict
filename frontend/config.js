export const SEARCH_CONFIG = {
  minIntervalMs: 1000,
  itemsPerPage: 50,
  maxQueryLength: 50,
  pageCacheSize: 120,
}

export const API_CONFIG = {
  // The dictionary API is served by the new ECS site on the same domain.
  baseUrl: '/api/dict',
  mcmodSearchUrl: 'https://search.mcmod.cn/s?key=',
}
