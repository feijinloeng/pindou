import { describe, expect, it } from 'vitest'

import { isEditableTarget, isComposing, shouldHandleCanvasKey } from './keyboard'

describe('快捷键让路判断', () => {
  it('输入框 / 文本域 / 下拉框 / 可编辑区里都不抢键盘', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'input']) {
      expect(isEditableTarget({ tagName })).toBe(true)
    }
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('普通元素和 null 不当成输入中', () => {
    expect(isEditableTarget({ tagName: 'DIV' })).toBe(false)
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
  })

  it('中文输入法组合输入期间不触发画布快捷键', () => {
    expect(isComposing({ isComposing: true })).toBe(true)
    expect(isComposing({ keyCode: 229 })).toBe(true)
    expect(isComposing({ keyCode: 66 })).toBe(false)
  })

  it('shouldHandleCanvasKey 组合两条规则', () => {
    expect(shouldHandleCanvasKey({ target: { tagName: 'INPUT' } })).toBe(false)
    expect(shouldHandleCanvasKey({ target: { tagName: 'CANVAS' }, isComposing: true })).toBe(false)
    expect(shouldHandleCanvasKey({ target: { tagName: 'CANVAS' } })).toBe(true)
    expect(shouldHandleCanvasKey({ target: { tagName: 'BODY' } })).toBe(true)
  })
})
