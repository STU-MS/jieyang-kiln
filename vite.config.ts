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
  server: {
    // Windows 上某些编辑器「写临时文件再改名」的保存方式会让 chokidar 撞 EBUSY
    // 直接崩掉 dev server（watch 到一个立刻消失的临时文件）。几种常见命名都忽略掉：
    //   .name.ts.1234.uuid.tmpdir/  ·  name.ts~RF1234.TMP  ·  .~name.ts
    watch: {
      ignored: [
        '**/*.tmpdir/**',
        '**/*.tmpdir',
        '**/*.{tmp,TMP}',
        '**/*~RF*',
        '**/.~*',
      ],
    },
  },
})
