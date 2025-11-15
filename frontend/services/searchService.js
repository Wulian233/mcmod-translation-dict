import { 
  useStore, updateState, MIN_INTERVAL, API_BASE_URL, itemsPerPage 
} from '../store.js';
import { matchesModFilter, setupModFilter } from '../utils.js';

async function fetchAllResults(selectedMod) {
  const store = useStore();
  const query = store.searchQuery.trim();
  const mode = store.searchMode;
  const { totalApiMatches, currentApiResults, currentPage } = store;
  const totalPages = Math.ceil(totalApiMatches / itemsPerPage);

  updateState({ resultsUiMessage: "正在获取所有结果，请稍候...", searchInfoMessage: '' });

  try {
    // 收集已经获取的第一页数据（如果存在）
    const allResults = [...(currentPage === 1 && currentApiResults.length ? currentApiResults : [])];
    const existingKeys = new Set(allResults.map(r => r.key));

    // 过滤掉已经拥有的页面，并发请求其他页面
    const pagesToFetch = Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(page => !(page === currentPage && currentApiResults.length));

    const promises = pagesToFetch.map(page =>
      fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${page}&mode=${mode}`)
        .then(res => {
          if (!res.ok) throw new Error(`页面 ${page} 获取失败`);
          return res.json();
        })
        .then(data => data?.results ?? [])
    );

    const results = (await Promise.all(promises)).flat();

    // 合并结果并去重
    results.forEach(item => {
      if (!existingKeys.has(item.key)) {
        allResults.push(item);
        existingKeys.add(item.key);
      }
    });

    updateState({ allApiResults: allResults, currentPage: 1 });
    
    // 应用模组筛选并显示第一页
    const filtered = allResults.filter(item => matchesModFilter(item, selectedMod));

    if (!filtered.length) {
      updateState({ resultsUiMessage: "当前模组筛选下未找到结果。", totalApiMatches: 0 });
      return;
    }

    // 重新设置模组筛选器（基于所有结果）
    setupModFilter(allResults, updateState); 
    
    // 重新设置总匹配数（仅用于分页计算）
    updateState({ totalApiMatches: filtered.length });
    
    // 更新当前页结果（仅用于展示）
    const start = (store.currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    updateState({ currentApiResults: filtered.slice(start, end) });
    
    updateState({ resultsUiMessage: '' });

  } catch (err) {
    console.error("获取所有结果失败:", err);
    updateState({ resultsUiMessage: "获取所有结果失败，请重试。", totalApiMatches: 0 });
  } finally {
    updateState({ searchLoading: false });
  }
}

export function applyModFilter() {
  const store = useStore();
  const selectedMod = store.modFilterValue.trim();
  const { allApiResults, currentApiResults, totalApiMatches } = store;
    
  if (!store.searchQuery.trim()) {
    // 如果没有搜索词，不进行任何操作
    return;
  }
  
  if (selectedMod) {
    if (allApiResults.length === 0 || allApiResults.length < totalApiMatches) {
      // 模组筛选启用，但没有完整的缓存数据，需要获取所有结果
      if (!store.searchLoading) {
        fetchAllResults(selectedMod);
      }
      return;
    }
            
    // 从所有结果中筛选
    const filtered = allApiResults.filter(item => matchesModFilter(item, selectedMod));
        
    // 更新总匹配数和当前页结果
    updateState({ totalApiMatches: filtered.length });
    
    const startIndex = (store.currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filtered.length);
            
    updateState({ 
      currentApiResults: filtered.slice(startIndex, endIndex),
      resultsUiMessage: filtered.length === 0 ? "当前模组筛选下未找到结果。" : ''
    });
    
  } else {
    // 没有选择模组筛选，显示当前页的结果，总匹配数为 API 返回的总数
    updateState({ 
      currentApiResults: currentApiResults, 
      totalApiMatches: totalApiMatches,
      resultsUiMessage: totalApiMatches === 0 ? "未找到结果" : ''
    });
  }
}

export async function search(resetPage = false) {
  const store = useStore();
    
  const query = store.searchQuery.trim();
  const mode = store.searchMode;
  const currentModFilter = store.modFilterValue.trim();
  let newPage = store.currentPage;
  let newAllApiResults = store.allApiResults;

  if (resetPage) {
    newPage = 1;
    // 如果是新的搜索词或模式，才重置模组筛选器和所有结果缓存
    if (store.lastFullSearchKey.split("_")[0] !== query || store.lastFullSearchKey.split("_")[1] !== mode) {
      updateState({ modFilterValue: "", allApiResults: [] });
      newAllApiResults = []; // 清空所有结果缓存
    }
    updateState({ currentPage: newPage });
  }

  if (!query) {
    updateState({ resultsUiMessage: "请输入有效的搜索词", totalApiMatches: 0 });
    return;
  }

  if (query.length > 50) {
    updateState({ resultsUiMessage: "搜索词长度不能超过50个字符", totalApiMatches: 0 });
    return;
  }

  // 如果有模组筛选且已经有所有结果缓存，则直接应用筛选（跳过 API 请求）
  if (currentModFilter && newAllApiResults.length > 0 && newAllApiResults.length >= store.totalApiMatches) {
    applyModFilter();
    return;
  }

  const currentFullSearchKey = `${query}_${mode}_${newPage}_${currentModFilter}`;

  // 如果当前搜索状态与上次完全相同，且没有手动重置页面，则直接跳过请求
  if (currentFullSearchKey === store.lastFullSearchKey && !resetPage) {
    console.log("跳过重复请求:", currentFullSearchKey);
    return;
  }

  // 速率限制
  const now = Date.now();
  if (now - store.lastSearchTime < MIN_INTERVAL) {
    if (!resetPage) return;
  }
  updateState({ lastSearchTime: now, searchLoading: true, resultsUiMessage: "正在搜索中...", searchInfoMessage: '' });

  const requestStartTime = performance.now();

  try {
    const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${newPage}&mode=${mode}`);
    const requestEndTime = performance.now();
    updateState({ searchInfoMessage: `搜索耗时: ${(requestEndTime - requestStartTime).toFixed(0)} 毫秒` });

    if (!response.ok) throw new Error("网络响应错误");
    const data = await response.json();

    if (!data?.results?.length) {
      updateState({ 
        resultsUiMessage: "未找到结果", 
        totalApiMatches: 0, 
        currentApiResults: [],
        availableMods: [],
        lastFullSearchKey: currentFullSearchKey 
      });
      return;
    }

    const newCurrentApiResults = data.results;
    const newTotalApiMatches = data.total;

    let updatedAllApiResults = newAllApiResults;
    if (newPage === 1) {
      updatedAllApiResults = [...data.results];
    } else {
      // 增量更新所有结果缓存，避免重复添加
      const existingIds = new Set(updatedAllApiResults.map(item => item.key));
      const newResults = data.results.filter(item => !existingIds.has(item.key));
      updatedAllApiResults = [...updatedAllApiResults, ...newResults];
    }

    updateState({ 
      currentApiResults: newCurrentApiResults, 
      totalApiMatches: newTotalApiMatches, 
      allApiResults: updatedAllApiResults,
      resultsUiMessage: ''
    });

    // 只有在第一页搜索或当前模组筛选为空时，才基于当前结果设置模组列表
    if (newPage === 1 && !currentModFilter) {
      setupModFilter(newCurrentApiResults, updateState);
    } else if (currentModFilter) {
       // 如果有筛选，且页面大于1，应该基于 allApiResults 重新设置模组列表
       setupModFilter(updatedAllApiResults, updateState);
    }

    applyModFilter(); // 应用模组筛选（如果存在）或显示当前页结果
    
    updateState({ lastFullSearchKey: currentFullSearchKey });

  } catch (error) {
    console.error("查询失败:", error);
    updateState({ 
      resultsUiMessage: "查询失败，请检查网络或联系作者（Github Issue）。",
      totalApiMatches: 0,
      currentApiResults: [],
      searchInfoMessage: ''
    });
  } finally {
    updateState({ searchLoading: false });
  }
}