import type { BoardGeometry } from '../domain/board'
import { EMPTY, type CellGrid, usageByIndex } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { assignNumbers } from './bom'

export const A4_MM = { w: 210, h: 297 }
/** 不可打印边距默认 5mm；不同打印机不同，做成可配置（第 7.1 节） */
export const DEFAULT_MARGIN_MM = 5
/** 重叠带宽度：3 列豆 */
export const OVERLAP_CELLS = 3
/** PDF 单页上限 14400pt ≈ 5080mm */
export const MAX_PAGE_PT = 14400
/**
 * 屏幕版四周的留白（pt）。屏幕版没有打印边距，但坐标数字是画在图案外面的：
 * 左边刻度在 origin.x 左侧约 size*2.2 ≈ 13pt，上边刻度在图案上边再加一个行高。
 * 页面不留出这块地方，右侧和上侧的图案/数字就会跑出页面被裁掉。
 */
export const SCREEN_PAD_PT = 16

export interface SheetRange {
  col0: number
  row0: number
  cols: number
  rows: number
}

export interface DocumentLayout {
  /** 页面尺寸，毫米 */
  pageMm: { w: number; h: number }
  /** 一页能放几列 / 几行豆 */
  cellsPerPage: { cols: number; rows: number }
  /** 重叠带宽度（格），0 = 不分页 */
  overlap: number
  /** 页面划分：每页覆盖的全局豆格范围 */
  sheets: SheetRange[]
  marginMm: number
  drawBoardSeams: boolean
  drawSheetMarks: boolean
  drawCodes: boolean
  drawRuler: boolean
  includeBom: boolean
}

/** A4 上按针距能放多少格（第 7.1 节的实测数字：2.6mm → 76 × 110） */
export function paperCapacity(pitchMm: number, marginMm = DEFAULT_MARGIN_MM) {
  return {
    cols: Math.floor((A4_MM.w - marginMm * 2) / pitchMm),
    rows: Math.floor((A4_MM.h - marginMm * 2) / pitchMm),
  }
}

/** 第 k 页覆盖的全局范围（第 7.4 节） */
export function sheetAt(
  index: number,
  total: number,
  perPage: number,
  overlap: number,
): { start: number; count: number } {
  const step = Math.max(1, perPage - overlap)
  const start = index * step
  return { start, count: Math.max(0, Math.min(perPage, total - start)) }
}

export function countPages(total: number, perPage: number, overlap: number): number {
  if (total <= 0) return 0
  const step = Math.max(1, perPage - overlap)
  return Math.max(1, Math.ceil((total - perPage) / step) + 1)
}

export function paginate(
  cols: number,
  rows: number,
  perPageCols: number,
  perPageRows: number,
  overlap: number,
): SheetRange[] {
  const colPages = countPages(cols, perPageCols, overlap)
  const rowPages = countPages(rows, perPageRows, overlap)
  const sheets: SheetRange[] = []
  for (let r = 0; r < rowPages; r++) {
    const rowsRange = sheetAt(r, rows, perPageRows, overlap)
    for (let c = 0; c < colPages; c++) {
      const colsRange = sheetAt(c, cols, perPageCols, overlap)
      sheets.push({
        col0: colsRange.start,
        row0: rowsRange.start,
        cols: colsRange.count,
        rows: rowsRange.count,
      })
    }
  }
  return sheets
}

export interface ScreenLayoutOptions {
  showCodes: boolean
  includeBom: boolean
}

/**
 * 屏幕版：永远单页 —— 除非整图超过 PDF 的单页上限（14400pt ≈ 5080mm），
 * 那就普通分页（没有重叠带）。5.8m 的极限画布会走到这条路。
 * 页面 = 图案尺寸 + 四周 SCREEN_PAD_PT 留白（渲染器把图案放在留白内侧）。
 */
