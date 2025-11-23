<script setup>
import { onMounted, computed } from 'vue';
import { useStore, updateState } from './store.js';
import SearchBar from './components/SearchBar.vue';
import ModFilter from './components/ModFilter.vue';
import ResultsTable from './components/ResultsTable.vue';
import ChangelogModal from './components/ChangelogModal.vue';
import * as bootstrap from 'bootstrap';

const store = useStore();

const resultsMessage = computed(() => {
  if (store.searchLoading) return "正在搜索中...";
  if (store.resultsUiMessage) return store.resultsUiMessage;
  
  if (store.currentApiResults.length === 0 && !store.searchLoading) {
    return store.modFilterValue ? "当前模组筛选下未找到结果。" : "未找到结果";
  }
  return '';
});

onMounted(() => {
  if (typeof bootstrap !== "undefined" && bootstrap.Modal) {
    updateState({ 
      changelogModal: new bootstrap.Modal(document.getElementById("changelogModal")) 
    });
  }
});
</script>

<template>
  <div class="container mt-5">
    <h1 class="text-center mb-4">MC 模组翻译参考词典</h1>
    
    <SearchBar />

    <div class="mb-2 text-muted">
      <strong>进阶搜索语法：</strong><br>
      <ul style="margin-bottom:0; padding-left: 1.2em;">
        <li>使用 <code>-</code> 排除特定单词，例如：<code>Save -as</code>（排除包含 as 的结果）</li>
        <li>使用引号 <code>""</code> 搜索准确单词组合，例如：<code>"Save as"</code></li>
        <li>使用星号 <code>*</code> 匹配结尾不同的单词，例如：<code>any*</code> 可匹配 any、anyway、anything</li>
        <li>使用加号 <code>+</code> 匹配结尾必须不同的单词，例如：<code>any+</code> 可匹配 anyway、anything、anywhere（不含 any）</li>
      </ul>
    </div>
    
    <ModFilter />

    <div id="searchInfo" class="mb-3">{{ store.searchInfoMessage }}</div>

    <div id="results">
      <ResultsTable :resultsMessage="resultsMessage" />
    </div>

    <footer class="text-center mt-5">
      <p>
        本站由
        <a href="https://space.bilibili.com/449728222">捂脸</a>
        制作，且代码完全开源，欢迎大家在
        <a href="https://github.com/Wulian233/mcmod-translation-dict">Github</a>
        上提出建议和点亮星标⭐！
      </p>
      <p>
        词典翻译数据基于VM汉化组的
        <a href="https://github.com/VM-Chinese-translate-group/i18n-Dict-Extender">i18n Dict Extender</a>
        项目生成，遵循
        <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans">CC BY-NC-SA 4.0 协议</a>。
      </p>
      <p>最后更新于：2025-11-23 | 📜 <a href="#" id="changelogLink" data-bs-toggle="modal" data-bs-target="#changelogModal">更新日志</a></p>
    </footer>
  </div>
  
  <ChangelogModal />
</template>

<style lang="css">
@import './styles.css';
</style>
