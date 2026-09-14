import type { BoardGeometry } from '../domain/board.ts'
import { EMPTY, isPlaceable, type CellGrid, usageByIndex } from '../domain/grid.ts'
import { PT_PER_MM } from '../domain/geometry.ts'
import type { Palette } from '../domain/palette.ts'
import { assignNumbers } from './bom.ts'

export const A4_MM = { w: 210, h: 297 }
/** 不可打印边距默认 5mm；不同打印机不同，做成可配置（第 7.1 节） */
export const DEFAULT_MARGIN_MM = 5
/** 纸面版页眉预留区：标题、范围和坐标数字不能压到图案上。 */
export const PAPER_HEADER_MM = 18
/** 重叠带宽度：3 列 / 行豆，兼顾辨认和省纸 */
export const OVERLAP_CELLS = 3
/** 裁切后片段之间留出的空白，方便用剪刀分开。 */
export const PAPER_PACK_GAP_MM = 10
/** 多个小片段排在同一页时，片段编号和坐标数字占用的上方空间。 */
export const PAPER_FRAGMENT_LABEL_PT = 14
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

/** A4 上实际打印的一个纸样片段；range 是裁切后的范围，source 是原始分页范围。 */
export interface PaperFragment {
  range: SheetRange
  source: SheetRange
  sourceIndex: number
  /** 片段左下角在 A4 页面中的位置（PDF 点），不改变格子的 1:1 尺寸。 */
  xPt: number
  yPt: number
  cropped: boolean
  showLabel: boolean
}

/** 一张实际的 A4 纸，可能承载一个完整纸页，也可能承载多个稀疏片段。 */
export interface PaperPage {
  fragments: PaperFragment[]
}

export interface DocumentLayout {
  /** 页面尺寸，毫米 */
  pageMm: { w: number; h: number }
  /** 纸面版自动选择的 A4 方向；屏幕版不使用此字段 */
  orientation?: PaperOrientation
  /** 一页能放几列 / 几行豆 */
  cellsPerPage: { cols: number; rows: number }
  /** 重叠带宽度（格），0 = 不分页 */
  overlap: number
  /** 页面划分：每页覆盖的全局豆格范围 */
  sheets: SheetRange[]
  /** 纸面版实际输出的 A4 页；屏幕版不使用此字段。 */
  pages?: PaperPage[]
  marginMm: number
  drawBoardSeams: boolean
  drawSheetMarks: boolean
  drawCodes: boolean
  drawRuler: boolean
  includeBom: boolean
}

export type PaperOrientation = 'portrait' | 'landscape'

export interface PaperScope {
  col0: number
  row0: number
  col1: number
  row1: number
}

/**
 * A4 上按针距能放多少格（默认竖版：2.6mm → 76 × 110）。
 * 传入横版页面尺寸后，列 / 行容量会自动互换。
 */
export function paperCapacity(
  pitchMm: number,
  marginMm = DEFAULT_MARGIN_MM,
  pageMm: { w: number; h: number } = A4_MM,
  topReserveMm = 0,
) {
  return {
    cols: Math.max(1, Math.floor((pageMm.w - marginMm * 2) / pitchMm)),
    rows: Math.max(1, Math.floor((pageMm.h - marginMm * 2 - topReserveMm) / pitchMm)),
  }
}

export function a4PageMm(orientation: PaperOrientation): { w: number; h: number } {
  return orientation === 'landscape' ? { w: A4_MM.h, h: A4_MM.w } : { ...A4_MM }
}

/** 本次纸面导出的外接范围；多个底板合并成一个连续分页范围。 */
export function getPaperScope(grid: CellGrid, boards?: BoardGeometry['boards']): PaperScope {
  if (!boards?.length) return { col0: 0, row0: 0, col1: grid.cols, row1: grid.rows }

  let col0 = Number.POSITIVE_INFINITY
  let row0 = Number.POSITIVE_INFINITY
  let col1 = 0
  let row1 = 0
  for (const board of boards) {
    col0 = Math.min(col0, board.c0)
    row0 = Math.min(row0, board.r0)
    col1 = Math.max(col1, board.c0 + board.cw)
    row1 = Math.max(row1, board.r0 + board.rh)
  }
  return { col0, row0, col1, row1 }
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
  /** 兼容旧调用：多个板会合并成一个外接范围分页，不会再一块板生成一份 PDF */
  boards?: BoardGeometry['boards']
}

