import { EMPTY, type CellGrid, inBounds } from '../domain/grid'

/** 工具改格子只通过这个接口，这样同一套工具既能记账也能裸跑（测试、压测） */
export interface WriteSink {
  set(col: number, row: number, value: number): boolean
}

/** 写入单格；画笔和油漆桶等工具共用这条写入路径。 */
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

/** 取色。空格返回 null */
export function pickColor(grid: CellGrid, col: number, row: number): number | null {
  if (!inBounds(grid, col, row)) return null
  const v = grid.cells[row * grid.cols + col]
  return v === EMPTY ? null : v
}

/**
 * 油漆桶：4 邻域同色连通块填充。
 * ⚠️ 显式栈，不用递归 —— 100 万格的连通块用递归必爆栈。
 * 入栈前先标记访问，保证每格最多入栈一次；placeable 空档也不会被搜索。
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
  const visited = new Uint8Array(cells.length)
  visited[start] = 1
  sink.set(col, row, value)
  stack[top++] = start
  let count = 1

  const visit = (nextCol: number, nextRow: number, nextIndex: number) => {
    if (!inBounds(grid, nextCol, nextRow)) return
    if (visited[nextIndex] || cells[nextIndex] !== target) return
    visited[nextIndex] = 1
    if (sink.set(nextCol, nextRow, value)) count++
    if (top === stack.length) stack = growStack(stack)
    stack[top++] = nextIndex
  }

  while (top > 0) {
    const i = stack[--top]
    const c = i % cols
    const r = (i - c) / cols

    if (c > 0) visit(c - 1, r, i - 1)
    if (c + 1 < cols) visit(c + 1, r, i + 1)
    if (r > 0) visit(c, r - 1, i - cols)
    if (r + 1 < rows) visit(c, r + 1, i + cols)
  }
  return count
}

function growStack(stack: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const next = new Int32Array(stack.length * 2)
  next.set(stack)
  return next
}
