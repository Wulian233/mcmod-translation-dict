import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  root: 'frontend',
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'public',
  base: './',

  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    ),
  },

  server: {
    port: 5173,
    open: true,
  },

  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
