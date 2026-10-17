import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 静态资源全部相对路径：GitHub Pages 子路径、本地静态服务器解压即用
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: 'es',
  },
})
