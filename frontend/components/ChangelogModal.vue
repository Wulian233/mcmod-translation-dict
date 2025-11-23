<script setup>
import { onMounted, ref } from 'vue';
import { useStore, updateState } from '../store.js';
import * as bootstrap from 'bootstrap';

const store = useStore();
const modalRef = ref(null);

async function fetchAndPopulateChangelog() {
    if (store.changelogFetched) {
        return;
    }
    
    try {
        const res = await fetch("changelog.json");
        const data = await res.json();
        updateState({ changelogData: data, changelogFetched: true });
    } catch {
        console.error("无法加载更新日志");
        const tempErrorData = [{
            version: '加载失败',
            date: new Date().toLocaleDateString(),
            changes: ['❌ 无法加载更新日志']
        }];
        updateState({ changelogData: tempErrorData });
    }
}

onMounted(() => {
    if (modalRef.value && typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const modalInstance = new bootstrap.Modal(modalRef.value);
        updateState({ changelogModal: modalInstance });

        modalRef.value.addEventListener('show.bs.modal', fetchAndPopulateChangelog);
    }
});
</script>

<template>
  <div class="modal fade" id="changelogModal" tabindex="-1" aria-labelledby="changelogModalLabel" ref="modalRef">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title" id="changelogModalLabel">📜 更新日志</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button>
            </div>
            <div class="modal-body" id="changelogBody">
                <div v-if="!store.changelogFetched && store.changelogData.length === 0">正在加载...</div>
                <div v-else>
                    <div v-for="entry in store.changelogData" :key="entry.version" class="changelog-entry">
                        <h6>{{ entry.version }} ({{ entry.date }})</h6>
                        <ul>
                            <li v-for="(change, index) in entry.changes" :key="index">{{ change }}</li>
                        </ul>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
            </div>
        </div>
    </div>
  </div>
</template>