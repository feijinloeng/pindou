import { boardGuide, type BoardGeometry } from '../domain/board'
import { EMPTY, isPlaceable, type CellGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import { hexToRgb, labelTextColor, paletteDisplayLabel, type Palette } from '../domain/palette'
import { bomPageCount, bomRowsPerPage, buildBom, drawBom, totalBeads } from './bom'
import { planAnnotations, screenLayout, SCREEN_PAD_PT, type AnnotationPlan } from './documentLayout'
import { BOARD_BG } from './colors'
import { gray255, type PdfSink } from './pdf'

/** 整块板的灰色细网格；黑色虚线下方的线段留空避免叠线 */
export const THIN_GRID = { widthPt: 0.25, rgb: gray255(0.6) }
/** 实体 mini 板上的 10×10 黑色实线框，线宽沿用灰色细网格 */
export const BOARD_GUIDE = { widthPt: THIN_GRID.widthPt, rgb: [0, 0, 0] as [number, number, number] }
/** 每个 10×10 单元中间的 5×5 黑色虚线十字，线宽同样不加粗 */
export const BOARD_GUIDE_DASH = { widthPt: THIN_GRID.widthPt, rgb: [0, 0, 0] as [number, number, number] }
/** 打印纸页的红色拼接线；和实体板的黑色定位线分开 */
export const SHEET_SEAM = { widthPt: 0.9, rgb: [210, 43, 43] as [number, number, number] }

export interface ScreenPdfOptions {
  grid: CellGrid
  palette: Palette
  geom: BoardGeometry
  pitchMm: number
  pitchLabel: number
  showCodes: boolean
  includeBom: boolean
  /** 板阵左上角在页面里的偏移（PDF 点）。默认 = 屏幕版的四周留白 */
  originPt?: { x: number; y: number }
  /** 页眉文字（屏幕版一般没有） */
  showTitle?: boolean
}

interface ScreenPdfResult {
  plan: AnnotationPlan
  pageCount: number
  widthPt: number
  heightPt: number
}

/**
 * 屏幕版制作文档：单页矢量，无尺度（第 10、11.2 节）。
 * 性能关键是**按色分桶**：每色一条 path、一次 f，而不是每格一次填充。
 */
export function renderScreenPdf(sink: PdfSink, options: ScreenPdfOptions): ScreenPdfResult {
  const { grid, palette, geom } = options
  const layout = screenLayout(grid, options.pitchMm, {
    showCodes: options.showCodes,
    includeBom: options.includeBom,
  })
  const P = options.pitchMm * PT_PER_MM
  const margin = options.originPt ?? { x: SCREEN_PAD_PT, y: SCREEN_PAD_PT }
  const plan = planAnnotations(grid, palette, options.pitchMm, { enabled: options.showCodes })

  // 正常情况只有一页；整图超过 PDF 单页上限时才会分页（没有重叠带）
  layout.sheets.forEach((sheet, index) => {
    if (index > 0) {
      sink.addPage(layout.pageMm.w * PT_PER_MM, layout.pageMm.h * PT_PER_MM)
    }
    const drawWidth = sheet.cols * P
    const drawHeight = sheet.rows * P

    // 底面
    sink.fillColor(hexToRgb(BOARD_BG))
    sink.rect(margin.x, margin.y, drawWidth, drawHeight)
    sink.fill()

    // 豆子：按色分桶
    drawCells(sink, grid, palette, sheet, margin, P)

    // 10×10 工作区保留灰格，黑色虚线下方的灰线段留空
    strokeGrid(sink, sheet, margin, P, THIN_GRID, 1, geom)

    // 实体板定位线：黑色 10 格实线 + 5 格虚线十字
    strokeBoardGuides(sink, geom, sheet, margin, P)

    // 坐标数字
    drawCoordinates(sink, sheet, margin, P, 10)

    // 自适应标注
    if (options.showCodes) drawAnnotations(sink, grid, palette, plan, sheet, margin, P)

    if (layout.sheets.length > 1) {
      sink.fillColor([0, 0, 0])
      sink.text(
        `Page ${index + 1}/${layout.sheets.length} | cols ${sheet.col0}-${sheet.col0 + sheet.cols - 1} rows ${sheet.row0}-${sheet.row0 + sheet.rows - 1}`,
        margin.x,
        6,
        6,
        'fill',
      )
    }
  })

  // 用量清单（末页）
  if (options.includeBom) {
    const bomPageHeight = 841.89
    const rows = buildBom(grid, palette)
    const bomPages = bomPageCount(rows.length, bomPageHeight)
    const rowsPerPage = bomRowsPerPage(bomPageHeight)
    for (let pageIndex = 0; pageIndex < bomPages; pageIndex++) {
      sink.addPage(595.28, bomPageHeight)
      const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage)
      const pageLabel = bomPages > 1 ? ` · 第 ${pageIndex + 1}/${bomPages} 页` : ''
      drawBom(sink, pageRows, {
        x: 40,
        yTop: bomPageHeight - 60,
        width: 515,
        title: `${paletteDisplayLabel(palette)} · ${options.pitchLabel} 毫米 · 用量清单${pageLabel}`,
        showSummary: pageIndex === bomPages - 1,
        summary: { total: totalBeads(rows), colors: rows.length },
      })
    }
  }

  return {
    plan,
    pageCount: sink.pageCount(),
    widthPt: layout.pageMm.w * PT_PER_MM,
    heightPt: layout.pageMm.h * PT_PER_MM,
  }
}

