import { API_SEARCH_MCMOD } from './store.js';

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

  // 排除检查
  for (const t of tokens.filter(t => t.type === "exclude")) {
    if (safeText.toLowerCase().includes(t.value.toLowerCase())) {
      // 如果包含排除词，则不进行高亮，直接返回原始文本
      return safeText; 
    }
  }

  // 高亮处理
  const patterns = tokens
    .filter(t => t.type !== "exclude")
    .map(t => {
      if (t.type === "phrase") return escapeRegex(t.value);
      if (t.type === "prefix") return escapeRegex(t.value) + "\\w*";
      if (t.type === "expand") return escapeRegex(t.value) + "\\w+";
      return escapeRegex(t.value);
    });

  if (patterns.length === 0) return safeText;

  // 构造正则表达式进行高亮
  const regex = new RegExp("(" + patterns.join("|") + ")", "gi");
  return safeText.replace(regex, m => `<span class="highlight">${m}</span>`);
}

export function getModLinks(item) {
  const allModsString = item.all_mods || "未知模组 (N/A)";
  const allKeysString = item.all_keys || "";
  const allCurseforgesString = item.all_curseforges || "";
    
  const modParts = allModsString.split(", ");
  const modKeys = allKeysString.split(",");
  const curseforgeIds = allCurseforgesString.split(",");
    
  const filteredModParts = modParts.filter(part => part.trim() !== "");
    
  return filteredModParts.map((part, index) => {
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
    
    return {
      name: `${modid} (${version})`,
      key: modKey,
      html: `<span title="${modKey}">${modid} (${version}) ${curseforgeLink} ${mcmodSearchLink}</span>`
    };
  });
}

/**
 * 计算模组频率并更新可用模组列表
 * @param {Array} results - 搜索结果
 * @param {Function} updateState - 更新状态的函数
 */
export function setupModFilter(results, updateState) {
  if (!results || results.length === 0) {
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
        // 确保 item.frequency 是数字，否则默认为 1
        modFrequency[modId] += item.frequency || 1; 
      }
    });
  });

  const newAvailableMods = Object.keys(modFrequency).sort((a, b) => {
    return modFrequency[b] - modFrequency[a];
  });

  updateState({ availableMods: newAvailableMods });
}