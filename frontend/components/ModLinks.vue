<script setup>
import { ref, computed } from 'vue';
import { getModLinks } from '../utils.js';

const props = defineProps({
  item: Object
});

const isExpanded = ref(false);

const modItems = computed(() => getModLinks(props.item));
const totalMods = computed(() => modItems.value.length);
const hasMultipleMods = computed(() => totalMods.value > 1);

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}
</script>

<template>
  <div v-if="modItems.length > 0">
    <span v-html="modItems[0].html"></span>

    <span 
      v-if="hasMultipleMods"
      class="expand-btn text-primary" 
      style="cursor: pointer; margin-left: 8px;"
      @click="toggleExpand"
    >
      {{ isExpanded ? "收起" : `...（展开 ${totalMods - 1} 个）` }}
    </span>

    <div class="expandable-content mt-2" v-show="isExpanded">
      <span v-for="(mod, index) in modItems.slice(1)" :key="index" v-html="mod.html" style="display: block;"></span>
    </div>
  </div>
  <span v-else>无</span>
</template>