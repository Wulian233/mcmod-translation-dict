const MIN_INTERVAL = 1000; // 搜索最小间隔时间（毫秒）
const itemsPerPage = 50; // 每页显示的项目数量
const API_BASE_URL = "https://api.vmct-cn.top"; // API 基础 URL
const API_SEARCH_MCMOD = "https://search.mcmod.cn/s?key="; // MC百科搜索 API

let lastSearchTime = 0; // 上次搜索时间戳
let lastFullSearchKey = ""; // 存储上一次完整搜索的唯一标识
let currentPage = 1; // 当前页码
let changelogFetched = false;
let changelogData = [];
let changelogModal;

let currentApiResults = []; // 存储当前页从API获取的原始结果
let totalApiMatches = 0; // 存储API返回的总匹配条目数

const searchButton = document.getElementById("searchButton");
const searchInput = document.getElementById("searchInput");
const searchMode = document.getElementById("searchMode");
const resultsBody = document.getElementById("resultsBody");
const pagination = document.getElementById("pagination");
const changelogLink = document.getElementById("changelogLink");
const changelogBody = document.getElementById("changelogBody");
const modFilter = document.getElementById("modFilter");
const filterContainer = document.getElementById("filterContainer");
const modSuggestions = document.getElementById("modSuggestions");
let availableMods = []; // 存储当前页可用的模组列表

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  changelogModal = new bootstrap.Modal(document.getElementById("changelogModal"));

  bindSearchEvents();
  bindChangelogEvents();
}

function bindSearchEvents() {
  searchButton.addEventListener("click", () => search(true));
  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      search(true);
    }
  });

  modFilter.addEventListener("input", handleModFilterInput);
  modFilter.addEventListener("blur", () => {
    // 延迟隐藏建议，以便点击建议项
    setTimeout(() => {
      modSuggestions.style.display = "none";
    }, 200);
  });
  modFilter.addEventListener("focus", () => {
    if (availableMods.length > 0 && modFilter.value.length === 0) {
      showAllSuggestions();
    }
  });
}

function bindChangelogEvents() {
  changelogLink.addEventListener("click", async(e) => {
    e.preventDefault();
    if (!changelogFetched) {
      try {
        const res = await fetch("changelog.json");
        changelogData = await res.json();
        changelogFetched = true;
      } catch {
        changelogBody.innerHTML = "<p>❌ 无法加载更新日志，开发时本地预览请运行 npm run dev。</p>";
        changelogModal.show();
        return;
      }
    }
    populateChangelog();
    changelogModal.show();
  });
}

