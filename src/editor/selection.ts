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
  cells.fill(EMPTY)
  const regions = sel
    .map((rect) => clampRectTo(grid, rect))
    .filter((rect): rect is Rect => rect !== null)
  for (let row = 0; row < h; row++) {
    const gridRow = clamped.r0 + row
    const intervals = regions
      .filter((rect) => gridRow >= rect.r0 && gridRow <= rect.r1)
      .map((rect) => [rect.c0, rect.c1] as const)
      .sort((a, b) => a[0] - b[0])
    let start: number | null = null
    let end = -1
    const copyInterval = () => {
      if (start === null) return
      const source = gridRow * grid.cols + start
      const target = row * w + start - clamped.c0
      cells.set(grid.cells.subarray(source, source + end - start + 1), target)
    }
    for (const [c0, c1] of intervals) {
      if (start === null) {
        start = c0
        end = c1
      } else if (c0 <= end + 1) {
        end = Math.max(end, c1)
      } else {
        copyInterval()
        start = c0
        end = c1
      }
    }
    copyInterval()
  }
  return { cols: w, rows: h, cells }
}

/** Count occupied cells a mirror would move into a gap in an irregular layout. */
export function countMirrorLoss(grid: CellGrid, rect: Rect, axis: 'h' | 'v'): number {
  const clipped = clampRectTo(grid, rect)
  if (!clipped) return 0
  const width = rectWidth(clipped)
  const height = rectHeight(clipped)
  let lost = 0
  for (let row = clipped.r0; row <= clipped.r1; row++) {
    for (let col = clipped.c0; col <= clipped.c1; col++) {
      if (!inBounds(grid, col, row) || grid.cells[cellIndex(grid, col, row)] === EMPTY) continue
      const targetCol = axis === 'h' ? clipped.c0 + width - 1 - (col - clipped.c0) : col
      const targetRow = axis === 'v' ? clipped.r0 + height - 1 - (row - clipped.r0) : row
      if (!inBounds(grid, targetCol, targetRow)) lost++
    }
  }
  return lost
}

/** Count occupied cells a quarter-turn would move into a gap in an irregular layout. */
export function countRotateLoss(grid: CellGrid, rect: Rect, dir: 1 | -1): number {
  const clipped = clampRectTo(grid, rect)
  if (!clipped) return 0
  const width = rectWidth(clipped)
  const height = rectHeight(clipped)
  if (width !== height) return 0
  let lost = 0
  for (let row = clipped.r0; row <= clipped.r1; row++) {
    for (let col = clipped.c0; col <= clipped.c1; col++) {
      if (!inBounds(grid, col, row) || grid.cells[cellIndex(grid, col, row)] === EMPTY) continue
      const localCol = col - clipped.c0
      const localRow = row - clipped.r0
      const targetCol = clipped.c0 + (dir === 1 ? height - 1 - localRow : localRow)
      const targetRow = clipped.r0 + (dir === 1 ? localCol : width - 1 - localCol)
      if (!inBounds(grid, targetCol, targetRow)) lost++
    }
  }
  return lost
}

/** Count occupied cells that a translation would move outside the usable board area. */
export function countTranslateLoss(grid: CellGrid, dc: number, dr: number): number {
  let lost = 0
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!inBounds(grid, col, row) || grid.cells[cellIndex(grid, col, row)] === EMPTY) continue
      if (!inBounds(grid, col + dc, row + dr)) lost++
    }
  }
  return lost
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
