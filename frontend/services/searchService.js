import {
  useStore,
  updateState,
  MIN_INTERVAL,
  itemsPerPage,
  MAX_QUERY_LENGTH,
  PAGE_CACHE_SIZE,
} from '../store.js'
import { matchesModFilter, setupModFilter } from '../utils.js'
import { requestSearch } from './apiClient.js'

const pageCache = new Map()
let activeSearchController = null

function getSearchContext(store, resetPage) {
  const query = store.searchQuery.trim()
  const mode = store.searchMode
  const modFilter = store.modFilterValue.trim()
  const page = resetPage ? 1 : store.currentPage

  return { query, mode, modFilter, page }
}

function validateSearchQuery(query) {
  if (!query) return '请输入有效的搜索词'
  if (query.length > MAX_QUERY_LENGTH) return `搜索词长度不能超过${MAX_QUERY_LENGTH}个字符`
  return null
}

function buildSearchKey({ query, mode, page, modFilter }) {
  return `${query}_${mode}_${page}_${modFilter}`
}

function buildPageKey({ query, mode, page }) {
  return `${query}::${mode}::${page}`
}

function getFilteredResults(results, selectedMod) {
  return results.filter((item) => matchesModFilter(item, selectedMod))
}

function updateCurrentPageResults(results, page) {
  const startIndex = (page - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  updateState({ currentApiResults: results.slice(startIndex, endIndex) })
}

function setPageCache(key, value) {
  if (pageCache.has(key)) pageCache.delete(key)
  pageCache.set(key, value)

  if (pageCache.size > PAGE_CACHE_SIZE) {
    const oldestKey = pageCache.keys().next().value
    pageCache.delete(oldestKey)
  }
}

function invalidateCacheByQuery(query, mode) {
  const prefix = `${query}::${mode}::`
  for (const key of pageCache.keys()) {
    if (key.startsWith(prefix)) {
      pageCache.delete(key)
    }
  }
}

async function getPageData({ query, mode, page, signal, force = false }) {
  const cacheKey = buildPageKey({ query, mode, page })

  if (!force && pageCache.has(cacheKey)) {
    return pageCache.get(cacheKey)
  }

  const data = await requestSearch({ query, page, mode, signal })
  setPageCache(cacheKey, data)
  return data
}

function resetSearchStateIfNeeded(store, query, mode) {
  const [lastQuery, lastMode] = store.lastFullSearchKey.split('_')
  if (lastQuery !== query || lastMode !== mode) {
    updateState({ modFilterValue: '', allApiResults: [] })
    return []
  }
  return store.allApiResults
}

function abortActiveSearch() {
  if (activeSearchController) {
    activeSearchController.abort()
  }
  activeSearchController = new AbortController()
  return activeSearchController.signal
}

async function fetchAllResults(selectedMod) {
  const store = useStore()
  const { query, mode, page } = getSearchContext(store, false)
  const totalPages = Math.ceil(store.totalApiMatches / itemsPerPage)
  const signal = abortActiveSearch()

  updateState({ resultsUiMessage: '正在获取所有结果，请稍候...', searchInfoMessage: '' })

  try {
    const allResults = [
      ...(page === 1 && store.currentApiResults.length ? store.currentApiResults : []),
    ]
    const existingKeys = new Set(allResults.map((item) => item.key))

    const pagesToFetch = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
      (targetPage) => !(targetPage === page && store.currentApiResults.length),
    )

    const allPageResults = await Promise.all(
      pagesToFetch.map((targetPage) =>
        getPageData({ query, page: targetPage, mode, signal }).then((data) => data?.results ?? []),
      ),
    )

    allPageResults.flat().forEach((item) => {
      if (!existingKeys.has(item.key)) {
        allResults.push(item)
        existingKeys.add(item.key)
      }
    })

    setupModFilter(allResults, updateState)

    const filtered = getFilteredResults(allResults, selectedMod)
    updateState({
      allApiResults: allResults,
      currentPage: 1,
      totalApiMatches: filtered.length,
      resultsUiMessage: filtered.length === 0 ? '当前模组筛选下未找到结果。' : '',
    })

    updateCurrentPageResults(filtered, 1)
  } catch (err) {
    if (err?.name === 'AbortError') return

    console.error('获取所有结果失败:', err)
    updateState({ resultsUiMessage: '获取所有结果失败，请重试。', totalApiMatches: 0 })
  } finally {
    updateState({ searchLoading: false })
  }
}

export function applyModFilter() {
  const store = useStore()
  const selectedMod = store.modFilterValue.trim()

  if (!store.searchQuery.trim()) return

  if (selectedMod) {
    if (store.allApiResults.length === 0 || store.allApiResults.length < store.totalApiMatches) {
      if (!store.searchLoading) fetchAllResults(selectedMod)
      return
    }

    const filtered = getFilteredResults(store.allApiResults, selectedMod)
    updateState({
      totalApiMatches: filtered.length,
      resultsUiMessage: filtered.length === 0 ? '当前模组筛选下未找到结果。' : '',
    })
    updateCurrentPageResults(filtered, store.currentPage)
    return
  }

  updateState({
    resultsUiMessage: store.totalApiMatches === 0 ? '未找到结果' : '',
  })
}

export async function search(resetPage = false) {
  const store = useStore()
  const context = getSearchContext(store, resetPage)

  if (resetPage) {
    const allApiResults = resetSearchStateIfNeeded(store, context.query, context.mode)
    context.page = 1
    updateState({ currentPage: 1, allApiResults })
  }

  const validationError = validateSearchQuery(context.query)
  if (validationError) {
    updateState({ resultsUiMessage: validationError, totalApiMatches: 0 })
    return
  }

  const searchKey = buildSearchKey(context)
  if (searchKey === store.lastFullSearchKey && !resetPage) return

  const now = Date.now()
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
    const data = await getPageData({
      query: context.query,
      page: context.page,
      mode: context.mode,
      signal,
      force: false,
    })

    updateState({
      searchInfoMessage: `搜索耗时: ${(performance.now() - requestStartTime).toFixed(0)} 毫秒`,
    })

    const pageResults = data?.results ?? []
    if (pageResults.length === 0) {
      updateState({
        resultsUiMessage: '未找到结果',
        totalApiMatches: 0,
        currentApiResults: [],
        availableMods: [],
        lastFullSearchKey: searchKey,
      })
      return
    }

    const existing = context.page === 1 ? [] : store.allApiResults
    const existingKeys = new Set(existing.map((item) => item.key))
    const merged = context.page === 1 ? [...pageResults] : [...existing]

    pageResults.forEach((item) => {
      if (!existingKeys.has(item.key)) {
        merged.push(item)
        existingKeys.add(item.key)
      }
    })

    updateState({
      currentApiResults: pageResults,
      totalApiMatches: data.total,
      allApiResults: merged,
      resultsUiMessage: '',
      lastFullSearchKey: searchKey,
    })

    setupModFilter(context.modFilter ? merged : pageResults, updateState)
    applyModFilter()
  } catch (error) {
    if (error?.name === 'AbortError') return

    invalidateCacheByQuery(context.query, context.mode)
    console.error('查询失败:', error)
    updateState({
      resultsUiMessage: '查询失败，请检查网络或联系作者（Github Issue）。',
      totalApiMatches: 0,
      currentApiResults: [],
      searchInfoMessage: '',
    })
  } finally {
    updateState({ searchLoading: false })
  }
}
