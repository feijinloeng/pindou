/**
 * 豆格画布。值 = 色板里的索引，EMPTY = 空格。
 *
 * 为什么是一维 `Uint16Array`：500 万格只占 10 MB；换成对象数组是 500 MB+，直接爆。
 */
export const EMPTY = 0xffff

export interface CellGrid {
  cols: number
  rows: number
  /** 长度 = cols × rows，行优先 */
  cells: Uint16Array
  /**
   * 哪些格子底下有板（1 = 有，0 = 空档）。自由拼板时外接矩形里会有空档。
   * 省略 = 全是板。写格子的入口统一走 inBounds()，那里会挡掉空档。
   */
  placeable?: Uint8Array
}

export function createGrid(
  cols: number,
  rows: number,
  fill = EMPTY,
  placeable?: Uint8Array,
): CellGrid {
  const cells = new Uint16Array(cols * rows)
  if (fill !== 0) cells.fill(fill)
  return { cols, rows, cells, placeable }
}

export function cellIndex(g: CellGrid, col: number, row: number): number {
  return row * g.cols + col
}

/**
 * 这个格子能不能写：在范围内，而且底下真的有板。
 * 自由拼板时外接矩形里的空档不算格子 —— 所有工具都从这里过，所以挡一次就够了。
 */
export function inBounds(g: CellGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false
  return !g.placeable || g.placeable[row * g.cols + col] === 1
}

/**
 * 这个格子底下有没有板。索引版（所有逐格循环都走它，空档就不会被统计/绘制）
 */
export function isPlaceable(g: CellGrid, index: number): boolean {
  return !g.placeable || g.placeable[index] === 1
}

/** 非空格数量（空档不算） */
export function usedCells(g: CellGrid): number {
  let n = 0
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== EMPTY && isPlaceable(g, i)) n++
  }
  return n
}

/** 换板阵前计算会被新布局淘汰的非空格子数。 */
export function lostCells(
  g: CellGrid,
  next: { cols: number; rows: number; placeable: Uint8Array },
): number {
  return lostCellsAfterShift(g, next, 0, 0)
}

/** Count occupied cells that would be lost after moving their coordinates before a layout change. */
export function lostCellsAfterShift(
  g: CellGrid,
  next: { cols: number; rows: number; placeable: Uint8Array },
  colShift: number,
  rowShift: number,
): number {
  let lost = 0
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] === EMPTY) continue
    if (g.placeable && g.placeable[i] !== 1) continue
    const col = (i % g.cols) + colShift
    const row = Math.floor(i / g.cols) + rowShift
    if (
      col < 0 || row < 0 || col >= next.cols || row >= next.rows ||
      next.placeable[row * next.cols + col] !== 1
    ) lost++
  }
  return lost
}

/** 每个色板索引被用了多少格（空档和越界索引都不算）。paletteSize 之外的索引会被忽略。 */
export function usageByIndex(g: CellGrid, paletteSize: number): Uint32Array {
  const out = new Uint32Array(paletteSize)
  for (let i = 0; i < g.cells.length; i++) {
    const v = g.cells[i]
    if (v < paletteSize && isPlaceable(g, i)) out[v]++
  }
  return out
}