/**
 * 按色分桶填充：每色一条 path + 一次 f（133 万格时是 291 次填充，不是 133 万次）。
 *
 * 顺带做一次行程合并：一行里连续同色的格子合成一个矩形。
 * 9×9 色块时矩形数从 130 万降到 14 万，文件直接小一半 —— 外观完全一样。
 */
export function drawCells(
  sink: PdfSink,
  grid: CellGrid,
  palette: Palette,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
): { fills: number; rects: number } {
  const buckets = new Map<number, number[]>()
  const rowBase = sheet.row0 * grid.cols + sheet.col0
  let rects = 0

  for (let y = 0; y < sheet.rows; y++) {
    let x = 0
    while (x < sheet.cols) {
      const gi = rowBase + y * grid.cols + x
      const value = grid.cells[gi]
      // 空档不是作品的一部分：旧数据里的脏格子一律不画
      if (value === EMPTY || !isPlaceable(grid, gi)) {
        x++
        continue
      }
      let end = x + 1
      while (
        end < sheet.cols &&
        grid.cells[rowBase + y * grid.cols + end] === value &&
        isPlaceable(grid, rowBase + y * grid.cols + end)
      )
        end++
      // y 轴翻转：第 (c, r) 格左下角 = origin.y + (rows - r - 1) * P
      const rect = [origin.x + x * P, origin.y + (sheet.rows - y - 1) * P, (end - x) * P, P]
      const list = buckets.get(value)
      if (list) list.push(...rect)
      else buckets.set(value, rect)
      rects++
      x = end
    }
  }

  let fills = 0
  const ordered = [...buckets.keys()].sort((a, b) => a - b)
  for (const index of ordered) {
    const color = palette.colors[index]
    if (!color) continue
    sink.fillColor(hexToRgb(color.hex))
    const list = buckets.get(index)!
    for (let i = 0; i < list.length; i += 4) {
      sink.rect(list[i], list[i + 1], list[i + 2], list[i + 3])
    }
    sink.fill()
    fills++
  }
  return { fills, rects }
}