/** 纸面版：1:1 A4 分页，按整张板阵合并分页并带重叠带。 */
export function paperLayout(
  grid: CellGrid,
  pitchMm: number,
  options: PaperLayoutOptions = {},
): DocumentLayout {
  const marginMm = options.marginMm ?? DEFAULT_MARGIN_MM
  const scope = getPaperScope(grid, options.boards)
  const requestedOverlap = Math.max(0, Math.floor(options.overlap ?? OVERLAP_CELLS))

  const candidate = (orientation: PaperOrientation) => {
    const pageMm = a4PageMm(orientation)
    const capacity = paperCapacity(pitchMm, marginMm, pageMm, PAPER_HEADER_MM)
    // 至少保留一格新的内容，避免极端小页面被重叠带完全占满。
    const overlap = Math.max(
      0,
      Math.min(
        requestedOverlap,
        capacity.cols - 1,
        capacity.rows - 1,
        scope.col1 - scope.col0 - 1,
        scope.row1 - scope.row0 - 1,
      ),
    )
    const sheets = paginate(
      scope.col1 - scope.col0,
      scope.row1 - scope.row0,
      capacity.cols,
      capacity.rows,
      overlap,
    ).map((sheet) => ({
      col0: sheet.col0 + scope.col0,
      row0: sheet.row0 + scope.row0,
      cols: sheet.cols,
      rows: sheet.rows,
    }))
    const pages = packPaperPages(grid, sheets, scope, pageMm, marginMm, overlap, pitchMm)
    return { orientation, pageMm, capacity, overlap, sheets, pages }
  }

  const portrait = candidate('portrait')
  const landscape = candidate('landscape')
  const scopeWidth = scope.col1 - scope.col0
  const scopeHeight = scope.row1 - scope.row0
  const chosen =
    portrait.pages.length < landscape.pages.length
      ? portrait
      : landscape.pages.length < portrait.pages.length
        ? landscape
        : scopeWidth > scopeHeight
          ? landscape
          : portrait

  return {
    pageMm: chosen.pageMm,
    orientation: chosen.orientation,
    cellsPerPage: chosen.capacity,
    overlap: chosen.overlap,
    sheets: chosen.sheets,
    pages: chosen.pages,
    marginMm,
    drawBoardSeams: true,
    drawSheetMarks: true,
    drawCodes: options.showCodes ?? true,
    drawRuler: true,
    includeBom: options.includeBom ?? true,
  }
}

interface SheetTrim {
  range: SheetRange
  cropped: boolean
  /** 即使没有彩色豆子，只要逻辑页本身是窄条，也应参与 A4 装箱。 */
  packable: boolean
}

interface ContentBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

/**
 * 找出一张逻辑分页里真正有豆子的范围。空白页保留原尺寸，避免把“没有图案”误删成没有定位信息。
 */
function contentBounds(grid: CellGrid, sheet: SheetRange): ContentBounds | null {
  let minCol = Number.POSITIVE_INFINITY
  let minRow = Number.POSITIVE_INFINITY
  let maxCol = -1
  let maxRow = -1
  for (let row = sheet.row0; row < sheet.row0 + sheet.rows; row++) {
    const rowBase = row * grid.cols
    for (let col = sheet.col0; col < sheet.col0 + sheet.cols; col++) {
      const index = rowBase + col
      if (grid.cells[index] === EMPTY || !isPlaceable(grid, index)) continue
      minCol = Math.min(minCol, col)
      minRow = Math.min(minRow, row)
      maxCol = Math.max(maxCol, col)
      maxRow = Math.max(maxRow, row)
    }
  }
  return maxCol < 0 ? null : { minCol, minRow, maxCol, maxRow }
}

