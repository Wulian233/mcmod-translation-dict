<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStore, updateState } from '../store.js'
import { SEARCH_CONFIG } from '../config.js'
import { applyModFilter } from '../services/searchService.js'

const store = useStore()
const showSuggestions = ref(false)
const FILTER_DEBOUNCE_MS = SEARCH_CONFIG.minIntervalMs
let filterTimer = null
let blurTimer = null
let pendingFilterValue = null
let isMounted = true

const isFilterVisible = computed(() => store.availableMods.length > 0)

const filteredSuggestions = computed(() => {
  const inputValue = store.modFilterValue.trim().toLowerCase()

  if (inputValue === '') {
    return [
      { text: '显示全部模组', value: '', type: 'all' },
      ...store.availableMods.map((mod) => ({ text: mod, value: mod, type: 'mod' })),
    ]
  }

  return store.availableMods
    .filter((mod) => mod.toLowerCase().includes(inputValue))
    .map((mod) => ({ text: mod, value: mod, type: 'mod' }))
})

function clearFilterTimer() {
  if (filterTimer !== null) {
    clearTimeout(filterTimer)
    filterTimer = null
  }
}

function queueFilter(expectedValue, delay = FILTER_DEBOUNCE_MS) {
  if (!isMounted) return
  pendingFilterValue = expectedValue
  clearFilterTimer()

  filterTimer = setTimeout(() => {
    filterTimer = null
    const targetValue = pendingFilterValue
    pendingFilterValue = null
    if (!isMounted || targetValue === null) return
    attemptFilter(targetValue)
  }, delay)
}

async function attemptFilter(expectedValue) {
  if (!isMounted) return

  if (store.modFilterValue.trim() !== expectedValue) {
    queueFilter(store.modFilterValue.trim())
    return
  }

  const result = await applyModFilter()
  if (!isMounted) return

  const currentValue = store.modFilterValue.trim()
  if (currentValue !== expectedValue) {
    queueFilter(currentValue)
    return
  }

  if (result?.status === 'throttled' || result?.status === 'busy') {
    // Keep trying the latest value at the normal interval. One timer at a
    // time prevents duplicate queued requests and tight retry loops.
    queueFilter(expectedValue)
  }
}

function handleModFilterInput(e) {
  const inputValue = e.target.value
  updateState({ modFilterValue: inputValue })

  showSuggestions.value = true
  queueFilter(inputValue.trim())
}

function applyFilterNow() {
  clearFilterTimer()
  pendingFilterValue = null
  attemptFilter(store.modFilterValue.trim())
}

function selectSuggestion(modValue) {
  updateState({ modFilterValue: modValue })
  showSuggestions.value = false
  applyFilterNow()
}

function submitTypedFilter() {
  showSuggestions.value = false
  applyFilterNow()
}

function handleBlur() {
  // 延迟隐藏建议，以便点击建议项
  if (blurTimer !== null) clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    blurTimer = null
    if (isMounted) showSuggestions.value = false
  }, 200)
}

function handleFocus() {
  if (store.availableMods.length > 0) {
    showSuggestions.value = true
  }
}

onBeforeUnmount(() => {
  isMounted = false
  clearFilterTimer()
  if (blurTimer !== null) clearTimeout(blurTimer)
  blurTimer = null
  pendingFilterValue = null
})
</script>

<template>
  <div :style="{ display: isFilterVisible ? 'block' : 'none' }" class="mb-3">
    <label for="modFilter" class="form-label">筛选模组：</label>
    <div class="position-relative">
      <input
        type="text"
        id="modFilter"
        class="form-control"
        placeholder="输入模组ID或留空显示全部..."
        autocomplete="off"
        :value="store.modFilterValue"
        @input="handleModFilterInput"
        @keydown.enter.prevent="submitTypedFilter"
        @blur="handleBlur"
        @focus="handleFocus"
      />
      <div
        id="modSuggestions"
        class="position-absolute w-100 border border-top-0 rounded-bottom shadow-sm z-3 list-group"
        :style="{ display: showSuggestions ? 'block' : 'none' }"
      >
        <div v-if="filteredSuggestions.length === 0" class="px-3 py-2 suggestion-item">
          未找到匹配的模组
        </div>
        <div v-else>
          <div
            v-for="mod in filteredSuggestions"
            :key="mod.value || 'all'"
            class="px-3 py-2 suggestion-item list-group-item"
            :class="{ 'text-primary': mod.type === 'all' }"
            @mousedown.prevent="selectSuggestion(mod.value)"
          >
            {{ mod.text }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
