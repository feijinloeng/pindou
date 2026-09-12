import { EMPTY, isPlaceable, type CellGrid } from '../domain/grid'
import type { BoardGeometry } from '../domain/board'
import { PT_PER_MM } from '../domain/geometry'
import { type Palette, labelTextColor } from '../domain/palette'
import { buildBom, drawBom, hexToRgb } from './bom'
import { planAnnotations, screenLayout, SCREEN_PAD_PT, type AnnotationPlan } from './documentLayout'
import { BOARD_BG } from './colors'
import { gray255, type PdfSink } from './pdf'

/** 网格线颜色（第 7.7 节）：细网格 0.25pt 灰 0.6，主网格 0.5pt 灰 0.75 */
export const THIN_GRID = { widthPt: 0.25, rgb: gray255(0.6) }
export const MAIN_GRID = { widthPt: 0.5, rgb: gray255(0.75) }
/** 板缝红色，页缝蓝色虚线 —— 两者必须一眼能区分 */
export const BOARD_SEAM = { widthPt: 1.5, rgb: [209, 43, 43] as [number, number, number] }
export const SHEET_SEAM = { widthPt: 0.8, rgb: [26, 89, 217] as [number, number, number] }

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

export interface ScreenPdfResult {
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

    // 网格线：细网格每格一条，主网格每 10 格一条（一条 path 一次描边）
    strokeGrid(sink, sheet, margin, P, THIN_GRID, 1)
    strokeGrid(sink, sheet, margin, P, MAIN_GRID, 10)

    // 板缝：红色实线，和页缝明显不同
    strokeBoardSeams(sink, geom, sheet, margin, P)

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
    sink.addPage(595.28, bomPageHeight)
    const rows = buildBom(grid, palette)
    drawBom(sink, rows, {
      x: 40,
      yTop: bomPageHeight - 60,
      width: 515,
      title: `${palette.brand} · ${options.pitchLabel}mm`,
    })
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
  sheet: { cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
  style: { widthPt: number; rgb: readonly [number, number, number] },
  every: number,
): void {
  sink.strokeColor(style.rgb)
  sink.lineWidth(style.widthPt)
  sink.dash([])
  for (let x = 0; x <= sheet.cols; x += every) {
    sink.moveTo(origin.x + x * P, origin.y)
    sink.lineTo(origin.x + x * P, origin.y + sheet.rows * P)
  }
  if (sheet.cols % every !== 0) {
    sink.moveTo(origin.x + sheet.cols * P, origin.y)
    sink.lineTo(origin.x + sheet.cols * P, origin.y + sheet.rows * P)
  }
  for (let y = 0; y <= sheet.rows; y += every) {
    sink.moveTo(origin.x, origin.y + y * P)
    sink.lineTo(origin.x + sheet.cols * P, origin.y + y * P)
  }
  if (sheet.rows % every !== 0) {
    sink.moveTo(origin.x, origin.y + sheet.rows * P)
    sink.lineTo(origin.x + sheet.cols * P, origin.y + sheet.rows * P)
  }
  sink.stroke()
}

export function strokeBoardSeams(
  sink: PdfSink,
  geom: BoardGeometry,
  sheet: { col0: number; row0: number; cols: number; rows: number },
  origin: { x: number; y: number },
  P: number,
): void {
  sink.strokeColor(BOARD_SEAM.rgb)
  sink.lineWidth(BOARD_SEAM.widthPt)
  sink.dash([])
  // 按块画框：板可以错开自由摆放，贯穿线画不准
  let any = false
  for (const board of geom.boards) {
    const c0 = board.c0 - sheet.col0
    const c1 = c0 + board.cw
    if (c1 < 0 || c0 > sheet.cols) continue
    const top = board.r0 - sheet.row0
    const bottom = top + board.rh
    if (bottom < 0 || top > sheet.rows) continue
    const x0 = origin.x + Math.max(0, c0) * P
    const x1 = origin.x + Math.min(sheet.cols, c1) * P
    const yTop = origin.y + (sheet.rows - Math.max(0, top)) * P
    const yBottom = origin.y + (sheet.rows - Math.min(sheet.rows, bottom)) * P
    sink.rect(x0, yBottom, x1 - x0, yTop - yBottom)
    any = true
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
 * 画标注：大标签打在最大内接正方形里，逐格标打在格心。
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
): number {
  let objects = 0
  const groups = new Map<
    string,
    {
      items: Array<{ text: string; x: number; baselineY: number }>
      size: number
      fill: [number, number, number]
      mode: 'fill' | 'fillstroke'
    }
  >()

  const push = (
    code: string,
    centerX: number,
    centerY: number,
    size: number,
    hex: string,
    mode: 'fill' | 'fillstroke',
  ) => {
    const light = labelTextColor(hex) === 'black'
    const fill: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255]
    const rounded = Math.round(size * 100) / 100
    const key = `${rounded}|${fill.join(',')}|${mode}`
    let group = groups.get(key)
    if (!group) {
      group = { items: [], size: rounded, fill, mode }
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
      plan.codeFor[label.colorIndex],
      origin.x + (localCol + label.size / 2) * P,
      origin.y + (sheet.rows - localRow - label.size / 2) * P,
      label.fontSizePt,
      color.hex,
      'fill',
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
        plan.codeFor[value],
        origin.x + (x + 0.5) * P,
        origin.y + (sheet.rows - y - 0.5) * P,
        plan.cellFontPt[value],
        color.hex,
        'fillstroke',
      )
    }
  }

  // 逐格标注要加反色光环，先按组把描边色设好，再一次性出文字
  for (const group of [...groups.values()].sort((a, b) => a.size - b.size)) {
    if (group.mode === 'fillstroke') {
      const light = group.fill[0] === 0
      sink.strokeColor(light ? [255, 255, 255] : [0, 0, 0])
      sink.lineWidth(Math.max(0.15, group.size * 0.12))
    }
    sink.textBatch(group.items, group.size, group.fill, group.mode)
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
export function layoutCellText(
  code: string,
  centerX: number,
  centerY: number,
  fontSizePt: number,
): { x: number; y: number; width: number; capHeight: number } {
  const width = fontSizePt * 0.5 * code.length // Helvetica 平均字宽 ≈ 0.5 em
  const capHeight = fontSizePt * 0.72 // 大写字高
  return {
    x: centerX - width / 2,
    y: centerY - capHeight / 2,
    width,
    capHeight,
  }
}

/** 单条文字（大标签之类）的即时绘制版本 */
export function drawCellText(
  sink: PdfSink,
  code: string,
  centerX: number,
  centerY: number,
  fontSizePt: number,
  cellHex: string,
  mode: 'cell' | 'black',
): void {
  const laid = layoutCellText(code, centerX, centerY, fontSizePt)
  const light = labelTextColor(cellHex) === 'black'
  const fill: [number, number, number] = light ? [0, 0, 0] : [255, 255, 255]
  sink.textColor(fill)
  if (mode === 'cell') {
    sink.strokeColor(light ? [255, 255, 255] : [0, 0, 0])
    sink.lineWidth(Math.max(0.15, fontSizePt * 0.12))
  }
  sink.text(code, laid.x, laid.y, fontSizePt, mode === 'cell' ? 'fillstroke' : 'fill')
}
