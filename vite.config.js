import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  root: "frontend",
  publicDir: "public",
  base: "./",

  server: {
    port: 5173,
    open: true,
  },

  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
