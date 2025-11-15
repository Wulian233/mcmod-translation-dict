import { API_SEARCH_MCMOD, itemsPerPage, DOM, getCurrentState, updateState } from "./config.js";
import { search } from "./search.js";

export function updateResultsUI(message) {
  DOM.resultsBody.innerHTML = `<tr><td colspan="4">${message}</td></tr>`;
  DOM.pagination.innerHTML = "";
}

export function hideFilterContainer() {
  DOM.filterContainer.style.display = "none";
  DOM.modSuggestions.style.display = "none";
}

export function showFilterContainer() {
  DOM.filterContainer.style.display = "block";
}

export function extractModIds(allModsString) {
  if (!allModsString || allModsString === "未知模组 (N/A)") return [];
    
  return allModsString.split(", ").map(mod => {
    const match = mod.match(/(.*) \(.*\)/);
    return match ? match[1].trim() : mod.trim();
  }).filter(modId => modId && modId !== "未知模组");
}

export function matchesModFilter(item, selectedMod) {
  if (!selectedMod) return true;
    
  const modIds = extractModIds(item.all_mods);
  return modIds.some(modId => modId.toLowerCase() === selectedMod.toLowerCase());
}

export function parseQuery(rawQuery) {
  const tokens = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;

  while ((match = regex.exec(rawQuery)) !== null) {
    if (match[1]) {
      tokens.push({ type: "phrase", value: match[1] });
    } else if (match[2]) {
      const token = match[2];
      if (token.startsWith("-")) {
        tokens.push({ type: "exclude", value: token.slice(1) });
      } else if (token.endsWith("*")) {
        tokens.push({ type: "prefix", value: token.slice(0, -1) });
      } else if (token.endsWith("+")) {
        tokens.push({ type: "expand", value: token.slice(0, -1) });
      } else {
        tokens.push({ type: "word", value: token });
      }
    }
  }
  return tokens;
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightQuery(text, rawQuery) {
  if (!text || !rawQuery) return text || "";

  const tokens = parseQuery(rawQuery);
  const safeText = text.replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));

  for (const t of tokens.filter(t => t.type === "exclude")) {
    if (safeText.toLowerCase().includes(t.value.toLowerCase())) {
      return safeText; 
    }
  }

  const patterns = tokens
    .filter(t => t.type !== "exclude")
    .map(t => {
      if (t.type === "phrase") return escapeRegex(t.value);
      if (t.type === "prefix") return escapeRegex(t.value) + "\\w*";
      if (t.type === "expand") return escapeRegex(t.value) + "\\w+";
      return escapeRegex(t.value);
    });

  if (patterns.length === 0) return safeText;

  const regex = new RegExp("(" + patterns.join("|") + ")", "gi");
  return safeText.replace(regex, m => `<span class="highlight">${m}</span>`);
}

export function populateChangelog() {
  const { changelogData } = getCurrentState();
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
  DOM.changelogBody.innerHTML = content;
}

export function setupPagination(totalItems) {
  const { currentPage, allApiResults } = getCurrentState();
  DOM.pagination.innerHTML = "";

  if (totalItems <= 0 || totalItems <= itemsPerPage) return;

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
        updateState({ currentPage: page });

        const selectedMod = DOM.modFilter.value.trim();
        if (selectedMod && allApiResults.length > 0) {
          const filteredResults = allApiResults.filter(item => matchesModFilter(item, selectedMod));
          const startIndex = (page - 1) * itemsPerPage;
          const endIndex = Math.min(startIndex + itemsPerPage, filteredResults.length);
          displayResults(filteredResults.slice(startIndex, endIndex), DOM.searchInput.value.trim(), DOM.searchMode.value);
        } else {
          search(false); // 点击分页按钮时，重新发起 API 请求
        }
      });
    }
    pageItem.appendChild(pageLink);
    paginationList.appendChild(pageItem);
  }

  addPageButton("&laquo;", 1, currentPage === 1);

  const maxPagesToShow = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

  if (endPage - startPage + 1 < maxPagesToShow) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }

  if (startPage > 1) {
    addPageButton("1", 1);
    if (startPage > 2) paginationList.insertAdjacentHTML("beforeend", '<li class="page-item disabled"><span class="page-link">...</span></li>');
  }

  for (let i = startPage; i <= endPage; i++) {
    addPageButton(i, i);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationList.insertAdjacentHTML("beforeend", '<li class="page-item disabled"><span class="page-link">...</span></li>');
    addPageButton(totalPages, totalPages);
  }

  addPageButton("&raquo;", totalPages, currentPage === totalPages);

  DOM.pagination.appendChild(paginationList);
}

