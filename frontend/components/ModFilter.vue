<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStore, updateState } from '../store.js'
import { applyModFilter } from '../services/searchService.js'

const store = useStore()
const showSuggestions = ref(false)
const FILTER_DEBOUNCE_MS = 400
let filterTimer = null

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

function handleModFilterInput(e) {
  const inputValue = e.target.value
  updateState({ modFilterValue: inputValue })

  showSuggestions.value = true
  scheduleFilter(inputValue.trim())
}

function scheduleFilter(expectedValue) {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => {
    if (store.modFilterValue.trim() !== expectedValue) return

    if (store.searchLoading) {
      scheduleFilter(expectedValue)
      return
    }

    applyModFilter()
  }, FILTER_DEBOUNCE_MS)
}

function applyFilterNow() {
  const expectedValue = store.modFilterValue.trim()
  clearTimeout(filterTimer)

  if (store.searchLoading) {
    scheduleFilter(expectedValue)
    return
  }

  applyModFilter()
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
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

function handleFocus() {
  if (store.availableMods.length > 0) {
    showSuggestions.value = true
  }
}

onBeforeUnmount(() => clearTimeout(filterTimer))
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
