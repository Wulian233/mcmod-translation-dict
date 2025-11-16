<script setup>
import { useStore, updateState } from '../store.js';
import { search } from '../services/searchService.js';

const store = useStore();

function handleSearch() {
  search(true); // 始终重置页面
}
</script>

<template>
  <div class="input-group mb-3">
    <input
      type="text"
      id="searchInput"
      class="form-control"
      placeholder="请输入搜索词..."
      :value="store.searchQuery"
      @input="e => updateState({ searchQuery: e.target.value })"
      @keypress.enter="handleSearch"
    />
    <select 
      id="searchMode" 
      class="form-select" 
      aria-label="搜索模式"
      :value="store.searchMode"
      @change="e => updateState({ searchMode: e.target.value })"
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
</template>