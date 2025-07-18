document.addEventListener("DOMContentLoaded", () => {
    const searchButton = document.getElementById("searchButton");
    const searchInput = document.getElementById("searchInput");
    const searchMode = document.getElementById("searchMode");
    const resultsBody = document.getElementById("resultsBody");
    const pagination = document.getElementById("pagination");

    searchButton.addEventListener("click", () => search());
    searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            search();
        }
    });

    let currentPage = 1;
    const itemsPerPage = 50;

    function search(resetPage = true) {
        if (resetPage) currentPage = 1;

        const query = searchInput.value.trim();
        if (!query) {
            updateResultsUI("请输入有效的搜索词");
            return;
        }

        saveSearchHistory(query);
        updateResultsUI("正在搜索中...");

        const mode = searchMode.value;
        fetch(`https://api.vmct-cn.top/search?q=${encodeURIComponent(query)}&page=${currentPage}&mode=${mode}`)
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
                           target="_blank" rel="noopener noreferrer" title="在 CurseForge 查看">
                           <img src="curseforge.svg" alt="CurseForge" width="16" height="16">
                       </a>`
                : "";

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${highlightQuery(mode === "en2zh" ? item.trans_name : item.origin_name, query)}</td>
                <td>${highlightQuery(mode === "en2zh" ? item.origin_name : item.trans_name, query)}</td>
                <td title="${item.key || ''}">
                    ${item.modid || "未知模组"} (${item.version || 'N/A'})
                    ${curseforgeLink}
                </td>
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

        addPageButton("&laquo;", 1, currentPage === 1);

        const maxPagesToShow = 7;
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

        if (endPage - startPage + 1 < maxPagesToShow) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        if (startPage > 1) {
            addPageButton('1', 1);
            if (startPage > 2) paginationList.insertAdjacentHTML('beforeend', '<li class="page-item disabled"><span class="page-link">...</span></li>');
        }

        for (let i = startPage; i <= endPage; i++) {
            addPageButton(i, i);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) paginationList.insertAdjacentHTML('beforeend', '<li class="page-item disabled"><span class="page-link">...</span></li>');
            addPageButton(totalPages, totalPages);
        }

        addPageButton("&raquo;", totalPages, currentPage === totalPages);

        pagination.appendChild(paginationList);
    }

    const changelogLink = document.getElementById("changelogLink");
    const changelogModal = new bootstrap.Modal(document.getElementById('changelogModal'));
    const changelogBody = document.getElementById("changelogBody");

    const changelogData = [
        {
            version: "v1.8.0",
            date: "2025-07-18",
            changes: [
                "✨ 新增：更新日志功能"
            ]
        },
        {
            version: "v1.7.0",
            date: "2025-07-15",
            changes: [
                "✨ 新增：使用加强版数据库，多出超2万条译文！现在总量来到71万！",
                "🎨 优化：加快搜索速度",
                "🎨 优化：解决部分地区无法正常显示的问题。现在使用国内CDN来获取bootstrap.js",
                "🎨 优化：优化搜索逻辑",
                "1. 移除空格分词：不再将搜索词（如 \"hello world\"）拆分为 \"hello\" 和 \"world\" 分别搜索，现在将其整体搜索",
                "2. 最终结果按 “匹配权重” 和 “全局频率” 降序排列",
                "3. 修正了搜索缓存，现在缓存键会包含分页参数，确保不同页面的缓存不会相互覆盖",
                "🐛 修复：修复了表格里频率统计数字出错的问题"
            ]
        },
        {
            version: "v1.6.0",
            date: "2025-05-04",
            changes: [
                "🎨 优化：优化了后端搜索代码"
            ]
        },
        {
            version: "v1.5.0",
            date: "2025-04-13",
            changes: [
                "🎨 优化：优化了网站在手机上的显示效果",
                "🐛 修复：复了一些尺寸的屏幕上的搜索结果让表格超出屏幕的问题"
            ]
        },
        {
            version: "v1.4.0",
            date: "2025-04-05",
            changes: [
                "✨ 新增：支持中英互查！同样支持高亮搜索词",
                "🎨 优化：为上述新功能添加了暗色模式支持，为超链接添加了暗色模式支持"
            ]
        },
        {
            version: "v1.3.0",
            date: "2025-04-04",
            changes: [
                "✨ 新增：实现CurseForge模组链接跳转。点击图标即可",
                "🎨 优化：加快搜索速度",
                "🎨 优化：实现更好的搜索结果算法",
                "1. 现在仅搜索开头匹配或全匹配的单词",
                "2. 如果输入多个单词，则智能拆分每个单词独立搜索",
                "3. 按全匹配/部分匹配/出现频率进行排序",
                "🐛 修复：修复了分页bug"
            ]
        },
        {
            version: "v1.2.0",
            date: "2025-03-15",
            changes: [
                "🎨 优化：优化了后端搜索代码",
                "🐛 修复：修复了分页bug"
            ]
        },
        {
            version: "v1.1.0",
            date: "2025-02-21",
            changes: [
                "✨ 新增：支持暗色模式"
            ]
        },
        {
            version: "v1.0.0",
            date: "2025-02-17",
            changes: [
                "🚀 项目首次上线！"
            ]
        }
    ];

    function populateChangelog() {
        let content = "";
        changelogData.forEach(entry => {
            content += `
                <div class="changelog-entry">
                    <h6>${entry.version} (${entry.date})</h6>
                    <ul>
                        ${entry.changes.map(change => `<li>${change}</li>`).join('')}
                    </ul>
                </div>
            `;
        });
        changelogBody.innerHTML = content;
    }

    changelogLink.addEventListener("click", (e) => {
        e.preventDefault();
        populateChangelog();
        changelogModal.show();
    });
});