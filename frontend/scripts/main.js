import { DOM, updateState, getCurrentState } from "./config.js";
import { search, handleModFilterInput } from "./search.js";
import { populateChangelog } from "./utils.js";

function bindSearchEvents() {
  DOM.searchButton.addEventListener("click", () => search(true));
  DOM.searchInput.addEventListener("keypress", e => e.key === "Enter" && search(true));

  DOM.modFilter.addEventListener("input", handleModFilterInput);
  DOM.modFilter.addEventListener("blur", () => {
    // 延迟隐藏建议，以便点击建议项
    setTimeout(() => DOM.modSuggestions.style.display = "none", 200);
  });
  DOM.modFilter.addEventListener("focus", () => {
    const { availableMods } = getCurrentState();
    if (availableMods.length > 0 && DOM.modFilter.value.length === 0) {
      handleModFilterInput(); // 重新触发输入处理以显示所有建议
    }
  });
}

function bindChangelogEvents() {
  DOM.changelogLink.addEventListener("click", async e => {
    e.preventDefault();
    const { changelogFetched, changelogModal } = getCurrentState();
        
    if (!changelogFetched) {
      try {
        const res = await fetch("changelog.json");
        const data = await res.json();
        updateState({ changelogData: data, changelogFetched: true });
      } catch {
        DOM.changelogBody.innerHTML = "<p>❌ 无法加载更新日志，开发时本地预览请运行 npm run dev。</p>";
        return changelogModal.show();
      }
    }
    populateChangelog();
    getCurrentState().changelogModal.show();
  });
}

function initApp() {
  if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
    updateState({ changelogModal: new bootstrap.Modal(document.getElementById("changelogModal")) });
  }

  bindSearchEvents();
  bindChangelogEvents();
}

document.addEventListener("DOMContentLoaded", initApp);