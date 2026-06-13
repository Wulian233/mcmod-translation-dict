<script setup>
import { ref, computed } from 'vue'
import { getModLinks } from '../utils.js'

const props = defineProps({
  item: Object,
})

const isExpanded = ref(false)

const modItems = computed(() => getModLinks(props.item))
const totalMods = computed(() => modItems.value.length)
const hasMultipleMods = computed(() => totalMods.value > 1)

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div v-if="modItems.length > 0">
    <span :title="modItems[0].key">
      {{ modItems[0].name }}
      <a
        v-if="modItems[0].curseforgeUrl"
        :href="modItems[0].curseforgeUrl"
        target="_blank"
        rel="noopener noreferrer"
        title="在 CurseForge 查看"
        class="mod-link-icon"
      >
        <img src="/curseforge.svg" alt="CurseForge" width="16" height="16" />
      </a>
      <a
        v-if="modItems[0].mcmodUrl"
        :href="modItems[0].mcmodUrl"
        target="_blank"
        rel="noopener noreferrer"
        title="在 MC 百科搜索"
        class="mod-link-icon"
      >
        <img src="/mcmod.svg" alt="MC百科" width="16" height="16" />
      </a>
    </span>

    <span
      v-if="hasMultipleMods"
      class="text-primary"
      style="cursor: pointer; margin-left: 8px"
      @click="toggleExpand"
    >
      {{ isExpanded ? '收起' : `...（展开 ${totalMods - 1} 个）` }}
    </span>

    <div class="expandable-content mt-2" v-show="isExpanded">
      <span
        v-for="(mod, index) in modItems.slice(1)"
        :key="index"
        style="display: block"
        :title="mod.key"
      >
        {{ mod.name }}
        <a
          v-if="mod.curseforgeUrl"
          :href="mod.curseforgeUrl"
          target="_blank"
          rel="noopener noreferrer"
          title="在 CurseForge 查看"
          class="mod-link-icon"
        >
          <img src="/curseforge.svg" alt="CurseForge" width="16" height="16" />
        </a>
        <a
          v-if="mod.mcmodUrl"
          :href="mod.mcmodUrl"
          target="_blank"
          rel="noopener noreferrer"
          title="在 MC 百科搜索 ModID"
          class="mod-link-icon"
        >
          <img src="/mcmod.svg" alt="MC百科" width="16" height="16" />
        </a>
      </span>
    </div>
  </div>
  <span v-else>无</span>
</template>

<style scoped>
.mod-link-icon {
  margin-left: 4px;
}
</style>
