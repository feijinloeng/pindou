import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 三个页面各自懒加载（见 App.tsx）；色板数据 686KB 是三个页面共享的，单独成块。
    // 门禁定在 500KB：再冒出更大的单块就说明又不小心把渲染/导出的东西塞回首屏了
    chunkSizeWarningLimit: 500,
  },
})
