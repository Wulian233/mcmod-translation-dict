const MIN_INTERVAL = 1000; // 搜索最小间隔时间（毫秒）
const itemsPerPage = 50; // 每页显示的项目数量
const API_BASE_URL = "https://api.vmct-cn.top"; // API 基础 URL
const API_SEARCH_MCMOD = `https://search.mcmod.cn/s?key=`; // MC百科搜索 API

let lastSearchTime = 0; // 上次搜索时间戳
let lastSearchKey = ""; // 上次搜索的关键字（包含查询、模式和页码）
let currentPage = 1; // 当前页码
let changelogFetched = false;
let changelogData = [];
let changelogModal;

const searchButton = document.getElementById("searchButton");
const searchInput = document.getElementById("searchInput");
const searchMode = document.getElementById("searchMode");
const resultsBody = document.getElementById("resultsBody");
const pagination = document.getElementById("pagination");
const changelogLink = document.getElementById("changelogLink");
const changelogBody = document.getElementById("changelogBody");

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  changelogModal = new bootstrap.Modal(document.getElementById("changelogModal"));

  bindSearchEvents();
  bindChangelogEvents();
}

function bindSearchEvents() {
  searchButton.addEventListener("click", search);
  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      search();
    }
  });
}

function bindChangelogEvents() {
  changelogLink.addEventListener("click", async (e) => {
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

function search(resetPage = true) {
  if (resetPage) currentPage = 1;

  const query = searchInput.value.trim();
  if (!query) {
    updateResultsUI("请输入有效的搜索词");
    return;
  }

  if (query.length > 50) {
    updateResultsUI("搜索词长度不能超过50个字符");
    return;
  }

  // 速率限制：一秒最多一次
  const now = Date.now();
  if (now - lastSearchTime < MIN_INTERVAL) return;
  lastSearchTime = now;

  const mode = searchMode.value;
  const searchKey = `${query}_${mode}_${currentPage}`;
  // 如果当前搜索和上一次一样，跳过请求
  if (searchKey === lastSearchKey) return;

  lastSearchKey = searchKey;
  updateResultsUI("正在搜索中...");

  fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${currentPage}&mode=${mode}`)
    .then((response) => {
      if (!response.ok) throw new Error("网络响应错误");
      return response.json();
    })
    .then((data) => {
      if (!data?.results?.length) {
        updateResultsUI("未找到结果");
        return;
      }
      displayResults(data.results, query, mode);
      setupPagination(data.total);
    })
    .catch((error) => {
      console.error("查询失败:", error);
      updateResultsUI("查询失败，请检查网络或联系作者（Github Issue）。");
    });
}

function updateResultsUI(message) {
  resultsBody.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
  pagination.innerHTML = "";
}

function displayResults(results, query, mode) {
  resultsBody.innerHTML = "";

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
                 <img src="mcmod.png" alt="MC百科" width="16" height="16">
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
        search(false);
      });
    }
    pageItem.appendChild(pageLink);
    paginationList.appendChild(pageItem);
  }

  addPageButton("&laquo;", 1, currentPage === 1); // 添加“首页”按钮

  const maxPagesToShow = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

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