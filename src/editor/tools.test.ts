import { describe, expect, it } from 'vitest'

import { EMPTY, createGrid, usedCells } from '../domain/grid'
import { PatchRecorder } from './history'
import { directSink, drawLine, erase, floodFill, paint, pickColor } from './tools'

describe('点选 / 画笔 / 橡皮 / 取色', () => {
  it('点选落色', () => {
    const grid = createGrid(4, 4)
    expect(paint(directSink(grid), grid, 1, 2, 5)).toBe(true)
    expect(grid.cells[2 * 4 + 1]).toBe(5)
  })

  it('橡皮设回 EMPTY，不是设成白色', () => {
    const grid = createGrid(2, 2)
    const sink = directSink(grid)
    paint(sink, grid, 0, 0, 1)
    erase(sink, grid, 0, 0)
    expect(grid.cells[0]).toBe(EMPTY)
  })

  it('越界不崩也不改数据', () => {
    const grid = createGrid(2, 2)
    expect(paint(directSink(grid), grid, -1, -1, 3)).toBe(false)
    expect(paint(directSink(grid), grid, 2, 0, 3)).toBe(false)
    expect(usedCells(grid)).toBe(0)
  })

  it('取色：有豆返回索引，空格返回 null', () => {
    const grid = createGrid(3, 3)
    paint(directSink(grid), grid, 1, 1, 9)
    expect(pickColor(grid, 1, 1)).toBe(9)
    expect(pickColor(grid, 0, 0)).toBeNull()
    expect(pickColor(grid, -1, 0)).toBeNull()
  })

  it('拖拽连线补上中间跳过的格子', () => {
    const grid = createGrid(8, 8)
    drawLine(directSink(grid), grid, 0, 0, 7, 7, 4)
    expect([...grid.cells].filter((v) => v === 4)).toHaveLength(8)
    expect(grid.cells[0]).toBe(4)
    expect(grid.cells[7 * 8 + 7]).toBe(4)
  })

  it('连线可以单点（起终点相同）', () => {
    const grid = createGrid(3, 3)
    expect(drawLine(directSink(grid), grid, 1, 1, 1, 1, 2)).toBe(1)
  })
})

describe('油漆桶', () => {
  it('填充 4 邻域同色连通块', () => {
    const grid = createGrid(4, 4, 1)
    // 造一堵墙把画布分成两块
    const sink = directSink(grid)
    for (let r = 0; r < 4; r++) paint(sink, grid, 2, r, 9)
    const filled = floodFill(sink, grid, 0, 0, 3)
    expect(filled).toBe(8)
    expect(grid.cells[0]).toBe(3)
    expect(grid.cells[2]).toBe(9)
    expect(grid.cells[3]).toBe(1)
  })

  it('填充空格区域，不碰已有豆', () => {
    const grid = createGrid(3, 3)
    const sink = directSink(grid)
    paint(sink, grid, 1, 1, 7)
    expect(floodFill(sink, grid, 0, 0, 5)).toBe(8)
    expect(grid.cells[4]).toBe(7)
  })

  it('自由拼板的空档不会被重复搜索', () => {
    const placeable = new Uint8Array(4 * 4)
    // 一个 L 形台面：第一行和第一列可放豆，其余是空档。
    for (let c = 0; c < 4; c++) placeable[c] = 1
    for (let r = 0; r < 4; r++) placeable[r * 4] = 1
    const grid = createGrid(4, 4, EMPTY, placeable)

    const filled = floodFill(directSink(grid), grid, 0, 0, 2)

    expect(filled).toBe(7)
    expect([...grid.cells].filter((v) => v === 2)).toHaveLength(7)
    expect(grid.cells[1 * 4 + 1]).toBe(EMPTY)
    expect(grid.cells[3 * 4 + 3]).toBe(EMPTY)
  })

  it('同色填充是空操作', () => {
    const grid = createGrid(3, 3, 2)
    expect(floodFill(directSink(grid), grid, 0, 0, 2)).toBe(0)
  })

  it('100 万格同色区域不爆栈（显式栈，验收项）', () => {
    const grid = createGrid(1000, 1000, 1)
    const t0 = performance.now()
    const filled = floodFill(directSink(grid), grid, 0, 0, 2)
    const ms = performance.now() - t0
    expect(filled).toBe(1_000_000)
    expect(grid.cells[999 * 1000 + 999]).toBe(2)
    expect(ms).toBeLessThan(3000)
  })

  it('一笔填充同样走撤销记账，可以撤销回去', () => {
    const grid = createGrid(50, 50, 1)
    const rec = new PatchRecorder(grid, '油漆桶')
    floodFill(rec, grid, 0, 0, 8)
    const patch = rec.patch()!
    expect(patch.indexes).toHaveLength(2500)
    expect(usedCells(grid)).toBe(2500)
  })
})
