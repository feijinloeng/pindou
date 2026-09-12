import { describe, expect, it } from 'vitest'

import { EMPTY, createGrid, usedCells } from '../domain/grid'
import { PatchRecorder } from './history'
import {
  clampRectTo,
  clearSelection,
  copySelection,
  fillSelection,
  invertSelection,
  makeRect,
  mirrorRect,
  pasteClip,
  rectArea,
  rotateRect,
  selectionArea,
  selectionBBox,
  selectionContains,
  translateGrid,
  type Rect,
} from './selection'
import { directSink } from './tools'

/** 用 3 行数字造一张图，便于肉眼核对变换结果 */
function gridFromRows(rows: number[][]): ReturnType<typeof createGrid> {
  const g = createGrid(rows[0].length, rows.length)
  rows.forEach((line, r) => line.forEach((v, c) => (g.cells[r * g.cols + c] = v)))
  return g
}

function rowsOf(g: ReturnType<typeof createGrid>): number[][] {
  return Array.from({ length: g.rows }, (_, r) =>
    Array.from(g.cells.subarray(r * g.cols, (r + 1) * g.cols)),
  )
}

describe('选区矩形', () => {
  it('makeRect 归一化，倒着拖也对', () => {
    expect(makeRect(5, 5, 2, 1)).toEqual({ c0: 2, r0: 1, c1: 5, r1: 5 })
  })

  it('clampRectTo 裁到画布内，完全在外返回 null', () => {
    const g = createGrid(10, 10)
    expect(clampRectTo(g, { c0: -3, r0: -3, c1: 2, r1: 2 })).toEqual({
      c0: 0,
      r0: 0,
      c1: 2,
      r1: 2,
    })
    expect(clampRectTo(g, { c0: 20, r0: 20, c1: 30, r1: 30 })).toBeNull()
  })

  it('面积与外接框', () => {
    const sel: Rect[] = [
      { c0: 0, r0: 0, c1: 1, r1: 1 },
      { c0: 5, r0: 5, c1: 6, r1: 6 },
    ]
    expect(selectionArea(sel)).toBe(8)
    expect(selectionBBox(sel)).toEqual({ c0: 0, r0: 0, c1: 6, r1: 6 })
    expect(rectArea({ c0: 0, r0: 0, c1: 2, r1: 3 })).toBe(12)
    expect(selectionContains(sel, 5, 6)).toBe(true)
    expect(selectionContains(sel, 3, 3)).toBe(false)
  })

  it('反选：单选区 → 四条边，总面积 = 整图 − 选区', () => {
    const sel: Rect[] = [{ c0: 2, r0: 2, c1: 4, r1: 4 }]
    const inverted = invertSelection(sel, 10, 12)
    expect(inverted).toHaveLength(4)
    expect(selectionArea(inverted)).toBe(10 * 12 - 9)
    expect(selectionContains(inverted, 2, 2)).toBe(false)
    expect(selectionContains(inverted, 0, 0)).toBe(true)
  })

  it('反选：贴边的选区只产生需要的几条边', () => {
    const inverted = invertSelection([{ c0: 0, r0: 0, c1: 9, r1: 0 }], 10, 10)
    expect(inverted).toEqual([{ c0: 0, r0: 1, c1: 9, r1: 9 }])
  })
})

describe('框选批量操作', () => {
  it('批量换色 / 清除', () => {
    const g = createGrid(5, 5)
    const sink = directSink(g)
    const sel: Rect[] = [{ c0: 1, r0: 1, c1: 3, r1: 3 }]
    expect(fillSelection(sink, g, sel, 6)).toBe(9)
    expect(clearSelection(sink, g, sel)).toBe(9)
    expect(g.cells.every((v) => v === EMPTY)).toBe(true)
  })

  it('复制 → 粘贴，内容一致', () => {
    const g = gridFromRows([
      [1, 2],
      [3, 4],
    ])
    const clip = copySelection(g, [{ c0: 0, r0: 0, c1: 1, r1: 1 }])!
    expect([...clip.cells]).toEqual([1, 2, 3, 4])
    const target = createGrid(4, 4)
    pasteClip(directSink(target), target, clip, 2, 2)
    expect(rowsOf(target)).toEqual([
      [EMPTY, EMPTY, EMPTY, EMPTY],
      [EMPTY, EMPTY, EMPTY, EMPTY],
      [EMPTY, EMPTY, 1, 2],
      [EMPTY, EMPTY, 3, 4],
    ])
  })

  it('剪切 = 复制 + 清除', () => {
    const g = createGrid(3, 3, 7)
    const sel: Rect[] = [{ c0: 0, r0: 0, c1: 1, r1: 1 }]
    const clip = copySelection(g, sel)!
    clearSelection(directSink(g), g, sel)
    expect(clip.cells.every((v) => v === 7)).toBe(true)
    expect(rowsOf(g)[0]).toEqual([EMPTY, EMPTY, 7])
  })

  it('粘贴超出画布只贴进来的部分，不崩', () => {
    const clip = { cols: 2, rows: 2, cells: new Uint16Array([1, 2, 3, 4]), rects: [] }
    const g = createGrid(3, 3)
    const n = pasteClip(directSink(g), g, clip, 2, 2)
    expect(n).toBe(1)
    expect(g.cells[2 * 3 + 2]).toBe(1)
  })

  it('复制多矩形选区时，框里没选中的格子填 EMPTY', () => {
    const g = createGrid(4, 1)
    g.cells.set([1, 2, 3, 4])
    const clip = copySelection(g, [
      { c0: 0, r0: 0, c1: 0, r1: 0 },
      { c0: 3, r0: 0, c1: 3, r1: 0 },
    ])!
    expect([...clip.cells]).toEqual([1, EMPTY, EMPTY, 4])
  })
})

