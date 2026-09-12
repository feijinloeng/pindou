import { EMPTY, type CellGrid, inBounds } from '../domain/grid'

/** 工具改格子只通过这个接口，这样同一套工具既能记账也能裸跑（测试、压测） */
export interface WriteSink {
  set(col: number, row: number, value: number): boolean
}

export function directSink(grid: CellGrid): WriteSink {
  return {
    set(col, row, value) {
      if (!inBounds(grid, col, row)) return false
      const i = row * grid.cols + col
      if (grid.cells[i] === value) return false
      grid.cells[i] = value
      return true
    },
  }
}

/** 点选：落一格色 */
export function paint(
  sink: WriteSink,
  grid: CellGrid,
  col: number,
  row: number,
  value: number,
): boolean {
  if (!inBounds(grid, col, row)) return false
  return sink.set(col, row, value)
}

/** 橡皮：设回 EMPTY，不是设成白色 */
export function erase(sink: WriteSink, grid: CellGrid, col: number, row: number): boolean {
  return paint(sink, grid, col, row, EMPTY)
}

/** 取色。空格返回 null */
export function pickColor(grid: CellGrid, col: number, row: number): number | null {
  if (!inBounds(grid, col, row)) return null
  const v = grid.cells[row * grid.cols + col]
  return v === EMPTY ? null : v
}

/**
 * 画笔一笔：把两个点之间的格子都填上（Bresenham）。
 * 指针事件是跳着来的，不补线就会断断续续。
 */
export function drawLine(
  sink: WriteSink,
  grid: CellGrid,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  value: number,
): number {
  let col = c0
  let row = r0
  const dx = Math.abs(c1 - c0)
  const dy = -Math.abs(r1 - r0)
  const sx = c0 < c1 ? 1 : -1
  const sy = r0 < r1 ? 1 : -1
  let err = dx + dy
  let painted = 0
  for (;;) {
    if (paint(sink, grid, col, row, value)) painted++
    if (col === c1 && row === r1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      col += sx
    }
    if (e2 <= dx) {
      err += dx
      row += sy
    }
  }
  return painted
}

/**
 * 油漆桶：4 邻域同色连通块填充。
 * ⚠️ 显式栈，不用递归 —— 100 万格的连通块用递归必爆栈。
 * 入栈前先落色，保证每格最多入栈一次。
 */
export function floodFill(
  sink: WriteSink,
  grid: CellGrid,
  col: number,
  row: number,
  value: number,
): number {
  if (!inBounds(grid, col, row)) return 0
  const { cols, rows, cells } = grid
  const start = row * cols + col
  const target = cells[start]
  if (target === value) return 0

  let stack = new Int32Array(1024)
  let top = 0
  sink.set(col, row, value)
  stack[top++] = start
  let count = 1

  while (top > 0) {
    const i = stack[--top]
    const c = i % cols
    const r = (i - c) / cols

    if (c > 0 && cells[i - 1] === target) {
      sink.set(c - 1, r, value)
      if (top === stack.length) stack = growStack(stack)
      stack[top++] = i - 1
      count++
    }
    if (c + 1 < cols && cells[i + 1] === target) {
      sink.set(c + 1, r, value)
      if (top === stack.length) stack = growStack(stack)
      stack[top++] = i + 1
      count++
    }
    if (r > 0 && cells[i - cols] === target) {
      sink.set(c, r - 1, value)
      if (top === stack.length) stack = growStack(stack)
      stack[top++] = i - cols
      count++
    }
    if (r + 1 < rows && cells[i + cols] === target) {
      sink.set(c, r + 1, value)
      if (top === stack.length) stack = growStack(stack)
      stack[top++] = i + cols
      count++
    }
  }
  return count
}

function growStack(stack: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const next = new Int32Array(stack.length * 2)
  next.set(stack)
  return next
}
