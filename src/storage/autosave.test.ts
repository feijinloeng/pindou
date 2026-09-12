import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearAll } from './db'
import { startAutosave } from './autosave'
import { useEditor } from '../editor/store'

/** node 环境没有 document：补一个只记事件的最小实现 */
function stubDocument() {
  const listeners = new Map<string, Set<() => void>>()
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    },
  })
  return listeners
}

const store = () => useEditor.getState()

beforeEach(async () => {
  await clearAll()
  store().newProject('自动保存测试')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('自动保存', () => {
  it('订阅了改动的 debounce 写盘，取消订阅后不再写', async () => {
    const listeners = stubDocument()
    const stop = startAutosave(5)
    expect(listeners.get('visibilitychange')?.size).toBe(1)

    store().setTool('pencil')
    store().setColor(2)
    store().pointerDown(0, 0, 0, false)
    store().pointerUp()

    await vi.waitFor(() => expect(store().savedAt).not.toBeNull(), { timeout: 1000 })
    const savedAt = store().savedAt

    // 切页面 → 取消订阅：定时器和事件监听都要跟着走
    stop()
    expect(listeners.get('visibilitychange')?.size).toBe(0)

    store().setName('取消订阅后的改动')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(store().savedAt).toBe(savedAt)
    expect(store().name).toBe('取消订阅后的改动')
  })
})
