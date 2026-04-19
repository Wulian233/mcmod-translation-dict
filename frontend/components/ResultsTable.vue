<script setup>
import { computed } from 'vue'
import ModLinks from './ModLinks.vue'
import { useStore, updateState, itemsPerPage } from '../store.js'
import { highlightQuery } from '../utils.js'
import { search } from '../services/searchService.js'

defineProps({
  resultsMessage: String,
})

const store = useStore()

const currentResults = computed(() => store.currentApiResults)

const totalPages = computed(() => Math.ceil(store.totalApiMatches / itemsPerPage))

function handlePageChange(page) {
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
        <td colspan="4" class="small">
          已筛选模组: {{ store.modFilterValue }}，共找到 {{ store.totalApiMatches }} 个结果
        </td>
      </tr>

      <tr v-for="item in currentResults" :key="item.key">
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
    <ul class="pagination" v-if="totalPages > 1 && store.totalApiMatches > 0">
      <li class="page-item" :class="{ disabled: store.currentPage === 1 }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(1)">&laquo;</a>
      </li>

      <template v-for="page in totalPages" :key="page">
        <li
          v-if="
            page === 1 ||
            page === totalPages ||
            (page >= store.currentPage - 2 && page <= store.currentPage + 2)
          "
          class="page-item"
          :class="{ active: page === store.currentPage }"
        >
          <a class="page-link" href="#" @click.prevent="handlePageChange(page)">{{ page }}</a>
        </li>
        <li
          v-else-if="page === store.currentPage - 3 || page === store.currentPage + 3"
          class="page-item disabled"
        >
          <span class="page-link">...</span>
        </li>
      </template>

      <li class="page-item" :class="{ disabled: store.currentPage === totalPages }">
        <a class="page-link" href="#" @click.prevent="handlePageChange(totalPages)">&raquo;</a>
      </li>
    </ul>
  </div>
</template>
