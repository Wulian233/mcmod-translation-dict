<script setup>
import { computed } from 'vue'
import ModLinks from './ModLinks.vue'
import { useStore, updateState } from '../store.js'
import { getResultKey, highlightQuery } from '../utils.js'
import { search } from '../services/searchService.js'

defineProps({
  resultsMessage: String,
})

const store = useStore()

const currentResults = computed(() => store.currentApiResults)

function handlePageChange(page) {
  if (page < 1 || (page > store.currentPage && !store.hasMoreResults)) return
  updateState({ currentPage: page })
  search(false)
}
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

      <tr v-else-if="store.modFilterValue && store.totalApiMatches > 0">
        <td colspan="4" class="small">已筛选模组: {{ store.modFilterValue }}</td>
      </tr>

      <tr v-for="item in currentResults" :key="getResultKey(item)">
        <td
          v-html="
            highlightQuery(
              store.searchMode === 'en2zh' ? item.trans_name : item.origin_name,
              store.lastSearchQuery,
            )
          "
        ></td>
        <td
          v-html="
            highlightQuery(
              store.searchMode === 'en2zh' ? item.origin_name : item.trans_name,
              store.lastSearchQuery,
            )
          "
        ></td>
        <td style="max-width: 140px">
          <ModLinks :item="item" />
        </td>
        <td>{{ item.frequency || 0 }}</td>
      </tr>
    </tbody>
  </table>

  <div id="pagination" class="d-flex justify-content-center" role="navigation" aria-label="分页">
    <ul
      class="pagination"
      v-if="(store.currentPage > 1 || store.hasMoreResults) && store.totalApiMatches > 0"
    >
      <li class="page-item" :class="{ disabled: store.currentPage === 1 }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(store.currentPage - 1)"
          >上一页</a
        >
      </li>

      <li class="page-item active" aria-current="page">
        <span class="page-link">第 {{ store.currentPage }} 页</span>
      </li>

      <li class="page-item" :class="{ disabled: !store.hasMoreResults }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(store.currentPage + 1)"
          >下一页</a
        >
      </li>
    </ul>
  </div>
</template>
