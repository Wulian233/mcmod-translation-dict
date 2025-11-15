<script setup>
import { computed, ref, onMounted } from 'vue';
import ModLinks from './ModLinks.vue';
import { useStore, updateState, itemsPerPage } from '../store.js';
import { highlightQuery } from '../utils.js';
import { search } from '../services/searchService.js';

const props = defineProps({
  resultsMessage: String
});

const store = useStore();

// 计算当前应显示的结果列表
const currentResults = computed(() => {
  const selectedMod = store.modFilterValue.trim();
  
  if (selectedMod && store.allApiResults.length > 0) {
    // 模组筛选时，从 allApiResults 中筛选并分页
    const filtered = store.allApiResults.filter(item => 
      item.all_mods && item.all_mods.toLowerCase().includes(selectedMod.toLowerCase())
    );
    const start = (store.currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return filtered.slice(start, end);
  } 
  
  // 无模组筛选时，显示当前页的 API 结果
  return store.currentApiResults;
});

// 计算分页总数
const totalItemsForPagination = computed(() => {
  const selectedMod = store.modFilterValue.trim();
  if (selectedMod && store.allApiResults.length > 0) {
    // 模组筛选时，总数为筛选后的总条目数
    return store.allApiResults.filter(item => 
      item.all_mods && item.all_mods.toLowerCase().includes(selectedMod.toLowerCase())
    ).length;
  }
  // 无模组筛选时，总数为 API 返回的总匹配条目数
  return store.totalApiMatches;
});

const totalPages = computed(() => {
  return Math.ceil(totalItemsForPagination.value / itemsPerPage);
});

// 模组链接的展开状态
const expandedMods = ref({}); // { key: boolean }

function toggleExpand(key) {
  expandedMods.value = {
    ...expandedMods.value,
    [key]: !expandedMods.value[key]
  };
}

function handlePageChange(page) {
  updateState({ currentPage: page });
  
  const selectedMod = store.modFilterValue.trim();
  
  if (selectedMod && store.allApiResults.length > 0) {
    // 逻辑在 currentResults computed property 中已处理，这里只需触发视图更新
  } else {
    // 无模组筛选或未缓存所有结果，需要发起 API 请求
    search(false);
  }
}

import { getCurrentInstance } from 'vue';
onMounted(() => {
  const app = getCurrentInstance().appContext.app;
  app.config.globalProperties.toggleExpand = toggleExpand;
});

</script>

<template>
  <table class="table table-striped">
    <thead>
      <tr>
        <th>翻译结果</th>
        <th>原文</th>
        <th>所属模组</th>
        <th>出现次数</th>
      </tr>
    </thead>
    <tbody id="resultsBody">
      <tr v-if="resultsMessage || currentResults.length === 0">
        <td colspan="4">{{ resultsMessage }}</td>
      </tr>
      
      <tr v-else-if="store.modFilterValue && totalItemsForPagination > 0">
        <td colspan="4" class="text-muted small">
          已筛选模组: {{ store.modFilterValue }}，共找到 {{ totalItemsForPagination }} 个结果
        </td>
      </tr>
      
      <tr v-for="item in currentResults" :key="item.key">
        <td v-html="highlightQuery(store.searchMode === 'en2zh' ? item.trans_name : item.origin_name, store.searchQuery)"></td>
        <td v-html="highlightQuery(store.searchMode === 'en2zh' ? item.origin_name : item.trans_name, store.searchQuery)"></td>
        <td style="max-width: 140px;">
            <ModLinks :item="item" />
        </td>
        <td>{{ item.frequency || 0 }}</td>
    </tr>
    </tbody>
  </table>

  <div id="pagination" class="d-flex justify-content-center" role="navigation" aria-label="分页">
    <ul class="pagination" v-if="totalPages > 1 && totalItemsForPagination > 0">
      <li class="page-item" :class="{ disabled: store.currentPage === 1 }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(1)">&laquo;</a>
      </li>
      
      <template v-for="page in totalPages" :key="page">
        <li v-if="page === 1 || page === totalPages || (page >= store.currentPage - 2 && page <= store.currentPage + 2)"
          class="page-item" :class="{ active: page === store.currentPage }">
          <a class="page-link" href="#" @click.prevent="handlePageChange(page)">{{ page }}</a>
        </li>
        <li v-else-if="page === store.currentPage - 3 || page === store.currentPage + 3" class="page-item disabled">
          <span class="page-link">...</span>
        </li>
      </template>

      <li class="page-item" :class="{ disabled: store.currentPage === totalPages }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(totalPages)">&raquo;</a>
      </li>
    </ul>
  </div>
</template>