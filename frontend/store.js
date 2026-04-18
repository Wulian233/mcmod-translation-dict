import { reactive, readonly } from 'vue'
import { API_CONFIG, SEARCH_CONFIG } from './config.js'

// 搜索配置常量
export const MIN_INTERVAL = SEARCH_CONFIG.minIntervalMs // 搜索最小间隔时间（毫秒）
export const itemsPerPage = SEARCH_CONFIG.itemsPerPage // 每页显示的项目数量
export const MAX_QUERY_LENGTH = SEARCH_CONFIG.maxQueryLength // 搜索词长度上限

// API 配置常量
export const API_BASE_URL = API_CONFIG.baseUrl // API 基础 URL
export const API_SEARCH_MCMOD = API_CONFIG.mcmodSearchUrl // MC百科搜索 API
export const PAGE_CACHE_SIZE = SEARCH_CONFIG.pageCacheSize // 前端页面缓存上限

const state = reactive({
  // 搜索状态
  lastSearchTime: 0, // 上次搜索时间戳
  lastFullSearchKey: '', // 存储上一次完整搜索的唯一标识
  currentPage: 1, // 当前页码
  searchQuery: '', // 搜索输入框的值
  lastSearchQuery: '', // 上一次执行搜索时的搜索词（用于高亮）
  searchMode: 'en2zh', // 搜索模式
  modFilterValue: '', // 模组筛选输入框的值

  // 结果状态
  currentApiResults: [], // 存储当前页从 API 获取的原始结果
  totalApiMatches: 0, // 存储 API 返回的总匹配条目数
  allApiResults: [], // 存储所有页面的结果（用于模组筛选）
  availableMods: [], // 存储当前搜索结果中所有可用的模组列表（按频率排序）

  // UI 状态
  changelogFetched: false,
  changelogData: [],
  changelogModal: null, // 存储 Modal 实例
  searchLoading: false, // 搜索加载状态
  searchInfoMessage: '', // 搜索耗时等信息
  resultsUiMessage: '请输入搜索词进行查询', // 结果表格中的提示信息
})

export function useStore() {
  return readonly(state)
}

export function updateState(newState) {
  Object.assign(state, newState)
}