/**
 * 只裁“明显稀疏”的逻辑页。裁切范围保留 2～3 格缓冲；如果图案靠近相邻页，
 * 对应的外边缘也会保留，红色重叠线仍然有地方落下。所有坐标和格子尺寸保持原值。
 */
function trimSparseSheet(
  grid: CellGrid,
  sheet: SheetRange,
  scope: PaperScope,
  overlap: number,
  capacity: { cols: number; rows: number },
): SheetTrim {
  const bounds = contentBounds(grid, sheet)
  if (!bounds) {
    const narrow = sheet.cols < capacity.cols * 0.62 || sheet.rows < capacity.rows * 0.62
    return { range: sheet, cropped: false, packable: narrow }
  }

  const padding = Math.max(2, overlap)
  let col0 = Math.max(sheet.col0, bounds.minCol - padding)
  let row0 = Math.max(sheet.row0, bounds.minRow - padding)
  let col1 = Math.min(sheet.col0 + sheet.cols, bounds.maxCol + 1 + padding)
  let row1 = Math.min(sheet.row0 + sheet.rows, bounds.maxRow + 1 + padding)

  // 只有图案本身靠近分页边缘时才保留那一侧的重叠带；远离图案的空白边不必带上，
  // 否则为了保留一条没有内容的边，会把本来很小的片段重新撑满整页。
  if (overlap > 0) {
    if (sheet.col0 > scope.col0 && bounds.minCol - sheet.col0 <= padding) {
      const seam = Math.min(overlap, sheet.cols)
      col0 = sheet.col0
      col1 = Math.max(col1, sheet.col0 + seam)
    }
    if (
      sheet.col0 + sheet.cols < scope.col1 &&
      sheet.col0 + sheet.cols - 1 - bounds.maxCol <= padding
    ) {
      const seam = Math.min(overlap, sheet.cols)
      col0 = Math.min(col0, sheet.col0 + sheet.cols - seam)
      col1 = sheet.col0 + sheet.cols
    }
    if (sheet.row0 > scope.row0 && bounds.minRow - sheet.row0 <= padding) {
      const seam = Math.min(overlap, sheet.rows)
      row0 = sheet.row0
      row1 = Math.max(row1, sheet.row0 + seam)
    }
    if (
      sheet.row0 + sheet.rows < scope.row1 &&
      sheet.row0 + sheet.rows - 1 - bounds.maxRow <= padding
    ) {
      const seam = Math.min(overlap, sheet.rows)
      row0 = Math.min(row0, sheet.row0 + sheet.rows - seam)
      row1 = sheet.row0 + sheet.rows
    }
  }

  const range = { col0, row0, cols: col1 - col0, rows: row1 - row0 }
  const originalArea = sheet.cols * sheet.rows
  const trimmedArea = range.cols * range.rows
  // 低于约 62% 才视为稀疏页，避免普通满幅图案只是因为边缘有少量空白就被拆碎。
  const sparse = trimmedArea < originalArea * 0.62
  const narrow = range.cols < capacity.cols * 0.62 || range.rows < capacity.rows * 0.62
  return sparse || narrow
    ? { range, cropped: sparse, packable: true }
    : { range: sheet, cropped: false, packable: false }
}

/**
 * 将稀疏页做“先裁切、再排版”的装箱。这里只平移片段，不做任何缩放，
 * 因而打印后每格仍是 pitchMm 毫米；完整页则保持单独一张 A4。
 */
