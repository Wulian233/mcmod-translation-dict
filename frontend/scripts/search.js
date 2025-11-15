import { 
  MIN_INTERVAL, API_BASE_URL, itemsPerPage, DOM, 
  getCurrentState, updateState 
} from "./config.js";
import { 
  updateResultsUI, hideFilterContainer, showFilterContainer, 
  matchesModFilter, extractModIds, displayResults, setupPagination
} from "./utils.js";

function createSuggestionItem(mod) {
  const item = document.createElement("div");
  item.className = "px-3 py-2 cursor-pointer suggestion-item list-group-item";
  item.textContent = mod;
  item.style.cursor = "pointer";
  item.addEventListener("click", () => {
    DOM.modFilter.value = mod;
    DOM.modSuggestions.style.display = "none";
    applyModFilter();
  });
  return item;
}

function showSuggestions(mods) {
  DOM.modSuggestions.innerHTML = "";
  DOM.modSuggestions.classList.add("list-group");

  if (mods.length === 0) {
    const noResult = document.createElement("div");
    noResult.className = "px-3 py-2 text-muted";
    noResult.textContent = "未找到匹配的模组";
    DOM.modSuggestions.appendChild(noResult);
  } else {
    mods.forEach(mod => {
      const item = createSuggestionItem(mod);
      DOM.modSuggestions.appendChild(item);
    });
  }

  DOM.modSuggestions.style.display = "block";
}

function showAllSuggestions() {
  const { availableMods } = getCurrentState();
  if (availableMods.length === 0) {
    DOM.modSuggestions.style.display = "none";
    return;
  }

  DOM.modSuggestions.innerHTML = "";
  DOM.modSuggestions.classList.add("list-group");

  const allOption = document.createElement("div");
  allOption.className = "px-3 py-2 cursor-pointer suggestion-item list-group-item";
  allOption.textContent = "显示全部模组";
  allOption.style.cursor = "pointer";
  allOption.addEventListener("click", () => {
    DOM.modFilter.value = "";
    DOM.modSuggestions.style.display = "none";
    applyModFilter();
  });
  DOM.modSuggestions.appendChild(allOption);

  // 显示前10个模组
  availableMods.slice(0, 10).forEach(mod => {
    const item = createSuggestionItem(mod);
    DOM.modSuggestions.appendChild(item);
  });

  if (availableMods.length > 10) {
    const moreItem = document.createElement("div");
    moreItem.className = "px-3 py-2 text-muted small";
    moreItem.textContent = `还有 ${availableMods.length - 10} 个模组，请输入关键词筛选...`;
    DOM.modSuggestions.appendChild(moreItem);
  }

  DOM.modSuggestions.style.display = "block";
}

export function handleModFilterInput() {
  const { availableMods } = getCurrentState();
  const inputValue = DOM.modFilter.value.trim().toLowerCase();

  if (inputValue === "") {
    showAllSuggestions();
  } else {
    const filteredMods = availableMods.filter(mod =>
      mod.toLowerCase().includes(inputValue)
    );
    showSuggestions(filteredMods);
  }

  // 重置为第一页
  if (getCurrentState().currentPage !== 1) {
    updateState({ currentPage: 1 });
  }

  applyModFilter();
}

function setupModFilter(results) {
  if (!results || results.length === 0) {
    hideFilterContainer();
    updateState({ availableMods: [] });
    return;
  }
    
  const modFrequency = {};
  results.forEach(item => {
    const modIds = extractModIds(item.all_mods);
    modIds.forEach(modId => {
      if (modId && modId !== "未知模组") {
        if (!modFrequency[modId]) {
          modFrequency[modId] = 0;
        }
        modFrequency[modId] += item.frequency || 1;
      }
    });
  });

  const newAvailableMods = Object.keys(modFrequency).sort((a, b) => {
    return modFrequency[b] - modFrequency[a];
  });

  updateState({ availableMods: newAvailableMods });

  if (newAvailableMods.length > 0) {
    showFilterContainer();
  } else {
    hideFilterContainer();
  }
}

