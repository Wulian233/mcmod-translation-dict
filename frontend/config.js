export const SEARCH_CONFIG = {
  minIntervalMs: 1000,
  itemsPerPage: 50,
  maxQueryLength: 50,
  pageCacheSize: 120,
}

export const API_CONFIG = {
  baseUrl: (import.meta.env?.VITE_API_BASE_URL?.trim() || 'https://api.vmct-cn.top').replace(
    /\/+$/,
    '',
  ),
  mcmodSearchUrl: 'https://search.mcmod.cn/s?key=',
}
