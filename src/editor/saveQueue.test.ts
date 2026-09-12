import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '../domain/project'

/**
 * 保存队列：并发的两次写盘会互相覆盖，后写的可能带着更旧的快照。
 * 这里把 putProject 卡住，模拟"第一次还没写完，用户又改了一次"。
 */
const written: Project[] = []
let release: (() => void) | null = null
let firstCall = true

vi.mock('../storage/db', () => ({
  putProject: async (project: Project) => {
    if (firstCall) {
      firstCall = false
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    written.push(project)
  },
  saveDraft: async () => {},
  rememberLastProject: () => {},
  restoreLastProject: async () => undefined,
}))

const { useEditor } = await import('./store')

const store = () => useEditor.getState()

beforeEach(() => {
  written.length = 0
  firstCall = true
  release = null
  store().newProject('保存队列测试')
  store().setTool('pencil')
  store().setColor(3)
})

describe('保存队列', () => {
  it('保存期间的新编辑不会被旧快照覆盖（第二次保存带着最新状态）', async () => {
    // 第一次编辑 + 第一次保存（会卡在 putProject 上）
    store().pointerDown(1, 1, 0, false)
    store().pointerUp()
    const first = store().saveNow()
    await vi.waitFor(() => expect(release).not.toBeNull())

    // 写盘还没结束，用户又落了一颗
    store().pointerDown(2, 2, 0, false)
    store().pointerUp()
    const second = store().saveNow()

    release!()
    await Promise.all([first, second])

    expect(written).toHaveLength(2)
    const last = written[written.length - 1]
    const cols = last.grid.cols
    expect(last.grid.cells[1 * cols + 1]).toBe(3)
    expect(last.grid.cells[2 * cols + 2]).toBe(3) // 新编辑也落盘了
    expect(store().saveError).toBeNull()
    expect(store().saving).toBe(false)
    expect(store().savedAt).not.toBeNull()
  })

  it('写盘失败时留下原因，saving 不会卡在 true', async () => {
    const db = await import('../storage/db')
    const spy = vi.spyOn(db, 'putProject').mockRejectedValueOnce(new Error('磁盘满了'))
    await store().saveNow()
    expect(store().saving).toBe(false)
    expect(store().saveError).toBe('磁盘满了')
    spy.mockRestore()
  })
})
