import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { deriveGeometry } from '../domain/board'
import { createGrid } from '../domain/grid'
import { createProject, parseProject, projectSummary, serializeProject } from '../domain/project'
import {
  clearAll,
  clearDraft,
  getDraft,
  getProject,
  lastProjectId,
  listProjectEntries,
  listProjects,
  purgeProject,
  put,
  putProject,
  rememberLastProject,
  restoreLastProject,
  restoreProject,
  saveDraft,
  trashProject,
} from './db'

function project(name: string) {
  const boardArray = { rows: [['mini52'] as const], gapMm: 0 }
  const geometry = deriveGeometry(boardArray as never)
  const grid = createGrid(geometry.cols, geometry.rows)
  grid.cells[0] = 3
  return createProject({ name, boardArray: boardArray as never, paletteId: 'mard-291', grid })
}

beforeEach(async () => {
  await clearAll()
})

describe('作品库持久化', () => {
  it('建 3 个工程，重新打开都在（模拟关掉浏览器再进来）', async () => {
    await putProject(project('客户 A'))
    await putProject(project('客户 B'))
    await putProject(project('客户 C'))
    const all = await listProjects()
    expect(all).toHaveLength(3)
    expect(all.map((p) => p.name).sort()).toEqual(['客户 A', '客户 B', '客户 C'])
  })

  it('按更新时间倒序，最近改的排最前', async () => {
    const a = project('旧的')
    a.updatedAt = '2020-01-01T00:00:00.000Z'
    const b = project('新的')
    b.updatedAt = '2030-01-01T00:00:00.000Z'
    await putProject(a)
    await putProject(b)
    expect((await listProjects())[0].name).toBe('新的')
  })

  it('草稿比正式保存新时，打开应该拿草稿', async () => {
    const p = project('草稿测试')
    await putProject(p)
    p.grid.cells[5] = 7
    await saveDraft(p)
    const draft = await getDraft(p.id)
    expect(draft?.grid.cells[5]).toBe(7)
    expect((await getProject(p.id))?.grid.cells[5]).toBe(0xffff)
    await clearDraft(p.id)
    expect(await getDraft(p.id)).toBeUndefined()
  })

  it('删除是回收站语义：不物理删，能恢复', async () => {
    const p = project('要删的')
    await putProject(p)
    await trashProject(p.id)
    const trashed = await getProject(p.id)
    expect(trashed?.name).toBe('[已删除] 要删的')
    await restoreProject(p.id)
    expect((await getProject(p.id))?.name).toBe('要删的')
  })

  it('彻底删除连草稿一起清掉', async () => {
    const p = project('清掉的')
    await putProject(p)
    await saveDraft(p)
    await purgeProject(p.id)
    expect(await getProject(p.id)).toBeUndefined()
    expect(await getDraft(p.id)).toBeUndefined()
  })

  it('老版本存的工程（只有 boardArray、没有 layout）读出来不炸', async () => {
    const legacy = project('老工程')
    delete (legacy as { layout?: unknown }).layout
    legacy.boardArray = { rows: [['mini52']], gapMm: 0 }
    await put('projects', legacy)
    const [restored] = await listProjects()
    expect(restored.layout.placements).toEqual([{ board: 'mini52', col: 0, row: 0 }])
    expect(projectSummary(restored).boardCount).toBe(1)
    expect((await getProject(restored.id))?.layout.placements).toHaveLength(1)
  })

  it('存进去的工程能原样导出再导入（逐格相同）', async () => {
    const p = project('往返')
    p.grid.cells[10] = 9
    await putProject(p)
    const back = await getProject(p.id)
    const text = serializeProject(back!)
    const parsed = parseProject(text)
    expect(parsed.error).toBeNull()
    expect(parsed.project!.grid.cells[10]).toBe(9)
    expect(parsed.project!.name).toBe('往返')
  })
})

describe('作品库列表（P2-07）', () => {
  it('列表拿的是最新快照：草稿比正式工程新时就显示草稿', async () => {
    const p = project('落后了')
    p.updatedAt = '2020-01-01T00:00:00.000Z'
    await putProject(p)
    const draft = { ...p, updatedAt: '2030-01-01T00:00:00.000Z' }
    draft.grid = { ...p.grid, cells: p.grid.cells.slice() }
    draft.grid.cells[0] = 9
    await saveDraft(draft)
    const { entries } = await listProjectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].hasNewerDraft).toBe(true)
    expect(entries[0].project.grid.cells[0]).toBe(9)
  })

  it('正式工程更新时不标记草稿，但也不丢掉草稿数据', async () => {
    const p = project('最新')
    p.updatedAt = '2030-01-01T00:00:00.000Z'
    await putProject(p)
    await saveDraft({ ...p, updatedAt: '2020-01-01T00:00:00.000Z' })
    const { entries } = await listProjectEntries()
    expect(entries[0].hasNewerDraft).toBe(false)
    expect(entries[0].project.name).toBe('最新')
  })

  it('坏条目进 issues，不把整个作品库带崩', async () => {
    await putProject(project('好的'))
    await put('projects', { id: 'bad', name: '坏的', schemaVersion: 1, grid: { cols: 0, rows: 0 } })
    const { entries, issues } = await listProjectEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].project.name).toBe('好的')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('坏的')
  })

  it('IndexedDB 里的对象和工程文件同一套校验：空档脏数据会被清', async () => {
    const p = project('L 形')
    p.layout = {
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    }
    const { deriveLayoutGeometry } = await import('../domain/board')
    const geometry = deriveLayoutGeometry(p.layout)
    p.grid = createGrid(geometry.cols, geometry.rows, 0xffff, geometry.placeable)
    p.grid.cells[60 * geometry.cols + 120] = 5
    await put('projects', p)
    const [back] = await listProjects()
    expect(back.grid.cells[60 * geometry.cols + 120]).toBe(0xffff)
  })
})

describe('回收站与“上次打开的工程”（P2-08）', () => {
  it('删除会清掉“上次打开”，不会再自动恢复回来', async () => {
    const p = project('删掉就别回来')
    await putProject(p)
    rememberLastProject(p.id)
    await trashProject(p.id)
    expect(lastProjectId()).toBeNull()
    await clearDraft(p.id)
    expect(await restoreLastProject()).toBeUndefined()
  })

  it('彻底删除也会清掉指针', async () => {
    const p = project('彻底删')
    await putProject(p)
    rememberLastProject(p.id)
    await purgeProject(p.id)
    expect(lastProjectId()).toBeNull()
  })

  it('已经进了回收站的工程不会被自动恢复', async () => {
    const p = project('回收站里')
    await putProject(p)
    await trashProject(p.id)
    rememberLastProject(p.id)
    expect(await restoreLastProject()).toBeUndefined()
  })
})