export function screenLayout(
  grid: CellGrid,
  pitchMm: number,
  options: ScreenLayoutOptions,
): DocumentLayout {
  const padPt = SCREEN_PAD_PT * 2
  const perPageCells = Math.max(1, Math.floor((MAX_PAGE_PT - padPt) / (pitchMm * PT_PER_MM)))
  const pageMm = {
    w: grid.cols * pitchMm + padPt / PT_PER_MM,
    h: grid.rows * pitchMm + padPt / PT_PER_MM,
  }
  const fits = pageMm.w * PT_PER_MM <= MAX_PAGE_PT && pageMm.h * PT_PER_MM <= MAX_PAGE_PT

  if (fits) {
    return {
      pageMm,
      cellsPerPage: { cols: grid.cols, rows: grid.rows },
      overlap: 0,
      sheets: [{ col0: 0, row0: 0, cols: grid.cols, rows: grid.rows }],
      marginMm: SCREEN_PAD_PT / PT_PER_MM,
      drawBoardSeams: true,
      drawSheetMarks: false,
      drawCodes: options.showCodes,
      drawRuler: false,
      includeBom: options.includeBom,
    }
  }

  const smallPageMm = {
    w: perPageCells * pitchMm + padPt / PT_PER_MM,
    h: perPageCells * pitchMm + padPt / PT_PER_MM,
  }
  return {
    pageMm: smallPageMm,
    cellsPerPage: { cols: perPageCells, rows: perPageCells },
    overlap: 0,
    sheets: paginate(grid.cols, grid.rows, perPageCells, perPageCells, 0),
    marginMm: SCREEN_PAD_PT / PT_PER_MM,
    drawBoardSeams: true,
    drawSheetMarks: false,
    drawCodes: options.showCodes,
    drawRuler: false,
    includeBom: options.includeBom,
  }
}

export interface PaperLayoutOptions {
  marginMm?: number
  overlap?: number
  showCodes?: boolean
  includeBom?: boolean
  /** 只导出这些板（按板导出）；不传就是整图 */
  boards?: BoardGeometry['boards']
}

/** 纸面版：1:1 分页，带重叠带 */
export function paperLayout(
  grid: CellGrid,
  pitchMm: number,
  options: PaperLayoutOptions = {},
): DocumentLayout {
  const marginMm = options.marginMm ?? DEFAULT_MARGIN_MM
  const overlap = options.overlap ?? OVERLAP_CELLS
  const capacity = paperCapacity(pitchMm, marginMm)
  const sheets = options.boards?.length
    ? options.boards.flatMap((board) =>
        paginate(board.cw, board.rh, capacity.cols, capacity.rows, overlap).map((sheet) => ({
          col0: sheet.col0 + board.c0,
          row0: sheet.row0 + board.r0,
          cols: sheet.cols,
          rows: sheet.rows,
        })),
      )
    : paginate(grid.cols, grid.rows, capacity.cols, capacity.rows, overlap)

  return {
    pageMm: { ...A4_MM },
    cellsPerPage: overlap > 0 ? capacity : capacity,
    overlap,
    sheets,
    marginMm,
    drawBoardSeams: true,
    drawSheetMarks: true,
    drawCodes: options.showCodes ?? false,
    drawRuler: true,
    includeBom: options.includeBom ?? true,
  }
}

// ---------------------------------------------------------------------------
// 自适应标注（第 7.8 节）：大色块打一个大标签 + 边界环逐格标，小碎块全部逐格标
// ---------------------------------------------------------------------------

export interface AnnotationOptions {
  /** 内接正方形小于这个格数就不打大标签 */
  minRegionSize: number
  /** 大标签字号至少是逐格字号的这么多倍才有意义 */
  bigLabelRatio: number
  /** 大标签字号上限（pt） */
  maxBigPt: number
  /** 逐格字号低于这个值就降级成 1-2 位编号 */
  numberBelowPt: number
  /** 关掉就完全不标注（纸面版默认关） */
  enabled: boolean
}

export const DEFAULT_ANNOTATION: AnnotationOptions = {
  minRegionSize: 3,
  bigLabelRatio: 1.8,
  maxBigPt: 22,
  numberBelowPt: 2.4,
  enabled: true,
}

