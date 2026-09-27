import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import mcmodRelay from './api/mcmod.js'

function localMcmodRelay() {
  const register = (server) => {
    server.middlewares.use((req, res, next) => {
      if (new URL(req.url, 'http://localhost').pathname !== '/api/mcmod') return next()
      mcmodRelay(req, res).catch(next)
    })
  }
  return { name: 'mcmod-relay', configureServer: register, configurePreviewServer: register }
}

export default defineConfig({
  plugins: [vue(), localMcmodRelay()],
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