describe('镜像 / 旋转 / 平移', () => {
  it('左右镜像', () => {
    const g = gridFromRows([
      [1, 2, 3],
      [4, 5, 6],
    ])
    mirrorRect(directSink(g), g, { c0: 0, r0: 0, c1: 2, r1: 1 }, 'h')
    expect(rowsOf(g)).toEqual([
      [3, 2, 1],
      [6, 5, 4],
    ])
  })

  it('上下镜像', () => {
    const g = gridFromRows([
      [1, 2, 3],
      [4, 5, 6],
    ])
    mirrorRect(directSink(g), g, { c0: 0, r0: 0, c1: 2, r1: 1 }, 'v')
    expect(rowsOf(g)).toEqual([
      [4, 5, 6],
      [1, 2, 3],
    ])
  })

  it('顺时针旋转 90°', () => {
    const g = gridFromRows([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])
    expect(rotateRect(directSink(g), g, { c0: 0, r0: 0, c1: 2, r1: 2 }, 1)).toBe(true)
    expect(rowsOf(g)).toEqual([
      [7, 4, 1],
      [8, 5, 2],
      [9, 6, 3],
    ])
  })

  it('逆时针旋转 90°', () => {
    const g = gridFromRows([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])
    rotateRect(directSink(g), g, { c0: 0, r0: 0, c1: 2, r1: 2 }, -1)
    expect(rowsOf(g)).toEqual([
      [3, 6, 9],
      [2, 5, 8],
      [1, 4, 7],
    ])
  })

  it('转两次 180°，转四次回到原样', () => {
    const start = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]
    const g = gridFromRows(start)
    const rect = { c0: 0, r0: 0, c1: 2, r1: 2 }
    rotateRect(directSink(g), g, rect, 1)
    rotateRect(directSink(g), g, rect, 1)
    expect(rowsOf(g)).toEqual([
      [9, 8, 7],
      [6, 5, 4],
      [3, 2, 1],
    ])
    rotateRect(directSink(g), g, rect, 1)
    rotateRect(directSink(g), g, rect, 1)
    expect(rowsOf(g)).toEqual(start)
  })

  it('非正方形区域拒绝旋转（原地转不下）', () => {
    const g = createGrid(4, 2, 1)
    expect(rotateRect(directSink(g), g, { c0: 0, r0: 0, c1: 3, r1: 1 }, 1)).toBe(false)
    expect(usedCells(g)).toBe(8)
  })

  it('只在选区里镜像，圈外不动', () => {
    const g = gridFromRows([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
    mirrorRect(directSink(g), g, { c0: 1, r0: 0, c1: 2, r1: 1 }, 'h')
    expect(rowsOf(g)).toEqual([
      [1, 3, 2, 4],
      [5, 7, 6, 8],
    ])
  })

  it('整图平移：内容整体挪，空出来的地方是空格', () => {
    const g = gridFromRows([
      [1, 2, 0],
      [3, 4, 0],
      [0, 0, 0],
    ])
    translateGrid(directSink(g), g, 1, 1)
    expect(rowsOf(g)).toEqual([
      [EMPTY, EMPTY, EMPTY],
      [EMPTY, 1, 2],
      [EMPTY, 3, 4],
    ])
  })

  it('平移可撤销（走记账）', () => {
    const g = createGrid(3, 3, 1)
    const rec = new PatchRecorder(g, '平移')
    translateGrid(rec, g, 1, 0)
    expect(g.cells[0]).toBe(EMPTY)
    const patch = rec.patch()!
    expect(patch.indexes).toHaveLength(3)
  })

  it('用 usedCells 抓一个真错：转完格子数不变', () => {
    const g = createGrid(5, 5)
    const sink = directSink(g)
    for (let i = 0; i < 25; i++) sink.set(i % 5, (i / 5) | 0, (i % 7) + 1)
    const before = usedCells(g)
    rotateRect(sink, g, { c0: 0, r0: 0, c1: 4, r1: 4 }, 1)
    expect(usedCells(g)).toBe(before)
  })
})