async function fetchAllResults(selectedMod) {
  const query = DOM.searchInput.value.trim();
  const mode = DOM.searchMode.value;
  const { totalApiMatches, currentApiResults, currentPage } = getCurrentState();
  const totalPages = Math.ceil(totalApiMatches / itemsPerPage);

  updateResultsUI("正在获取所有结果，请稍候...");
  DOM.searchInfo.innerHTML = "";

  try {
    const allResults = [...(currentPage === 1 && currentApiResults.length ? currentApiResults : [])];

    const promises = Array.from({ length: totalPages }, (_, i) => i + 1)
      .filter(page => !(page === currentPage && currentApiResults.length))
      .map(page =>
        fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${page}&mode=${mode}`)
          .then(res => {
            if (!res.ok) throw new Error(`页面 ${page} 获取失败`);
            return res.json();
          })
          .then(data => data?.results ?? [])
      );

    const results = (await Promise.all(promises)).flat();

    const existingKeys = new Set(allResults.map(r => r.key));
    results.forEach(item => {
      if (!existingKeys.has(item.key)) {
        allResults.push(item);
        existingKeys.add(item.key);
      }
    });

    updateState({ allApiResults: allResults });

    const filtered = allResults.filter(item => matchesModFilter(item, selectedMod));
    updateState({ currentPage: 1 });

    if (!filtered.length) {
      updateResultsUI("当前模组筛选下未找到结果。");
      setupPagination(0);
      return;
    }

    const showPage = (page = 1) => {
      const start = (page - 1) * itemsPerPage;
      const end = start + itemsPerPage;
      displayResults(filtered.slice(start, end), query, mode);
      setupPagination(filtered.length);
    };

    showPage(1);
    setupModFilter(allResults);

  } catch (err) {
    console.error("获取所有结果失败:", err);
    updateResultsUI("获取所有结果失败，请重试。");
    setupPagination(0);
  }
}

export function applyModFilter() {
  const selectedMod = DOM.modFilter.value.trim();
  const { allApiResults, currentApiResults, totalApiMatches, currentPage } = getCurrentState();
  let resultsToDisplay;
    
  if (selectedMod) {
    if (allApiResults.length === 0 || allApiResults.length < totalApiMatches) {
      // 需要获取所有结果
      fetchAllResults(selectedMod);
      return;
    }
            
    // 从所有结果中筛选
    resultsToDisplay = allApiResults.filter(item => matchesModFilter(item, selectedMod));
        
    // 筛选后的结果进行分页
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, resultsToDisplay.length);
            
    displayResults(resultsToDisplay.slice(startIndex, endIndex), DOM.searchInput.value.trim(), DOM.searchMode.value);
    setupPagination(resultsToDisplay.length);
  } else {
    // 没有选择模组筛选，显示当前页的结果
    resultsToDisplay = currentApiResults;
    displayResults(resultsToDisplay, DOM.searchInput.value.trim(), DOM.searchMode.value);
    setupPagination(totalApiMatches);
  }
}


export function search(resetPage = false) {
  const { currentPage, lastFullSearchKey, lastSearchTime, allApiResults } = getCurrentState();
    
  const query = DOM.searchInput.value.trim();
  const mode = DOM.searchMode.value;
  const currentModFilter = DOM.modFilter.value.trim();

  let newPage = currentPage;
  let newAllApiResults = allApiResults;

  if (resetPage) {
    newPage = 1;
    // 如果是新的搜索词或模式，才重置模组筛选器和所有结果缓存
    if (lastFullSearchKey.split("_")[0] !== query || lastFullSearchKey.split("_")[1] !== mode) {
      DOM.modFilter.value = "";
      newAllApiResults = []; // 清空所有结果缓存
    }
    updateState({ currentPage: newPage, allApiResults: newAllApiResults });
  }

  if (!query) {
    updateResultsUI("请输入有效的搜索词");
    hideFilterContainer();
    return;
  }

  if (query.length > 50) {
    updateResultsUI("搜索词长度不能超过50个字符");
    hideFilterContainer();
    return;
  }

  // 如果有模组筛选且已经有所有结果缓存，则直接应用筛选
  if (currentModFilter && allApiResults.length > 0) {
    applyModFilter();
    return;
  }

  const currentFullSearchKey = `${query}_${mode}_${newPage}_${currentModFilter}`;

  // 如果当前搜索状态与上次完全相同，且没有手动重置页面，则直接跳过请求
  if (currentFullSearchKey === lastFullSearchKey && !resetPage) {
    console.log("跳过重复请求:", currentFullSearchKey);
    return;
  }

  // 速率限制
  const now = Date.now();
  if (now - lastSearchTime < MIN_INTERVAL) {
    if (!resetPage) return;
  }
  updateState({ lastSearchTime: now });

  updateResultsUI("正在搜索中...");
  DOM.searchInfo.innerHTML = "";

  const requestStartTime = performance.now();

  fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${newPage}&mode=${mode}`)
    .then((response) => {
      const requestEndTime = performance.now();
      DOM.searchInfo.innerHTML = `搜索耗时: ${(requestEndTime - requestStartTime).toFixed(0)} 毫秒`;

      if (!response.ok) throw new Error("网络响应错误");
      return response.json();
    })
    .then((data) => {
      if (!data?.results?.length) {
        updateResultsUI("未找到结果");
        hideFilterContainer();
        updateState({ totalApiMatches: 0 });
        setupPagination(0);
        updateState({ lastFullSearchKey: currentFullSearchKey });
        return;
      }

      const newCurrentApiResults = data.results;
      const newTotalApiMatches = data.total;

      let updatedAllApiResults = newAllApiResults;
      if (newPage === 1) {
        updatedAllApiResults = [...data.results];
      } else {
        const existingIds = new Set(updatedAllApiResults.map(item => item.key));
        const newResults = data.results.filter(item => !existingIds.has(item.key));
        updatedAllApiResults = [...updatedAllApiResults, ...newResults];
      }

      updateState({ 
        currentApiResults: newCurrentApiResults, 
        totalApiMatches: newTotalApiMatches, 
        allApiResults: updatedAllApiResults
      });

      setupModFilter(currentModFilter ? updatedAllApiResults : newCurrentApiResults);
      applyModFilter();

      updateState({ lastFullSearchKey: currentFullSearchKey });
    })
    .catch((error) => {
      console.error("查询失败:", error);
      updateResultsUI("查询失败，请检查网络或联系作者（Github Issue）。");
      hideFilterContainer();
      updateState({ totalApiMatches: 0 });
      setupPagination(0);
      DOM.searchInfo.innerHTML = "";
    });
}