export function strokeGrid(
  sink: PdfSink,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
  style: { widthPt: number; rgb: readonly [number, number, number] },
  every: number,
  geom?: BoardGeometry,
): void {
  sink.strokeColor(style.rgb)
  sink.lineWidth(style.widthPt)
  sink.dash([])

  const vertical = (x: number, top: number, bottom: number) => {
    if (x < sheet.col0 || x > sheet.col0 + sheet.cols) return
    const clippedTop = Math.max(top, sheet.row0)
    const clippedBottom = Math.min(bottom, sheet.row0 + sheet.rows)
    if (clippedTop >= clippedBottom) return
    const px = origin.x + (x - sheet.col0) * P
    sink.moveTo(px, origin.y + (sheet.rows - (clippedBottom - sheet.row0)) * P)
    sink.lineTo(px, origin.y + (sheet.rows - (clippedTop - sheet.row0)) * P)
  }
  const horizontal = (y: number, left: number, right: number) => {
    if (y < sheet.row0 || y > sheet.row0 + sheet.rows) return
    const clippedLeft = Math.max(left, sheet.col0)
    const clippedRight = Math.min(right, sheet.col0 + sheet.cols)
    if (clippedLeft >= clippedRight) return
    const py = origin.y + (sheet.rows - (y - sheet.row0)) * P
    sink.moveTo(origin.x + (clippedLeft - sheet.col0) * P, py)
    sink.lineTo(origin.x + (clippedRight - sheet.col0) * P, py)
  }
  const drawRegion = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    guide: ReturnType<typeof boardGuide>,
  ) => {
    for (let x = left; x <= right; x += every) {
      if (guide?.dashedCols.includes(x)) {
        vertical(x, top, guide.top)
        vertical(x, guide.bottom, bottom)
      } else {
        vertical(x, top, bottom)
      }
    }
    if ((right - left) % every !== 0) vertical(right, top, bottom)
    for (let y = top; y <= bottom; y += every) {
      if (guide?.dashedRows.includes(y)) {
        horizontal(y, left, guide.left)
        horizontal(y, guide.right, right)
      } else {
        horizontal(y, left, right)
      }
    }
    if ((bottom - top) % every !== 0) horizontal(bottom, left, right)
  }

  if (geom) {
    for (const board of geom.boards) {
      drawRegion(board.c0, board.r0, board.c0 + board.cw, board.r0 + board.rh, boardGuide(board))
    }
  } else {
    drawRegion(sheet.col0, sheet.row0, sheet.col0 + sheet.cols, sheet.row0 + sheet.rows, null)
  }
  sink.stroke()
}

/** Draw each board's real solid boundaries and dashed center crosses. */
export function strokeBoardGuides(
  sink: PdfSink,
  geom: BoardGeometry,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
): void {
  strokeGuideLayer(sink, geom, sheet, origin, P, false)
  strokeGuideLayer(sink, geom, sheet, origin, P, true)
}

function strokeGuideLayer(
  sink: PdfSink,
  geom: BoardGeometry,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
  dashed: boolean,
): void {
  sink.strokeColor((dashed ? BOARD_GUIDE_DASH : BOARD_GUIDE).rgb)
  sink.lineWidth((dashed ? BOARD_GUIDE_DASH : BOARD_GUIDE).widthPt)
  sink.dash(dashed ? [1.5, 1.5] : [])
  let any = false

  const vertical = (x: number, top: number, bottom: number) => {
    if (x < sheet.col0 || x > sheet.col0 + sheet.cols) return
    const clippedTop = Math.max(top, sheet.row0)
    const clippedBottom = Math.min(bottom, sheet.row0 + sheet.rows)
    if (clippedTop >= clippedBottom) return
    const px = origin.x + (x - sheet.col0) * P
    sink.moveTo(px, origin.y + (sheet.rows - (clippedBottom - sheet.row0)) * P)
    sink.lineTo(px, origin.y + (sheet.rows - (clippedTop - sheet.row0)) * P)
    any = true
  }
  const horizontal = (y: number, left: number, right: number) => {
    if (y < sheet.row0 || y > sheet.row0 + sheet.rows) return
    const clippedLeft = Math.max(left, sheet.col0)
    const clippedRight = Math.min(right, sheet.col0 + sheet.cols)
    if (clippedLeft >= clippedRight) return
    const py = origin.y + (sheet.rows - (y - sheet.row0)) * P
    sink.moveTo(origin.x + (clippedLeft - sheet.col0) * P, py)
    sink.lineTo(origin.x + (clippedRight - sheet.col0) * P, py)
    any = true
  }

  for (const board of geom.boards) {
    const guide = boardGuide(board)
    if (guide) {
      const cols = dashed ? guide.dashedCols : guide.solidCols
      const rows = dashed ? guide.dashedRows : guide.solidRows
      for (const x of cols) vertical(x, guide.top, guide.bottom)
      for (const y of rows) horizontal(y, guide.left, guide.right)
    } else if (!dashed) {
      vertical(board.c0, board.r0, board.r0 + board.rh)
      vertical(board.c0 + board.cw, board.r0, board.r0 + board.rh)
      horizontal(board.r0, board.c0, board.c0 + board.cw)
      horizontal(board.r0 + board.rh, board.c0, board.c0 + board.cw)
    }
  }
  if (any) sink.stroke()
}

