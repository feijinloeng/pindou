# 拼豆定制工作台

一个网页端的拼豆定制工作台：选板阵 → 导图片 → 转换 → 逐豆编辑 → 保存工程 → 导出三种格式 → 跟做模式。

**执行说明书在 `技术路线图.md`**（进度、实测数字、人工验收清单都在里面）。
术语定义在 `CONTEXT.md`，不可逆决策在 `docs/adr/`。

## 跑起来

```bash
npm install
npm run dev          # 开发
npm run ci           # typecheck + lint + 确定性门禁 + 单测（244 个）
npm run build        # 产出 dist/，纯静态
```

## 常用脚本

```bash
npx jiti scripts/build-palettes.ts   # 重新生成 src/data/palettes.json（要联网）
npx jiti scripts/bench-pdf.ts        # 133 万格 PDF 基准（大小 / 操作符 / 耗时）
npx jiti scripts/stress.ts           # 500 万格全链路压测
npx jiti scripts/samples.ts          # 生成 samples/ 里那几个可以拿去看的样例
node scripts/e2e-import.mjs          # 浏览器端导入/转换/缩放手势回归（要先 npm run dev）
node scripts/e2e-follow.mjs          # 跟做模式在 130 万格下的响应时间回归
node scripts/e2e-board.mjs           # 自由拼板（选板页）回归
node scripts/check-no-random.mjs     # 转换链路不许有随机初始化（adr/0004）
```

## 结构

```
src/domain/      纯逻辑：板型与自由摆放的板阵、豆格（含空档遮罩）、坐标换算、工程序列化、色卡类型
src/conversion/  转换链路：分析 → 降采样 → 预处理 → 色差匹配 → 限色 → 去杂 → 去背景 + Worker
src/render/      视口/画布、位图缓存、制作文档布局引擎、屏幕版、纸面版、预览图、PDF 写入、导出编排
src/editor/      Zustand store、工具、选区、增量撤销、压测
src/pages/       BoardPicker（选板页：自由拼台面）、Editor、Library、Follow
src/follow/      跟做模式的连通域与推荐策略
src/storage/     IndexedDB、源图缓存、自动保存
src/data/        palettes.json（构建产物，不要手改）
samples/         可以打开看的样例 PDF
```

## 许可证与商标

- 应用代码：本项目自己的。
- 色卡数据：`maxcleme/beadcolors`（MIT）、`HansBug/pindou-color-data`（MIT）、
  `pomodiary/bitbead.app`（CC BY 4.0，v1 未使用）。
- 只参考思路、不复制代码的开源项目见技术路线图第 17 节。
- MARD、Artkal、Hama、Perler 等是各自所有者的商标，本项目只用于描述兼容性。
