import { describe, expect, it } from 'vitest'

import { EMPTY, createGrid, gridEquals } from '../domain/grid'
import { History, PatchRecorder, applyPatch } from './history'

describe('PatchRecorder + History', () => {
  it('画→撤销→逐格回到原状（字节级相同）', () => {
    const grid = createGrid(4, 4)
    const before = createGrid(4, 4)
    const rec = new PatchRecorder(grid, '画笔')
    rec.set(0, 0, 3)
    rec.set(1, 0, 3)
    rec.set(2, 0, 5)
    const patch = rec.patch()!
    expect(patch.indexes).toHaveLength(3)
    expect(patch.before).toEqual(new Uint16Array([EMPTY, EMPTY, EMPTY]))

    const history = new History()
    history.push(patch)
    expect(gridEquals(grid, before)).toBe(false)

    const undone = history.undo(grid)
    expect(undone?.label).toBe('画笔')
    expect(grid.cells).toEqual(before.cells)

    history.redo(grid)
    expect([...grid.cells.slice(0, 4)]).toEqual([3, 3, 5, EMPTY])
  })

  it('同一格写过多次时按逆序回放才不会还原错', () => {
    const grid = createGrid(2, 1)
    const rec = new PatchRecorder(grid, '叠加')
    rec.set(0, 0, 1)
    rec.set(0, 0, 2)
    const patch = rec.patch()!
    expect(patch.indexes).toHaveLength(2)
    applyPatch(grid, patch, 'undo')
    expect(grid.cells[0]).toBe(EMPTY)
    applyPatch(grid, patch, 'redo')
    expect(grid.cells[0]).toBe(2)
  })

  it('同值写入不记账，没改动的操作不产生补丁', () => {
    const grid = createGrid(3, 3, 1)
    const rec = new PatchRecorder(grid, '空操作')
    expect(rec.set(1, 1, 1)).toBe(false)
    expect(rec.patch()).toBeNull()
  })

  it('越界写入不记账也不改数据', () => {
    const grid = createGrid(2, 2)
    const rec = new PatchRecorder(grid, '越界')
    expect(rec.set(-1, 0, 1)).toBe(false)
    expect(rec.set(0, 9, 1)).toBe(false)
    expect(rec.patch()).toBeNull()
  })

  it('单次操作超过上限：放弃记账，提示不计入撤销历史（改动保留）', () => {
    const grid = createGrid(4, 1)
    const rec = new PatchRecorder(grid, '超大操作', 3)
    for (let c = 0; c < 4; c++) rec.set(c, 0, 7)
    expect(rec.overflowed).toBe(true)
    expect(rec.patch()).toBeNull()
    expect(rec.size).toBe(0)
    expect([...grid.cells]).toEqual([7, 7, 7, 7])
  })

  it('撤销栈深 50，多的丢最老的', () => {
    const grid = createGrid(1, 1)
    const history = new History(50)
    for (let i = 1; i <= 60; i++) {
      const rec = new PatchRecorder(grid, `第${i}步`)
      rec.set(0, 0, i)
      history.push(rec.patch()!)
    }
    let steps = 0
    while (history.undo(grid)) steps++
    expect(steps).toBe(50)
    // 最早被丢掉的 10 步（1..10）已经回不去了，所以停在 10
    expect(grid.cells[0]).toBe(10)
  })

  it('新操作清空重做栈', () => {
    const grid = createGrid(1, 1)
    const history = new History()
    const a = new PatchRecorder(grid, 'a')
    a.set(0, 0, 1)
    history.push(a.patch()!)
    history.undo(grid)
    expect(history.canRedo).toBe(true)
    const b = new PatchRecorder(grid, 'b')
    b.set(0, 0, 2)
    history.push(b.patch()!)
    expect(history.canRedo).toBe(false)
    expect(history.canUndo).toBe(true)
  })

  it('50 步内存 < 100 MB（验收项）', () => {
    const grid = createGrid(200, 200)
    const history = new History()
    for (let step = 0; step < 50; step++) {
      const rec = new PatchRecorder(grid, `第${step}笔`)
      // 每笔 1000 格，约等于一次中等拖拽
      for (let i = 0; i < 1000; i++) rec.set(i % 200, (step + i) % 200, (step % 15) + 1)
      const patch = rec.patch()
      if (patch) history.push(patch)
    }
    expect(history.memoryBytes()).toBeLessThan(100 * 1024 * 1024)
    expect(history.memoryBytes()).toBeLessThan(1_000_000)
  })

  it('空历史里撤销/重做返回 null，不崩', () => {
    const grid = createGrid(2, 2)
    const history = new History()
    expect(history.undo(grid)).toBeNull()
    expect(history.redo(grid)).toBeNull()
    expect(history.canUndo).toBe(false)
  })
})
