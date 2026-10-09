<script setup>
import { onMounted, ref } from 'vue'
import * as bootstrap from 'bootstrap'

const modalRef = ref(null)

onMounted(() => {
  if (modalRef.value && bootstrap.Modal) {
    new bootstrap.Modal(modalRef.value, { backdrop: 'static' }).show()
  }
})
</script>

<template>
  <div
    ref="modalRef"
    class="modal fade"
    id="migrationNoticeModal"
    tabindex="-1"
    aria-labelledby="migrationNoticeModalLabel"
    aria-modal="true"
    role="dialog"
  >
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="migrationNoticeModalLabel">网站迁移通知</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button>
        </div>
        <div class="modal-body">
          <p>词典已迁移至新网站，请前往使用：</p>
          <p class="mb-0">
            <a href="https://dict.vmct.top">https://dict.vmct.top</a>
          </p>
          <p class="small text-muted mt-3 mb-0">现有网站将于 2026 年 11 月 1 日自动重定向至新网站。</p>
        </div>
        <div class="modal-footer">
          <a class="btn btn-primary" href="https://dict.vmct.top">前往新网站</a>
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">继续访问本站</button>
        </div>
      </div>
    </div>
  </div>
</template>
