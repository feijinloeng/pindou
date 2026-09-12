import { describe, expect, it } from 'vitest'

import {
  EMPTY,
  cellIndex,
  clearGrid,
  cloneGrid,
  createGrid,
  getCell,
  gridEquals,
  inBounds,
  usageByIndex,
  usedCells,
} from './grid'

describe('空档（placeable）统计', () => {
  it('空档里的脏数据不算用量', () => {
    const g = createGrid(4, 2, 0)
    g.placeable = new Uint8Array([1, 1, 0, 1, 1, 0, 0, 1])
    expect(usedCells(g)).toBe(5)
    expect([...usageByIndex(g, 3)]).toEqual([5, 0, 0])
  })

  it('没有 placeable 时行为和以前一致', () => {
    const g = createGrid(3, 1, 0)
    expect(usedCells(g)).toBe(3)
    expect([...usageByIndex(g, 2)][0]).toBe(3)
  })

  it('空档格子不算 inBounds，也读不出值', () => {
    const g = createGrid(2, 1, 7)
    g.placeable = new Uint8Array([1, 0])
    expect(inBounds(g, 1, 0)).toBe(false)
    expect(getCell(g, 1, 0)).toBe(EMPTY)
  })
})

describe('CellGrid', () => {
  it('新建的画布是空格', () => {
    const g = createGrid(4, 3)
    expect(g.cells).toHaveLength(12)
    expect(g.cells.every((v) => v === EMPTY)).toBe(true)
    expect(usedCells(g)).toBe(0)
  })

  it('索引是行优先', () => {
    const g = createGrid(4, 3)
    expect(cellIndex(g, 0, 0)).toBe(0)
    expect(cellIndex(g, 3, 0)).toBe(3)
    expect(cellIndex(g, 0, 1)).toBe(4)
    expect(cellIndex(g, 2, 2)).toBe(10)
  })

  it('越界读返回 EMPTY，不抛错', () => {
    const g = createGrid(2, 2)
    expect(inBounds(g, -1, 0)).toBe(false)
    expect(inBounds(g, 2, 0)).toBe(false)
    expect(inBounds(g, 0, 2)).toBe(false)
    expect(getCell(g, -1, 5)).toBe(EMPTY)
    expect(getCell(g, 9, 9)).toBe(EMPTY)
  })

  it('500 万格只用 10 MB', () => {
    const g = createGrid(2236, 2236)
    expect(g.cells.byteLength).toBe(2236 * 2236 * 2)
    expect(g.cells.byteLength).toBeLessThan(10_000_000)
  })

  it('用量统计只数色板范围内的索引', () => {
    const g = createGrid(4, 1)
    g.cells.set([0, 1, 1, EMPTY])
    const usage = usageByIndex(g, 3)
    expect([...usage]).toEqual([1, 2, 0])
    expect(usedCells(g)).toBe(3)
  })

  it('clearGrid / cloneGrid / gridEquals', () => {
    const g = createGrid(3, 3)
    g.cells[4] = 7
    const copy = cloneGrid(g)
    expect(gridEquals(g, copy)).toBe(true)
    copy.cells[5] = 1
    expect(gridEquals(g, copy)).toBe(false)
    clearGrid(copy)
    expect(usedCells(copy)).toBe(0)
    expect(gridEquals(g, createGrid(3, 3, EMPTY))).toBe(false)
  })

  it('不同尺寸不算相等', () => {
    expect(gridEquals(createGrid(2, 2), createGrid(2, 3))).toBe(false)
  })

  it('格子值一样但空档不同，不算相等', () => {
    const all = createGrid(2, 2)
    const holed = createGrid(2, 2, EMPTY, new Uint8Array([1, 1, 0, 1]))
    expect(gridEquals(all, holed)).toBe(false)
    expect(gridEquals(holed, all)).toBe(false)
  })

  it('缺省 placeable = 全是板，和全 1 遮罩等价', () => {
    const none = createGrid(2, 2)
    const ones = createGrid(2, 2, EMPTY, new Uint8Array([1, 1, 1, 1]))
    expect(gridEquals(none, ones)).toBe(true)
  })
})
