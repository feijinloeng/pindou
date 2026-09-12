# 静态本地工具，不用 Next.js

前端用 Vite + React + TypeScript 构建，产物是纯静态文件，部署到任何静态托管。不引入 Next.js、不做 SSR、不建 API 路由、不接账号中间件。

理由：本工具没有任何服务端需求。图片解码、颜色匹配、图纸渲染、PDF 生成全部在浏览器里完成，唯一的数据交换是文件下载。这是隐私承诺的前提，也是离线可用的前提。

## Considered Options

- **Next.js**：本领域多数同类项目（Zippland/perler-beads、LunarXuan/Pindo、ktwu01/perler-beads）用它。但它带来 Node 生产运行时、路由和打包约束，而本项目用不到任何一项。
- **Vue 3 + Vite**：同样合适（yourlin、Aswellle 用它）。选 React 只是因为它在这个领域的可参考实现最多。
- **Vite + React 静态** ← 选定。

## Consequences

后续若要加"分享码"或"作品社区"，那需要一个独立后端，届时另开一个部署单元，不要把服务端需求塞回这个前端。作品的本地持久化和工程文件用浏览器存储 + 文件下载解决。
