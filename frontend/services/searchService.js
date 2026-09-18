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

function getSearchContext(store, resetPage) {
  return {
    query: store.searchQuery.trim(),
    mode: store.searchMode,
    modFilter: store.modFilterValue.trim(),
    page: resetPage ? 1 : store.currentPage,
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
  if (pageCache.has(cacheKey)) return pageCache.get(cacheKey)

  const data = await requestSearch({ ...context, signal })
  setPageCache(cacheKey, data)
  return data
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
    updateState({ modFilterValue: '', availableMods: [] })
  }
}

export function applyModFilter() {
  if (!useStore().searchQuery.trim()) return
  search(true)
}

export async function search(resetPage = false) {
  const store = useStore()
  if (store.searchLoading) return

  const context = getSearchContext(store, resetPage)

  if (resetPage) {
    resetModFilterForNewSearch(context)
    context.page = 1
    updateState({ currentPage: 1 })
  }

  const validationError = validateSearchQuery(context.query)
  if (validationError) {
    updateState({
      resultsUiMessage: validationError,
      totalApiMatches: 0,
      hasMoreResults: false,
    })
    return
  }

  const searchKey = buildSearchKey(context)
  const now = Date.now()
  if (searchKey === store.lastFullSearchKey) return
  if (now - store.lastSearchTime < MIN_INTERVAL && !resetPage) return

  const signal = abortActiveSearch()
  updateState({
    lastSearchTime: now,
    searchLoading: true,
    resultsUiMessage: '正在搜索中...',
    searchInfoMessage: '',
    lastSearchQuery: context.query,
  })

  const requestStartTime = performance.now()

  try {
    const data = await getPageData(context, signal)
    const pageResults = data?.results ?? []
    const hasMore =
      typeof data?.hasMore === 'boolean'
        ? data.hasMore
        : pageResults.length === itemsPerPage && data.total > context.page * itemsPerPage
    const rowsRead = data?.usage?.rowsRead
    const timing = `搜索耗时: ${(performance.now() - requestStartTime).toFixed(0)} 毫秒`

    updateState({
      searchInfoMessage:
        Number.isFinite(rowsRead) && rowsRead >= 0
          ? `${timing}，数据库读取: ${rowsRead} 行`
          : timing,
      currentApiResults: pageResults,
      totalApiMatches: data?.total ?? (context.page - 1) * itemsPerPage + pageResults.length,
      hasMoreResults: hasMore,
      allApiResults: pageResults,
      resultsUiMessage: pageResults.length === 0 ? '未找到结果' : '',
      lastFullSearchKey: searchKey,
    })

    // Suggestions come from the current page. Selecting one now asks the server
    // for that mod directly instead of downloading every result page in parallel.
    if (!context.modFilter) setupModFilter(pageResults, updateState)
  } catch (error) {
    if (error?.name === 'AbortError') return

    invalidateCache(context)
    console.error('查询失败:', error)
    updateState({
      resultsUiMessage: '查询失败，请检查网络或联系作者（Github Issue）。',
      totalApiMatches: 0,
      hasMoreResults: false,
      currentApiResults: [],
      searchInfoMessage: '',
    })
  } finally {
    updateState({ searchLoading: false })
  }
}