function search(resetPage = false) {
  const query = searchInput.value.trim();
  const mode = searchMode.value;
  const currentModFilter = modFilter.value.trim();

  if (resetPage) {
    currentPage = 1;
    // 如果是新的搜索词或模式，才重置模组筛选器
    // 否则如果只是点击分页，或者在同一个搜索词下更改模组筛选，不应重置模组筛选器
    if (lastFullSearchKey.split("_")[0] !== query || lastFullSearchKey.split("_")[1] !== mode) {
      modFilter.value = "";
    }
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

  const currentFullSearchKey = `${query}_${mode}_${currentPage}_${currentModFilter}`;

  // 如果当前搜索状态与上次完全相同，且没有手动重置页面，则直接跳过请求
  if (currentFullSearchKey === lastFullSearchKey && !resetPage) {
    console.log("跳过重复请求:", currentFullSearchKey);
    return;
  }

  // 速率限制：一秒最多一次
  const now = Date.now();
  if (now - lastSearchTime < MIN_INTERVAL) {
    if (!resetPage) return;
  }
  lastSearchTime = now;

  updateResultsUI("正在搜索中...");

  fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${currentPage}&mode=${mode}`)
    .then((response) => {
      if (!response.ok) throw new Error("网络响应错误");
      return response.json();
    })
    .then((data) => {
      if (!data?.results?.length) {
        updateResultsUI("未找到结果");
        hideFilterContainer();
        totalApiMatches = 0;
        setupPagination(totalApiMatches);
        lastFullSearchKey = currentFullSearchKey;
        return;
      }

      currentApiResults = data.results;
      totalApiMatches = data.total;

      setupModFilter(currentApiResults);
      applyModFilter();

      lastFullSearchKey = currentFullSearchKey;
    })
    .catch((error) => {
      console.error("查询失败:", error);
      updateResultsUI("查询失败，请检查网络或联系作者（Github Issue）。");
      hideFilterContainer();
      totalApiMatches = 0;
      setupPagination(totalApiMatches);
    });
}

function updateResultsUI(message) {
  resultsBody.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
  pagination.innerHTML = "";
}

function hideFilterContainer() {
  filterContainer.style.display = "none";
  modSuggestions.style.display = "none"; // 隐藏建议列表
}

function showFilterContainer() {
  filterContainer.style.display = "block";
}

function setupModFilter(results) {
  // 统计当前页每个模组的出现频率
  const modFrequency = {};
  results.forEach(item => {
    if (item.modid) {
      if (!modFrequency[item.modid]) {
        modFrequency[item.modid] = 0;
      }
      modFrequency[item.modid] += item.frequency || 1;
    }
  });

  // 按频率排序模组ID
  availableMods = Object.keys(modFrequency).sort((a, b) => {
    return modFrequency[b] - modFrequency[a]; // 频率高的在前
  });

  showFilterContainer();
}

function handleModFilterInput() {
  const inputValue = modFilter.value.trim().toLowerCase();

  if (inputValue === "") {
    showAllSuggestions();
  } else {
    // 筛选匹配的模组 (仅基于当前页的 availableMods)
    const filteredMods = availableMods.filter(mod =>
      mod.toLowerCase().includes(inputValue)
    );
    showSuggestions(filteredMods);
  }

  // 模组筛选器的改变也应该触发一次“搜索”来更新结果和分页
  // 这里我们直接调用 search(false) 来刷新内容，但注意它不会发起新的API请求
  // 如果 currentFullSearchKey 没有改变（即页码、查询、模式都没变），则不会重复请求API
  // 但是会执行 applyModFilter 重新渲染当前页的过滤结果
  search(false);
}

function showAllSuggestions() {
  if (availableMods.length === 0) {
    modSuggestions.style.display = "none";
    return;
  }

  modSuggestions.innerHTML = "";

  const allOption = document.createElement("div");
  allOption.className = "px-3 py-2 cursor-pointer suggestion-item list-group-item";
  allOption.textContent = "显示全部模组";
  allOption.style.cursor = "pointer";
  allOption.addEventListener("click", () => {
    modFilter.value = "";
    modSuggestions.style.display = "none";
    applyModFilter();
  });
  modSuggestions.appendChild(allOption);

  // 显示前10个模组
  availableMods.slice(0, 10).forEach(mod => {
    const item = createSuggestionItem(mod);
    modSuggestions.appendChild(item);
  });

  if (availableMods.length > 10) {
    const moreItem = document.createElement("div");
    moreItem.className = "px-3 py-2 text-muted small";
    moreItem.textContent = `还有 ${availableMods.length - 10} 个模组，请输入关键词筛选...`;
    modSuggestions.appendChild(moreItem);
  }

  modSuggestions.style.display = "block";
}

function showSuggestions(mods) {
  modSuggestions.innerHTML = "";

  if (mods.length === 0) {
    const noResult = document.createElement("div");
    noResult.className = "px-3 py-2 text-muted";
    noResult.textContent = "未找到匹配的模组";
    modSuggestions.appendChild(noResult);
  } else {
    mods.forEach(mod => {
      const item = createSuggestionItem(mod);
      modSuggestions.appendChild(item);
    });
  }

  modSuggestions.style.display = "block";
}

function createSuggestionItem(mod) {
  const item = document.createElement("div");
  item.className = "px-3 py-2 cursor-pointer suggestion-item list-group-item"; // 添加 list-group-item 样式
  item.textContent = mod;
  item.style.cursor = "pointer";
  item.addEventListener("click", () => {
    modFilter.value = mod;
    modSuggestions.style.display = "none";
    applyModFilter();
  });
  return item;
}

function applyModFilter() {
  const selectedMod = modFilter.value.trim();
  let resultsToDisplay = currentApiResults; // 总是从当前页的原始结果开始筛选

  if (selectedMod) {
    resultsToDisplay = currentApiResults.filter(item => item.modid === selectedMod);
  }

  displayResults(resultsToDisplay, searchInput.value.trim(), searchMode.value);
  setupPagination(totalApiMatches);
}

function displayResults(results, query, mode) {
  resultsBody.innerHTML = "";

  if (results.length === 0) {
    updateResultsUI("当前模组筛选下未找到结果。");
    return;
  }

  results.forEach((item) => {
    const curseforgeLink = item.curseforge
      ? `<a href="https://www.curseforge.com/minecraft/mc-mods/${item.curseforge}"
                 target="_blank" rel="noopener noreferrer" title="在 CurseForge 查看" style="margin-left: 4px;">
                 <img src="curseforge.svg" alt="CurseForge" width="16" height="16">
               </a>`
      : "";

    const mcmodSearchLink = item.modid
      ? `<a href="${API_SEARCH_MCMOD}${encodeURIComponent(item.modid)}"
                 target="_blank" rel="noopener noreferrer" title="在 MC 百科搜索 ModID" style="margin-left: 4px;">
                 <img src="mcmod.svg" alt="MC百科" width="16" height="16">
               </a>`
      : "";

    const row = document.createElement("tr");
    row.innerHTML = `
        <td>${highlightQuery(mode === "en2zh" ? item.trans_name : item.origin_name, query)}</td>
        <td>${highlightQuery(mode === "en2zh" ? item.origin_name : item.trans_name, query)}</td>
        <td title="${item.key || ""}">${item.modid || "未知模组"} (${item.version || "N/A"}) ${curseforgeLink} ${mcmodSearchLink}</td>
        <td>${item.frequency || 0}</td>
      `;
    resultsBody.appendChild(row);
  });
}

function highlightQuery(text, query) {
  if (!text || !query) return text || "";
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return text.replace(regex, (match) => `<span class="highlight">${match}</span>`);
}

function setupPagination(totalItems) {
  pagination.innerHTML = "";

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (totalPages <= 1) return;

  const paginationList = document.createElement("ul");
  paginationList.className = "pagination";

  function addPageButton(label, page, isDisabled = false) {
    const pageItem = document.createElement("li");
    pageItem.className = `page-item ${isDisabled ? "disabled" : ""} ${page === currentPage ? "active" : ""}`;

    const pageLink = document.createElement("a");
    pageLink.className = "page-link";
    pageLink.href = "#";
    pageLink.innerHTML = label;

    if (!isDisabled && page !== currentPage) {
      pageLink.addEventListener("click", (e) => {
        e.preventDefault();
        currentPage = page;
        search(false); // 点击分页按钮时，重新发起 API 请求
      });
    }
    pageItem.appendChild(pageLink);
    paginationList.appendChild(pageItem);
  }

  addPageButton("&laquo;", 1, currentPage === 1); // 添加“首页”按钮

  const maxPagesToShow = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

  if (endPage - startPage + 1 < maxPagesToShow) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }

  // 显示首页和省略号
  if (startPage > 1) {
    addPageButton("1", 1);
    if (startPage > 2) paginationList.insertAdjacentHTML("beforeend", '<li class="page-item disabled"><span class="page-link">...</span></li>');
  }

  // 显示中间页码
  for (let i = startPage; i <= endPage; i++) {
    addPageButton(i, i);
  }

  // 显示末页和省略号
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationList.insertAdjacentHTML("beforeend", '<li class="page-item disabled"><span class="page-link">...</span></li>');
    addPageButton(totalPages, totalPages);
  }

  addPageButton("&raquo;", totalPages, currentPage === totalPages); // 添加“末页”按钮

  pagination.appendChild(paginationList);
}

function populateChangelog() {
  let content = "";
  changelogData.forEach((entry) => {
    content += `
        <div class="changelog-entry">
          <h6>${entry.version} (${entry.date})</h6>
          <ul>
            ${entry.changes.map((change) => `<li>${change}</li>`).join("")}
          </ul>
        </div>
      `;
  });
  changelogBody.innerHTML = content;
}