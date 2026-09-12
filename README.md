# 拼豆定制工作台

一个网页端的拼豆定制工作台：选板阵 → 导图片 → 转换 → 逐豆编辑 → 保存工程 → 导出三种格式 → 跟做模式。

**执行说明书在 `技术路线图.md`**（进度、实测数字、人工验收清单都在里面）。
术语定义在 `CONTEXT.md`，不可逆决策在 `docs/adr/`。

测试数量不写在文档里（会漂）：用 `npm run ci` 跑一次，数字在输出里。

## 跑起来

```bash
npm install
npm run dev          # 开发
npm run ci           # typecheck + lint + 确定性门禁 + 单测（带覆盖率门槛）
npm run build        # 产出 dist/，纯静态
npm run e2e          # 真浏览器回归（自己起服务器，需要 Chrome/Chromium）
```

## 常用脚本

```bash
npx jiti scripts/build-palettes.ts   # 重新生成 src/data/palettes.json（要联网）
npx jiti scripts/bench-pdf.ts        # 133 万格 PDF 基准（大小 / 操作符 / 耗时）
npx jiti scripts/stress.ts           # 500 万格全链路压测
npx jiti scripts/samples.ts          # 生成 samples/ 里那几个可以拿去看的样例
npm run e2e                          # 四组浏览器回归：导入转换 / 自由拼板 / 跟做 / P1 界面
npm run coverage                     # 单测覆盖率（门槛写在 vite.config.ts）
npm run make:test-image              # 重新生成 samples/e2e/test-image.png（固定测试图）
node scripts/check-no-random.mjs     # 转换链路不许有随机初始化（adr/0004）
```

想看单个 e2e 脚本的细节：先 `npm run dev`，再 `node scripts/e2e-import.mjs`（脚本头部有说明）。
`CHROME_PATH=/path/to/chrome` 可以换浏览器；`E2E_URL=http://host:port` 可以对着已有实例跑。

### 浏览器支持范围

| 浏览器 | 状态 |
|---|---|
| Chrome / Edge（Chromium 116+） | 跑过完整回归（`npm run e2e` 就是跑它） |
| Safari 16+ | 手动验收，靠 `gesture*` 事件做捏合缩放（没有自动化） |
| Firefox | 未验证（IndexedDB + Canvas 路径理论上可用） |
| 触控 / 平板 | 选板拖放、画布平移缩放、跟做标记都走 Pointer Events，窄屏布局见下 |

界面按 **≥1024px 宽** 设计（左右各 256px 面板 + 中间画布）。窄屏可以收起侧栏，但不保证平板竖屏下的编辑体验。

## 结构

```
src/domain/      纯逻辑：板型与自由摆放的板阵、豆格（含空档遮罩）、坐标换算、工程序列化与校验、色卡类型
src/conversion/  转换链路：分析 → 降采样 → 预处理 → 色差匹配 → 限色 → 去杂 → 去背景 + Worker
src/render/      视口/画布、位图缓存、制作文档布局引擎、屏幕版、纸面版、预览图、PDF 写入、导出编排
                 （colors.ts / download.ts 单独拆出来，是为了不让作品库首屏拖进整条渲染链）
src/editor/      Zustand store、工具、选区、增量撤销（含色板元数据）、压测
src/pages/       BoardPicker（选板页：自由拼台面）、Editor、Library、Follow（三个页面各自懒加载）
src/follow/      跟做模式的连通域与推荐策略
src/storage/     IndexedDB、源图缓存、自动保存
src/data/        palettes.json（构建产物，不要手改）
samples/         可以打开看的样例 PDF
samples/e2e/     浏览器回归用的固定测试图
```

## 首屏体积

三个页面各自一个 chunk：进作品库不会加载画布渲染、图片转换和 PDF 导出那几百 KB。
色板数据（2274 色，约 90KB gzip）是三个页面共享的，仍在首个共享 chunk 里。
实测首屏 JS：从单包 988KB / 304KB gzip 降到约 237KB / 78KB gzip（不含后续按需加载）。

## 许可证与商标

- 应用代码：本项目自己的。
- 色卡数据：`maxcleme/beadcolors`（MIT）、`HansBug/pindou-color-data`（MIT）、
  `pomodiary/bitbead.app`（CC BY 4.0，v1 未使用）。
- 只参考思路、不复制代码的开源项目见技术路线图第 17 节。
- MARD、Artkal、Hama、Perler 等是各自所有者的商标，本项目只用于描述兼容性。
