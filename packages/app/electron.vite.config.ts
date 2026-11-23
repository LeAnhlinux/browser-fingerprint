import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // Gộp mọi phụ thuộc (kể cả @bf/core, @bf/api mà pnpm liên kết bằng symlink) vào file main,
    // để bộ cài không cần thư mục node_modules. Không có module native nào.
    build: { externalizeDeps: false }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
