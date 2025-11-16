<script setup>
import { computed, ref } from 'vue';
import { useStore, updateState } from '../store.js';
import { applyModFilter } from '../services/searchService.js';

const store = useStore();
const showSuggestions = ref(false);

const isFilterVisible = computed(() => store.availableMods.length > 0);

const filteredSuggestions = computed(() => {
  const inputValue = store.modFilterValue.trim().toLowerCase();
  
  if (inputValue === "") {
    return [
      { text: "显示全部模组", value: "", type: "all" },
      ...store.availableMods.slice(0, 10).map(mod => ({ text: mod, value: mod, type: "mod" }))
    ];
  } else {
    return store.availableMods
      .filter(mod => mod.toLowerCase().includes(inputValue))
      .map(mod => ({ text: mod, value: mod, type: "mod" }));
  }
});

const moreSuggestionsCount = computed(() => {
  if (store.modFilterValue.trim() === "") {
    return Math.max(0, store.availableMods.length - 10);
  }
  return 0;
});

function handleModFilterInput(e) {
  const inputValue = e.target.value;
  updateState({ modFilterValue: inputValue });
  
  showSuggestions.value = true;
  
  if (store.currentPage !== 1) {
    updateState({ currentPage: 1 });
  }

  // 立即应用筛选，显示筛选后的结果
  applyModFilter();
}

function selectSuggestion(modValue) {
  updateState({ modFilterValue: modValue });
  showSuggestions.value = false;
  applyModFilter();
}

function handleBlur() {
  // 延迟隐藏建议，以便点击建议项
  setTimeout(() => {
    showSuggestions.value = false;
  }, 200);
}

function handleFocus() {
  if (store.availableMods.length > 0) {
    showSuggestions.value = true;
  }
}
</script>

<template>
  <div id="filterContainer" :style="{ display: isFilterVisible ? 'block' : 'none' }" class="mb-3">
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
          <div v-if="moreSuggestionsCount > 0" class="px-3 py-2 small">
            还有 {{ moreSuggestionsCount }} 个模组，请输入关键词筛选...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>