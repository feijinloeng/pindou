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

/** 非空格数量 */
export function usedCells(g: CellGrid): number {
  let n = 0
  for (const v of g.cells) if (v !== EMPTY) n++
  return n
}

/** 每个色板索引被用了多少格。paletteSize 之外的索引会被忽略。 */
export function usageByIndex(g: CellGrid, paletteSize: number): Uint32Array {
  const out = new Uint32Array(paletteSize)
  for (const v of g.cells) if (v < paletteSize) out[v]++
  return out
}

export function gridEquals(a: CellGrid, b: CellGrid): boolean {
  if (a.cols !== b.cols || a.rows !== b.rows) return false
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
  return true
}
