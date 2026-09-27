<script setup>
import { useStore, updateState } from '../store.js'
import { search } from '../services/searchService.js'

const store = useStore()

function handleSearch() {
  search(true) // 始终重置页面
}

function resetSearch(selection) {
  updateState({
    ...selection,
    currentPage: 1,
    currentApiResults: [],
    modFilterValue: '',
    appliedModFilter: '',
    availableMods: [],
    lastFullSearchKey: '',
    totalApiMatches: null,
    totalIsExact: false,
    hasMoreResults: false,
    pageLimitReached: false,
    searchInfoMessage: '',
    sourceNotice: '',
    resultsUiMessage: '搜索设置已切换，请点击查询',
  })
}

function changeSource() {
  resetSearch({ dataSource: store.dataSource === 'extended' ? 'mcmod' : 'extended' })
}

function changeMode(event) {
  const searchMode = event.target.value
  resetSearch({ searchMode, dataSource: searchMode === 'zh2en' ? 'extended' : store.dataSource })
}
</script>

<template>
  <div class="input-group" :class="store.searchMode === 'en2zh' ? 'mb-1' : 'mb-3'">
    <input
      type="text"
      id="searchInput"
      class="form-control"
      placeholder="请输入搜索词..."
      :value="store.searchQuery"
      @input="(e) => updateState({ searchQuery: e.target.value })"
      @keypress.enter="handleSearch"
    />
    <select
      id="searchMode"
      class="form-select"
      aria-label="搜索模式"
      :value="store.searchMode"
      :disabled="store.searchLoading"
      @change="changeMode"
    >
      <option value="en2zh">英文查中文</option>
      <option value="zh2en">中文查英文</option>
    </select>
    <button
      id="searchButton"
      class="btn btn-primary"
      type="button"
      @click="handleSearch"
      :disabled="store.searchLoading"
    >
      查询
    </button>
  </div>
  <div v-if="store.searchMode === 'en2zh'" class="source-switch-row">
    <button
      id="dataSource"
      type="button"
      class="source-switch"
      :disabled="store.searchLoading"
      :title="`切换到${store.dataSource === 'extended' ? 'MC百科' : '加强版'}词典`"
      :aria-label="`当前数据源：${store.dataSource === 'extended' ? '加强版' : 'MC百科'}，点击切换`"
      @click="changeSource"
    >
      数据源：{{ store.dataSource === 'extended' ? '加强版' : 'MC百科' }}
      <span aria-hidden="true">⇄</span>
    </button>
  </div>
</template>

<style scoped>
.source-switch-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}

.source-switch {
  padding: 2px 0 2px 8px;
  border: 0;
  background: transparent;
  color: var(--footer-color);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.source-switch:hover:not(:disabled) {
  color: var(--secondary-color);
}

.source-switch:focus-visible {
  outline: 2px solid var(--secondary-color);
  outline-offset: 3px;
  border-radius: 2px;
}

.source-switch:disabled {
  opacity: 0.5;
  cursor: wait;
}
</style>
