import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 三个页面各自懒加载（见 App.tsx）；色板数据 686KB 是三个页面共享的，单独成块。
    // 门禁定在 500KB：再冒出更大的单块就说明又不小心把渲染/导出的东西塞回首屏了
    chunkSizeWarningLimit: 500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/data/palettes.json'],
      // 门槛压在实测值之下一点点（2026-09 实测 语句 70.9% / 分支 62.7% / 函数 61.4%）：
      // 目的是拦住"越写越低"，不是逼着冲数字
      thresholds: {
        statements: 68,
        branches: 60,
        functions: 58,
        lines: 69,
      },
    },
  },
})