export interface RegionLabel {
  colorIndex: number
  col: number
  row: number
  /** 内接正方形边长（格） */
  size: number
  fontSizePt: number
}

export interface AnnotationPlan {
  labels: RegionLabel[]
  /** 长度 = cols × rows，非 0 = 这一格要逐格标 */
  cellMarks: Uint8Array
  /** 每个色板索引要印的字（色号，或降级后的编号） */
  codeFor: string[]
  /** 每个色板索引的逐格字号（pt） */
  cellFontPt: Float32Array
  /** 哪些色降级成编号了 */
  degraded: boolean[]
  /** 编号 ↔ 色号 */
  numbers: Map<string, string>
  stats: {
    regions: number
    boundaryCells: number
    interiorCells: number
    textObjects: number
  }
}

/**
 * 标注规划。屏幕版和纸面版都走这里 —— 它是布局引擎的一部分，
 * 不是任何单个渲染器的代码，所以两边行为自动一致。
 */
export function planAnnotations(
  grid: CellGrid,
  palette: Palette,
  pitchMm: number,
  options: Partial<AnnotationOptions> = {},
): AnnotationPlan {
  const opts = { ...DEFAULT_ANNOTATION, ...options }
  const { cols, rows, cells } = grid
  const P = pitchMm * PT_PER_MM
  const cellMarks = new Uint8Array(cols * rows)
  const labels: RegionLabel[] = []
  const usage = usageByIndex(grid, palette.colors.length)
  const numbers = assignNumbers(usage, palette)

  // 每个色要印什么字、用多大字号：放不下就用 1-2 位编号
  const codeFor: string[] = []
  const cellFontPt = new Float32Array(palette.colors.length)
  const degraded: boolean[] = []
  for (let i = 0; i < palette.colors.length; i++) {
    const color = palette.colors[i]
    const byCode = Math.min(P * 0.45, (P * 1.6) / color.code.length)
    if (byCode < opts.numberBelowPt && usage[i] > 0) {
      const number = numbers.get(color.code) ?? color.code
      codeFor[i] = number
      cellFontPt[i] = Math.min(P * 0.45, (P * 1.6) / number.length)
      degraded[i] = true
    } else {
      codeFor[i] = color.code
      cellFontPt[i] = byCode
      degraded[i] = false
    }
  }

  const stats = { regions: 0, boundaryCells: 0, interiorCells: 0, textObjects: 0 }
  if (!opts.enabled) return { labels, cellMarks, codeFor, cellFontPt, degraded, numbers, stats }

  const total = cols * rows
  const visited = new Uint8Array(total)
  const inComponent = new Uint8Array(total)
  const ringMark = new Uint8Array(total)
  // 空档不算可拼区域：旧脏数据里的格子不能变成大标签或逐格标
  const placeable = grid.placeable
  const open = (i: number) => !placeable || placeable[i] === 1
  let component = new Uint32Array(Math.min(total, 4096))
  let stack = new Int32Array(Math.min(total, 4096))

  for (let start = 0; start < total; start++) {
    if (visited[start] || cells[start] === EMPTY || !open(start)) continue
    const color = cells[start]

    // ① 4 邻域 BFS 求连通域（显式栈，大图不爆）
    let size = 0
    let top = 0
    visited[start] = 1
    stack[top++] = start
    while (top > 0) {
      const i = stack[--top]
      if (size === component.length) component = growU32(component)
      component[size++] = i
      inComponent[i] = 1
      const x = i % cols
      const y = (i - x) / cols
      if (x > 0 && !visited[i - 1] && cells[i - 1] === color && open(i - 1)) {
        visited[i - 1] = 1
        if (top === stack.length) stack = growI32(stack, top)
        stack[top++] = i - 1
      }
      if (x + 1 < cols && !visited[i + 1] && cells[i + 1] === color && open(i + 1)) {
        visited[i + 1] = 1
        if (top === stack.length) stack = growI32(stack, top)
        stack[top++] = i + 1
      }
      if (y > 0 && !visited[i - cols] && cells[i - cols] === color && open(i - cols)) {
        visited[i - cols] = 1
        if (top === stack.length) stack = growI32(stack, top)
        stack[top++] = i - cols
      }
      if (y + 1 < rows && !visited[i + cols] && cells[i + cols] === color && open(i + cols)) {
        visited[i + cols] = 1
        if (top === stack.length) stack = growI32(stack, top)
        stack[top++] = i + cols
      }
    }
    stats.regions++

    // ② 拆边界环 / 内部。⚠️ 棋盘外沿不算边界（否则最外圈会被全部逐格标）
    let ringCount = 0
    let minX = cols
    let minY = rows
    let maxX = 0
    let maxY = 0
    const ringFlags = new Uint8Array(size)
    for (let k = 0; k < size; k++) {
      const i = component[k]
      const x = i % cols
      const y = (i - x) / cols
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      const touchesOther =
        (x > 0 && cells[i - 1] !== color) ||
        (x + 1 < cols && cells[i + 1] !== color) ||
        (y > 0 && cells[i - cols] !== color) ||
        (y + 1 < rows && cells[i + cols] !== color)
      if (touchesOther) {
        ringFlags[k] = 1
        ringMark[i] = 1
        ringCount++
      }
    }
    stats.boundaryCells += ringCount
    stats.interiorCells += size - ringCount

    // ③ 在【内部】上求最大内接正方形（DP）。不能整块求，否则大标签会压到边界环。
    //    也不能用包围盒代替：1×50 的长条包围盒很大，里面根本放不下字。
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const dp = new Int32Array(bw * bh)
    let best = 0
    let bestX = -1
    let bestY = -1
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const gi = (minY + y) * cols + (minX + x)
        if (inComponent[gi] === 0 || ringMark[gi] === 1) continue
        const left = x > 0 ? dp[y * bw + x - 1] : 0
        const up = y > 0 ? dp[(y - 1) * bw + x] : 0
        const upLeft = x > 0 && y > 0 ? dp[(y - 1) * bw + x - 1] : 0
        const value = 1 + Math.min(left, up, upLeft)
        dp[y * bw + x] = value
        if (value > best) {
          best = value
          bestX = x
          bestY = y
        }
      }
    }

    // ④ 判定：大标签够大就内部打一个 + 边界环逐格；否则整块逐格（小碎块走这条）
    const code = codeFor[color]
    const n = Math.max(1, code.length)
    const cellSize = cellFontPt[color]
    const S = best * P
    const bigSize = Math.min(S * 0.62, (S * 1.7) / n, opts.maxBigPt)

    if (best >= opts.minRegionSize && bigSize >= cellSize * opts.bigLabelRatio) {
      labels.push({
        colorIndex: color,
        col: minX + bestX - best + 1,
        row: minY + bestY - best + 1,
        size: best,
        fontSizePt: bigSize,
      })
      for (let k = 0; k < size; k++) {
        if (ringFlags[k] === 1) cellMarks[component[k]] = 1
      }
    } else {
      for (let k = 0; k < size; k++) cellMarks[component[k]] = 1
    }

    // 清理临时标记，下一块复用同一片内存
    for (let k = 0; k < size; k++) {
      inComponent[component[k]] = 0
      ringMark[component[k]] = 0
    }
  }

  let marked = 0
  for (let i = 0; i < cellMarks.length; i++) if (cellMarks[i]) marked++
  stats.textObjects = labels.length + marked
  return { labels, cellMarks, codeFor, cellFontPt, degraded, numbers, stats }
}

function growU32(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> {
  const next = new Uint32Array(array.length * 2)
  next.set(array)
  return next
}

function growI32(array: Int32Array<ArrayBuffer>, used: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(array.length * 2)
  next.set(array.subarray(0, used))
  return next
}

export { EMPTY }
