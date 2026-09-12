import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import Editor from './Editor'
import Follow from './Follow'
import Library from './Library'

/**
 * 冒烟测试：每个页面各自渲染一次，断言那个页面**独有**的东西。
 *
 * 以前这里是个循环里反复 renderToString(<App />)，只检查应用标题 ——
 * 三个"路由"其实测的是同一个页面，等于没测（P2-30）。
 *
 * 这里跑不了 Canvas / ResizeObserver / IndexedDB（effect 不执行），
 * 但能抓到组件级别的崩溃，比开浏览器快得多。
 */
describe('页面冒烟', () => {
  it('编辑器渲染出工具栏、色号表和选区面板', () => {
    const html = renderToString(<Editor />)
    expect(html).toContain('显示色号')
    expect(html).toContain('油漆桶')
    expect(html).toContain('性能自测')
    expect(html).toContain('MARD 291')
  })

  it('作品库渲染出新建 / 导入入口，不会渲染成编辑器', () => {
    const html = renderToString(<Library />)
    expect(html).toContain('作品库')
    expect(html).toContain('新建')
    expect(html).toContain('导入工程文件')
    expect(html).not.toContain('显示色号')
  })

  it('跟做模式渲染出自己的空状态，不会渲染成编辑器', () => {
    const html = renderToString(<Follow />)
    // 空作品时不再骗人地显示 100%（P1-09）
    expect(html).toContain('暂无可跟做内容')
    expect(html).not.toContain('显示色号')
  })
})
