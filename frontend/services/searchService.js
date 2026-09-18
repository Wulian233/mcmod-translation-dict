import {
  useStore,
  updateState,
  MIN_INTERVAL,
  itemsPerPage,
  MAX_QUERY_LENGTH,
  PAGE_CACHE_SIZE,
} from '../store.js'
import { setupModFilter } from '../utils.js'
import { requestSearch } from './apiClient.js'

const pageCache = new Map()
let activeSearchController = null

function searchResult(status, extra = {}) {
  return { status, accepted: status === 'accepted', ...extra }
}

function getSearchContext(store, resetPage, requestedPage) {
  return {
    query: store.searchQuery.trim(),
    mode: store.searchMode,
    modFilter: store.modFilterValue.trim(),
    page: resetPage ? 1 : (requestedPage ?? store.currentPage),
  }
}

function validateSearchQuery(query) {
  if (!query) return '请输入有效的搜索词'
  if (query.length > MAX_QUERY_LENGTH) return `搜索词长度不能超过${MAX_QUERY_LENGTH}个字符`
  return null
}

function buildSearchKey({ query, mode, page, modFilter }) {
  return JSON.stringify([query, mode, page, modFilter])
}

function buildPageKey({ query, mode, page, modFilter }) {
  return JSON.stringify([query, mode, page, modFilter])
}

function setPageCache(key, value) {
  if (pageCache.has(key)) pageCache.delete(key)
  pageCache.set(key, value)

  if (pageCache.size > PAGE_CACHE_SIZE) {
    pageCache.delete(pageCache.keys().next().value)
  }
}

function invalidateCache(context) {
  pageCache.delete(buildPageKey(context))
}

async function getPageData(context, signal) {
  const cacheKey = buildPageKey(context)
  if (pageCache.has(cacheKey)) {
    return { data: pageCache.get(cacheKey), cached: true }
  }

  const data = await requestSearch({ ...context, signal })
  setPageCache(cacheKey, data)
  return { data, cached: false }
}

function abortActiveSearch() {
  activeSearchController?.abort()
  activeSearchController = new AbortController()
  return activeSearchController.signal
}

function resetModFilterForNewSearch(context) {
  let lastQuery = ''
  let lastMode = ''

  try {
    ;[lastQuery, lastMode] = JSON.parse(useStore().lastFullSearchKey || '[]')
  } catch {
    // An invalid old cache key should behave like a new search.
  }

  if (lastQuery !== context.query || lastMode !== context.mode) {
    context.modFilter = ''
    return true
  }
  return false
}

export function applyModFilter() {
  if (!useStore().searchQuery.trim()) {
    return Promise.resolve(searchResult('invalid'))
  }
  return search(true)
}

export async function search(resetPage = false, requestedPage) {
  const store = useStore()
  if (store.searchLoading) return searchResult('busy')

  const context = getSearchContext(store, resetPage, requestedPage)

  const newSearch = resetPage && resetModFilterForNewSearch(context)

  if (!Number.isInteger(context.page) || context.page < 1) {
    return searchResult('invalid')
  }

  const validationError = validateSearchQuery(context.query)
  if (validationError) {
    updateState({
      ...(newSearch ? { modFilterValue: '', appliedModFilter: '', availableMods: [] } : {}),
      currentPage: resetPage ? 1 : store.currentPage,
      currentApiResults: resetPage ? [] : store.currentApiResults,
      resultsUiMessage: validationError,
      searchInfoMessage: resetPage ? '' : store.searchInfoMessage,
      totalApiMatches: resetPage ? null : store.totalApiMatches,
      totalIsExact: false,
      hasMoreResults: resetPage ? false : store.hasMoreResults,
      pageLimitReached: resetPage ? false : store.pageLimitReached,
    })
    return searchResult('invalid')
  }

  const searchKey = buildSearchKey(context)
  const cacheKey = buildPageKey(context)
  const isCached = pageCache.has(cacheKey)
  const now = Date.now()

  if (!resetPage && searchKey === store.lastFullSearchKey) {
    return searchResult('unchanged', { cached: isCached })
  }

  // Cached pages are safe to restore immediately, including after validation
  // errors. Only a new network request is subject to the minimum interval.
  if (!isCached && now - store.lastSearchTime < MIN_INTERVAL) {
    updateState({ searchInfoMessage: '请求过于频繁，请稍后再试。' })
    return searchResult('throttled')
  }

  const signal = abortActiveSearch()
  updateState({
    ...(newSearch ? { modFilterValue: '', appliedModFilter: '', availableMods: [] } : {}),
    ...(isCached ? {} : { lastSearchTime: now }),
    searchLoading: true,
    resultsUiMessage: '正在搜索中...',
    searchInfoMessage: '',
    lastSearchQuery: context.query,
    currentPage: resetPage ? 1 : store.currentPage,
    currentApiResults: resetPage ? [] : store.currentApiResults,
    pageLimitReached: resetPage ? false : store.pageLimitReached,
  })

  const requestStartTime = performance.now()

  try {
    const { data, cached } = await getPageData(context, signal)
    const pageResults = data?.results ?? []
    const pageLimitReached = data?.pageLimitReached === true
    const hasMore = pageLimitReached
      ? false
      : typeof data?.hasMore === 'boolean'
        ? data.hasMore
        : pageResults.length === itemsPerPage
    const timing = cached
      ? '已从缓存恢复'
      : `搜索耗时: ${(performance.now() - requestStartTime).toFixed(0)} 毫秒`

    updateState({
      searchInfoMessage: timing,
      currentPage: context.page,
      currentApiResults: pageResults,
      totalApiMatches: typeof data?.total === 'number' ? data.total : null,
      totalIsExact: data?.totalIsExact === true,
      hasMoreResults: hasMore,
      pageLimitReached,
      appliedModFilter: data?.mod ?? context.modFilter,
      resultsUiMessage: pageResults.length === 0 ? '未找到结果' : '',
      lastFullSearchKey: searchKey,
    })

    // Suggestions come from the current unfiltered page. Filtered responses
    // intentionally keep the server-provided metadata and global frequency.
    if (!context.modFilter) setupModFilter(pageResults, updateState)

    return searchResult('accepted', { cached })
  } catch (error) {
    if (error?.name === 'AbortError') return searchResult('aborted')

    invalidateCache(context)
    console.error('查询失败:', error)
    updateState({
      resultsUiMessage: error?.message || '查询失败，请检查网络或联系作者（Github Issue）。',
      totalApiMatches: resetPage ? null : store.totalApiMatches,
      totalIsExact: false,
      hasMoreResults: resetPage ? false : store.hasMoreResults,
      pageLimitReached: resetPage ? false : store.pageLimitReached,
      currentApiResults: resetPage ? [] : store.currentApiResults,
      searchInfoMessage: '',
    })
    return searchResult('error', { error })
  } finally {
    updateState({ searchLoading: false })
  }
}
