export const MIN_INTERVAL = 1000; // 搜索最小间隔时间（毫秒）
export const itemsPerPage = 50; // 每页显示的项目数量
export const API_BASE_URL = "https://api.vmct-cn.top"; // API 基础 URL
export const API_SEARCH_MCMOD = "https://search.mcmod.cn/s?key="; // MC百科搜索 API

export const $ = id => document.getElementById(id);

export const DOM = {
  searchButton: $("searchButton"),
  searchInfo: $("searchInfo"),
  searchInput: $("searchInput"),
  searchMode: $("searchMode"),
  resultsBody: $("resultsBody"),
  pagination: $("pagination"),
  changelogLink: $("changelogLink"),
  changelogBody: $("changelogBody"),
  modFilter: $("modFilter"),
  filterContainer: $("filterContainer"),
  modSuggestions: $("modSuggestions"),
};

export let lastSearchTime = 0; // 上次搜索时间戳
export let lastFullSearchKey = ""; // 存储上一次完整搜索的唯一标识
export let currentPage = 1; // 当前页码
export let changelogFetched = false;
export let changelogData = [];
export let changelogModal;

export let currentApiResults = []; // 存储当前页从API获取的原始结果
export let totalApiMatches = 0; // 存储API返回的总匹配条目数
export let allApiResults = []; // 存储所有页面的结果（用于模组筛选）
export let availableMods = []; // 存储当前页可用的模组列表

export function updateState(newState) {
  if (newState.lastSearchTime !== undefined) lastSearchTime = newState.lastSearchTime;
  if (newState.lastFullSearchKey !== undefined) lastFullSearchKey = newState.lastFullSearchKey;
  if (newState.currentPage !== undefined) currentPage = newState.currentPage;
  if (newState.changelogFetched !== undefined) changelogFetched = newState.changelogFetched;
  if (newState.changelogData !== undefined) changelogData = newState.changelogData;
  if (newState.changelogModal !== undefined) changelogModal = newState.changelogModal;
  if (newState.currentApiResults !== undefined) currentApiResults = newState.currentApiResults;
  if (newState.totalApiMatches !== undefined) totalApiMatches = newState.totalApiMatches;
  if (newState.allApiResults !== undefined) allApiResults = newState.allApiResults;
  if (newState.availableMods !== undefined) availableMods = newState.availableMods;
}

export function getCurrentState() {
  return {
    lastSearchTime,
    lastFullSearchKey,
    currentPage,
    changelogFetched,
    changelogData,
    changelogModal,
    currentApiResults,
    totalApiMatches,
    allApiResults,
    availableMods
  };
}