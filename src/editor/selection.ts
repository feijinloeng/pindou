import { EMPTY, type CellGrid, cellIndex, inBounds } from '../domain/grid'
import type { WriteSink } from './tools'

/** 矩形选区，含四条边界 */
export interface Rect {
  c0: number
  r0: number
  c1: number
  r1: number
}

export function makeRect(c0: number, r0: number, c1: number, r1: number): Rect {
  return {
    c0: Math.min(c0, c1),
    r0: Math.min(r0, r1),
    c1: Math.max(c0, c1),
    r1: Math.max(r0, r1),
  }
}

function rectWidth(r: Rect): number {
  return r.c1 - r.c0 + 1
}

function rectHeight(r: Rect): number {
  return r.r1 - r.r0 + 1
}

function clampRectTo(grid: CellGrid, rect: Rect): Rect | null {
  const c0 = Math.max(0, rect.c0)
  const r0 = Math.max(0, rect.r0)
  const c1 = Math.min(grid.cols - 1, rect.c1)
  const r1 = Math.min(grid.rows - 1, rect.r1)
  return c0 > c1 || r0 > r1 ? null : { c0, r0, c1, r1 }
}

export type Selection = Rect[]

export function selectionContains(sel: Selection, col: number, row: number): boolean {
  return sel.some((r) => col >= r.c0 && col <= r.c1 && row >= r.r0 && row <= r.r1)
}

export function selectionBBox(sel: Selection): Rect | null {
  if (sel.length === 0) return null
  return sel.reduce((acc, r) => ({
    c0: Math.min(acc.c0, r.c0),
    r0: Math.min(acc.r0, r.r0),
    c1: Math.max(acc.c1, r.c1),
    r1: Math.max(acc.r1, r.r1),
  }))
}

/** 遍历选中的格子（跳过选区外的） */
function forEachSelected(
  sel: Selection,
  fn: (col: number, row: number) => void,
): void {
  for (const r of sel) {
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) fn(col, row)
    }
  }
}

export function fillSelection(
  sink: WriteSink,
  grid: CellGrid,
  sel: Selection,
  value: number,
): number {
  let n = 0
  forEachSelected(sel, (col, row) => {
    if (inBounds(grid, col, row) && sink.set(col, row, value)) n++
  })
  return n
}

export interface Clip {
  cols: number
  rows: number
  cells: Uint16Array
  /** 复制时选区是非矩形并集时，框内没选中的格子填 EMPTY */
  rects: Selection
}

/** 复制到剪贴板：取选区的外接框 */
export function copySelection(grid: CellGrid, sel: Selection): Clip | null {
  const box = selectionBBox(sel)
  if (!box) return null
  const clamped = clampRectTo(grid, box)
  if (!clamped) return null
  const w = rectWidth(clamped)
  const h = rectHeight(clamped)
  const cells = new Uint16Array(w * h)
  const single = sel.length === 1
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const gc = clamped.c0 + col
      const gr = clamped.r0 + row
      cells[row * w + col] =
        single || selectionContains(sel, gc, gr) ? grid.cells[cellIndex(grid, gc, gr)] : EMPTY
    }
  }
  return { cols: w, rows: h, cells, rects: [clamped] }
}

/** 粘贴：左上角落在 (col, row)，越界部分裁掉 */
export function pasteClip(
  sink: WriteSink,
  grid: CellGrid,
  clip: Clip,
  col: number,
  row: number,
): number {
  let n = 0
  for (let r = 0; r < clip.rows; r++) {
    for (let c = 0; c < clip.cols; c++) {
      const gc = col + c
      const gr = row + r
      if (inBounds(grid, gc, gr) && sink.set(gc, gr, clip.cells[r * clip.cols + c])) n++
    }
  }
  return n
}

function readRect(grid: CellGrid, rect: Rect): Uint16Array {
  const w = rectWidth(rect)
  const h = rectHeight(rect)
  const out = new Uint16Array(w * h)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[r * w + c] = grid.cells[cellIndex(grid, rect.c0 + c, rect.r0 + r)]
    }
  }
  return out
}

/** 镜像。h = 左右翻，v = 上下翻 */
export function mirrorRect(
  sink: WriteSink,
  grid: CellGrid,
  rect: Rect,
  axis: 'h' | 'v',
): number {
  const clipped = clampRectTo(grid, rect)
  if (!clipped) return 0
  const w = rectWidth(clipped)
  const h = rectHeight(clipped)
  const src = readRect(grid, clipped)
  let n = 0
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const from = axis === 'h' ? r * w + (w - 1 - c) : (h - 1 - r) * w + c
      if (sink.set(clipped.c0 + c, clipped.r0 + r, src[from])) n++
    }
  }
  return n
}

/** 旋转 90°（dir=1 顺时针）。只支持正方形区域，否则原地转不下 */
export function rotateRect(
  sink: WriteSink,
  grid: CellGrid,
  rect: Rect,
  dir: 1 | -1,
): boolean {
  const clipped = clampRectTo(grid, rect)
  if (!clipped) return false
  const w = rectWidth(clipped)
  const h = rectHeight(clipped)
  if (w !== h) return false
  const src = readRect(grid, clipped)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const value = src[r * w + c]
      const nc = dir === 1 ? h - 1 - r : r
      const nr = dir === 1 ? c : w - 1 - c
      sink.set(clipped.c0 + nc, clipped.r0 + nr, value)
    }
  }
  return true
}

/** 整图平移，超出部分丢弃 */
export function translateGrid(
  sink: WriteSink,
  grid: CellGrid,
  dc: number,
  dr: number,
): number {
  const { cols, rows } = grid
  const src = grid.cells.slice()
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sc = c - dc
      const sr = r - dr
      const value = inBounds(grid, sc, sr) ? src[sr * cols + sc] : EMPTY
      if (sink.set(c, r, value)) n++
    }
  }
  return n
}
