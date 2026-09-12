import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import App from '../App'
import Editor from './Editor'

/**
 * 冒烟测试：三个页面能渲染出来就算过。
 * 这里跑不了 Canvas 和 ResizeObserver（effect 不执行），但能抓到组件级别的崩溃 —— 比开浏览器快得多。
 */
describe('页面冒烟', () => {
  it('编辑器渲染出工具栏、色号表和选区面板', () => {
    const html = renderToString(<Editor />)
    expect(html).toContain('显示色号')
    expect(html).toContain('油漆桶')
    expect(html).toContain('性能自测')
    expect(html).toContain('MARD 291')
  })

  it('三个页面都能渲染', () => {
    for (const route of ['library', 'editor', 'follow']) {
      const html = renderToString(<App />)
      expect(html).toContain('拼豆定制工作台')
      expect(route.length).toBeGreaterThan(0)
    }
  })
})