export function displayResults(results, query, mode) {
  const { allApiResults } = getCurrentState();
  DOM.resultsBody.innerHTML = "";
    
  if (results.length === 0) {
    updateResultsUI("当前模组筛选下未找到结果。");
    return;
  }
    
  const selectedMod = DOM.modFilter.value.trim();
  if (selectedMod && allApiResults.length > 0) {
    const filteredTotal = allApiResults.filter(item => matchesModFilter(item, selectedMod)).length;
    const resultInfo = document.createElement("tr");
    resultInfo.innerHTML = `<td colspan="4" class="text-muted small">已筛选模组: ${selectedMod}，共找到 ${filteredTotal} 个结果</td>`;
    DOM.resultsBody.appendChild(resultInfo);
  }
    
  results.forEach((item) => {
    const allModsString = item.all_mods || "未知模组 (N/A)";
    const allKeysString = item.all_keys || "";
    const allCurseforgesString = item.all_curseforges || "";
    
    const modParts = allModsString.split(", ");
    const modKeys = allKeysString.split(",");
    const curseforgeIds = allCurseforgesString.split(",");
    
    let modLinksHtml = "";
    const filteredModParts = modParts.filter(part => part.trim() !== "");
    
    const allModItems = filteredModParts.map((part, index) => {
      const match = part.match(/(.*) \((.*)\)/);
      const modid = match ? match[1] : part;
      const version = match ? match[2] : "N/A";
    
      const modKey = modKeys[index] || modid;
      const curseforge = curseforgeIds[index] || "";
    
      const curseforgeLink = curseforge
        ? `<a href="https://www.curseforge.com/minecraft/mc-mods/${curseforge}"
                    target="_blank" rel="noopener noreferrer" title="在 CurseForge 查看" style="margin-left: 4px;">
                    <img src="curseforge.svg" alt="CurseForge" width="16" height="16">
                   </a>`
        : "";
    
      const mcmodSearchLink = modid
        ? `<a href="${API_SEARCH_MCMOD}${encodeURIComponent(modid)}"
                    target="_blank" rel="noopener noreferrer" title="在 MC 百科搜索 ModID" style="margin-left: 4px;">
                    <img src="mcmod.svg" alt="MC百科" width="16" height="16">
                   </a>`
        : "";
    
      return `<span title="${modKey}">${modid} (${version}) ${curseforgeLink} ${mcmodSearchLink}</span>`;
    });
    
    
    const totalMods = allModItems.length;
    
    if (totalMods > 1) {
      modLinksHtml = `
                <div>
                  ${allModItems[0]}
                  <span class="expand-btn text-primary" style="cursor: pointer; margin-left: 8px;" data-total="${totalMods}">
                    ...（展开 ${totalMods - 1} 个）
                  </span>
                </div>
                <div class="expandable-content mt-2" style="display: none;">
                  ${allModItems.slice(1).join("<br>")}
                </div>
              `;
    } else {
      modLinksHtml = allModItems[0] || "无";
    }
            
    const row = document.createElement("tr");
    row.innerHTML = `
            <td>${highlightQuery(mode === "en2zh" ? item.trans_name : item.origin_name, query)}</td>
            <td>${highlightQuery(mode === "en2zh" ? item.origin_name : item.trans_name, query)}</td>
            <td style="max-width: 140px;">${modLinksHtml}</td>
            <td>${item.frequency || 0}</td>
          `;
    DOM.resultsBody.appendChild(row);
  });
    
  const expandableButtons = DOM.resultsBody.querySelectorAll(".expand-btn");
  expandableButtons.forEach(button => {
    button.addEventListener("click", (e) => {
      const parentDiv = e.target.closest("div");
      const contentDiv = parentDiv.nextElementSibling;
      const isExpanded = contentDiv.style.display === "block";
            
      const totalModsToExpand = e.target.getAttribute("data-total") - 1;
    
      if (isExpanded) {
        contentDiv.style.display = "none";
        e.target.innerHTML = `...（展开 ${totalModsToExpand} 个）`;
      } else {
        contentDiv.style.display = "block";
        e.target.innerHTML = "收起";
      }
    });
  });
}