/** 左边缘 + 上边缘的坐标数字，每 10 格标一次全局列号/行号 */
export function drawCoordinates(
  sink: PdfSink,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
  every: number,
): void {
  const size = Math.min(6, Math.max(3.5, P * 0.5))
  const items: Array<{ text: string; x: number; baselineY: number }> = []
  for (let x = 0; x <= sheet.cols; x += every) {
    items.push({
      text: String(sheet.col0 + x),
      x: origin.x + x * P + 1,
      baselineY: origin.y + sheet.rows * P + size * 1.2,
    })
  }
  for (let y = 0; y <= sheet.rows; y += every) {
    items.push({
      text: String(sheet.row0 + y),
      x: origin.x - size * 2.2,
      baselineY: origin.y + (sheet.rows - y) * P,
    })
  }
  sink.textBatch(items, size, gray255(0.25), 'fill')
}

/**
 * 画标注：大标签打在最大内接正方形里，逐格标打在格心；文字只用黑或白。
 * ⚠️ 文字色必须按底色亮度算，不能硬编码黑 —— 深色区域上的黑字是隐形的。
 */
export function drawAnnotations(
  sink: PdfSink,
  grid: CellGrid,
  palette: Palette,
  plan: AnnotationPlan,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
  options: { ensureVisibleCodes?: boolean } = {},
): number {
  let objects = 0
  const drawnColors = new Set<number>()
  const groups = new Map<
    string,
    {
      items: Array<{ text: string; x: number; baselineY: number }>
      size: number
      fill: [number, number, number]
    }
  >()

  const push = (
    colorIndex: number,
    code: string,
    centerX: number,
    centerY: number,
    size: number,
    hex: string,
  ) => {
    drawnColors.add(colorIndex)
    const light = labelTextColor(hex) === 'black'
    const fill: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255]
    const rounded = Math.round(size * 100) / 100
    const key = `${rounded}|${fill.join(',')}`
    let group = groups.get(key)
    if (!group) {
      group = { items: [], size: rounded, fill }
      groups.set(key, group)
    }
    const laid = layoutCellText(code, centerX, centerY, rounded)
    group.items.push({ text: code, x: laid.x, baselineY: laid.y })
    objects++
  }

  for (const label of plan.labels) {
    const localCol = label.col - sheet.col0
    const localRow = label.row - sheet.row0
    if (localCol < 0 || localRow < 0) continue
    if (localCol + label.size > sheet.cols || localRow + label.size > sheet.rows) continue
    const color = palette.colors[label.colorIndex]
    // 内接正方形的中心
    push(
      label.colorIndex,
      plan.codeFor[label.colorIndex],
      origin.x + (localCol + label.size / 2) * P,
      origin.y + (sheet.rows - localRow - label.size / 2) * P,
      label.fontSizePt,
      color.hex,
    )
  }

  for (let y = 0; y < sheet.rows; y++) {
    for (let x = 0; x < sheet.cols; x++) {
      const gi = (sheet.row0 + y) * grid.cols + sheet.col0 + x
      if (!plan.cellMarks[gi]) continue
      const value = grid.cells[gi]
      const color = palette.colors[value]
      if (!color) continue
      push(
        value,
        plan.codeFor[value],
        origin.x + (x + 0.5) * P,
        origin.y + (sheet.rows - y - 0.5) * P,
        plan.cellFontPt[value],
        color.hex,
      )
    }
  }

  // A large region can cross a page boundary: its global center label and outer ring
  // may both land on other pages. Keep every paper page self-explanatory by adding a
  // quiet fallback label for colors that are present here but have no visible mark.
  if (options.ensureVisibleCodes) {
    const bounds = new Map<
      number,
      { minX: number; minY: number; maxX: number; maxY: number; count: number }
    >()
    for (let y = 0; y < sheet.rows; y++) {
      for (let x = 0; x < sheet.cols; x++) {
        const gi = (sheet.row0 + y) * grid.cols + sheet.col0 + x
        const value = grid.cells[gi]
        if (value === EMPTY || !isPlaceable(grid, gi) || drawnColors.has(value)) continue
        const current = bounds.get(value)
        if (current) {
          current.minX = Math.min(current.minX, x)
          current.minY = Math.min(current.minY, y)
          current.maxX = Math.max(current.maxX, x)
          current.maxY = Math.max(current.maxY, y)
          current.count++
        } else {
          bounds.set(value, { minX: x, minY: y, maxX: x, maxY: y, count: 1 })
        }
      }
    }
    for (const [value, bound] of bounds) {
      const color = palette.colors[value]
      if (!color) continue
      const span = Math.min(bound.maxX - bound.minX + 1, bound.maxY - bound.minY + 1)
      const area = (bound.maxX - bound.minX + 1) * (bound.maxY - bound.minY + 1)
      const code = plan.codeFor[value]
      const cellSize = plan.cellFontPt[value]
      const largeSize = Math.min(
        18,
        span * P * 0.55,
        (span * P * 1.45) / Math.max(1, code.length),
      )
      const size = span >= 3 && bound.count / area >= 0.72 && largeSize >= cellSize * 1.8
        ? largeSize
        : cellSize
      push(
        value,
        code,
        origin.x + ((bound.minX + bound.maxX + 1) / 2) * P,
        origin.y + (sheet.rows - (bound.minY + bound.maxY + 1) / 2) * P,
        size,
        color.hex,
      )
    }
  }

  // Group same-size, same-color text so every value is rendered as a plain fill.
  for (const group of [...groups.values()].sort((a, b) => a.size - b.size)) {
    sink.textBatch(group.items, group.size, group.fill, 'fill')
  }
  return objects
}

/**
 * 一个格子（或大标签）里的文字，两轴都居中。
 *
 * 五个易错点（第 11.2 节）：
 *  1. y 要翻（PDF 原点在左下角，格心也是按左下角算的）
 *  2. 基线在格心下方半个字高，不加这个偏移文字会偏上
 *  3. 水平也要居中：Tm 的 x 是文字起点，不是中心
 *  4. 字号用当次实际的，不能统一常量
 *  5. 文字色按底色亮度算，不能硬编码黑色
 */
function layoutCellText(
  code: string,
  centerX: number,
  centerY: number,
  fontSizePt: number,
): { x: number; y: number; width: number; capHeight: number } {
  const width = fontSizePt * 0.62 * code.length // Helvetica 字符平均宽度，含小格内横向留白
  const capHeight = fontSizePt * 0.72 // 大写字高
  return {
    x: centerX - width / 2,
    y: centerY - capHeight / 2,
    width,
    capHeight,
  }
}
