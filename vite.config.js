import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  root: 'frontend',
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