function packPaperPages(
  grid: CellGrid,
  sheets: SheetRange[],
  scope: PaperScope,
  pageMm: { w: number; h: number },
  marginMm: number,
  overlap: number,
  pitchMm: number,
): PaperPage[] {
  const P = pitchMm * PT_PER_MM
  const pageWidthPt = pageMm.w * PT_PER_MM
  const pageHeightPt = pageMm.h * PT_PER_MM
  const marginPt = marginMm * PT_PER_MM
  const contentWidthPt = pageWidthPt - marginPt * 2
  const contentHeightPt = pageHeightPt - marginPt * 2 - PAPER_HEADER_MM * PT_PER_MM
  const gapPt = PAPER_PACK_GAP_MM * PT_PER_MM
  const labelPt = PAPER_FRAGMENT_LABEL_PT
  const capacity = {
    cols: contentWidthPt / P,
    rows: contentHeightPt / P,
  }
  const pages: PaperPage[] = []

  let packed: PaperPage | null = null
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  const flush = () => {
    if (packed && packed.fragments.length > 0) pages.push(packed)
    packed = null
    cursorX = 0
    cursorY = 0
    rowHeight = 0
  }

  const addStandalone = (
    range: SheetRange,
    source: SheetRange,
    sourceIndex: number,
    cropped: boolean,
    showLabel = cropped,
  ) => {
    const height = range.rows * P
    const labelHeight = showLabel ? labelPt : 0
    pages.push({
      fragments: [
        {
          range,
          source,
          sourceIndex,
          xPt: marginPt,
          yPt: pageHeightPt - marginPt - PAPER_HEADER_MM * PT_PER_MM - labelHeight - height,
          cropped,
          showLabel,
        },
      ],
    })
  }

  for (let sourceIndex = 0; sourceIndex < sheets.length; sourceIndex++) {
    const source = sheets[sourceIndex]
    const trimmed = trimSparseSheet(grid, source, scope, overlap, capacity)
    if (!trimmed.packable) {
      flush()
      addStandalone(trimmed.range, source, sourceIndex, false)
      continue
    }

    const width = trimmed.range.cols * P
    const height = trimmed.range.rows * P
    const itemHeight = labelPt + height
    // 逻辑页本身应该能放进 A4；编号额外占一点空间，若极端情况下放不下则保留单独裁片。
    if (width > contentWidthPt || itemHeight > contentHeightPt) {
      flush()
      addStandalone(trimmed.range, source, sourceIndex, trimmed.cropped, false)
      continue
    }

    if (!packed) packed = { fragments: [] }
    if (cursorX > 0 && cursorX + width > contentWidthPt) {
      cursorY += rowHeight + gapPt
      cursorX = 0
      rowHeight = 0
    }
    if (cursorY + itemHeight > contentHeightPt && packed.fragments.length > 0) {
      flush()
      packed = { fragments: [] }
    }

    const originY = pageHeightPt - marginPt - PAPER_HEADER_MM * PT_PER_MM - cursorY - itemHeight
    packed.fragments.push({
      range: trimmed.range,
      source,
      sourceIndex,
      xPt: marginPt + cursorX,
      yPt: originY,
      cropped: true,
      showLabel: true,
    })
    cursorX += width + gapPt
    rowHeight = Math.max(rowHeight, itemHeight)
  }
  flush()
  return pages
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
  /** 关掉就完全不标注；纸面版默认打开，便于垫板拼色 */
  enabled: boolean
}

export const DEFAULT_ANNOTATION: AnnotationOptions = {
  minRegionSize: 3,
  bigLabelRatio: 1.8,
  maxBigPt: 22,
  numberBelowPt: 2.4,
  enabled: true,
}

/** Helvetica 字符平均宽度；逐格标注按这个值给色号留出真实横向空间。 */
const CELL_CODE_WIDTH_EM = 0.62

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
    // Leave a little whitespace inside a 2.6mm cell; labels are plain black/white text.
    const byCode = Math.min(
      P * 0.5,
      (P * 0.82) / (CELL_CODE_WIDTH_EM * color.code.length),
    )
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

    // ② 拆边界环 / 内部。图案外沿和不可用空档也算边界，整块单色区域才会有清晰外圈。
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
        x === 0 ||
        (x > 0 && (!open(i - 1) || cells[i - 1] !== color)) ||
        x + 1 === cols ||
        (x + 1 < cols && (!open(i + 1) || cells[i + 1] !== color)) ||
        y === 0 ||
        (y > 0 && (!open(i - cols) || cells[i - cols] !== color)) ||
        y + 1 === rows ||
        (y + 1 < rows && (!open(i + cols) || cells[i + cols] !== color))
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
