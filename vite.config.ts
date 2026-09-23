import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 编辑器与作品库共享色板数据；色板单独成块，避免并入任一页面的首屏 chunk。
    // 门禁定在 500KB：再冒出更大的单块就说明又不小心把渲染/导出的东西塞回首屏了
    chunkSizeWarningLimit: 500,
  },
})
