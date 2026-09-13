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

export function getCell(g: CellGrid, col: number, row: number): number {
  return inBounds(g, col, row) ? g.cells[row * g.cols + col] : EMPTY
}

export function clearGrid(g: CellGrid, fill = EMPTY): void {
  g.cells.fill(fill)
}

export function cloneGrid(g: CellGrid): CellGrid {
  return {
    cols: g.cols,
    rows: g.rows,
    cells: g.cells.slice(),
    placeable: g.placeable?.slice(),
  }
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

/**
 * 换成下一个板阵会丢掉的非空格子数。
 * 换板阵前先把代价算出来，别让用户点完才发现内容少了。
 */
export function lostCells(
  g: CellGrid,
  next: { cols: number; rows: number; placeable: Uint8Array },
): number {
  let lost = 0
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] === EMPTY) continue
    if (g.placeable && g.placeable[i] !== 1) continue
    const col = i % g.cols
    const row = (i - col) / g.cols
    if (col >= next.cols || row >= next.rows || next.placeable[row * next.cols + col] !== 1) {
      lost++
    }
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

/**
 * 两个网格是否完全一样。
 * 空档遮罩也要比 —— 格子值一样但空档不同，是两个不同的板阵，
 * 只比 cells 会把真正的结构差异藏起来。
 * placeable 缺省 = 全是板，所以缺省和全 1 视为相等。
 */
export function gridEquals(a: CellGrid, b: CellGrid): boolean {
  if (a.cols !== b.cols || a.rows !== b.rows) return false
  if (a.cells.length !== b.cells.length) return false
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
  if (a.placeable && b.placeable) {
    if (a.placeable.length !== b.placeable.length) return false
    for (let i = 0; i < a.placeable.length; i++) {
      if (a.placeable[i] !== b.placeable[i]) return false
    }
    return true
  }
  const only = a.placeable ?? b.placeable
  if (only) for (let i = 0; i < only.length; i++) if (only[i] !== 1) return false
  return true
}
