import type { BoardGeometry } from '../domain/board'
import { EMPTY, type CellGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { buildBom, drawBom } from './bom'
import {
  paperLayout,
  planAnnotations,
  type DocumentLayout,
  type SheetRange,
} from './documentLayout'
import {
  BOARD_SEAM,
  SHEET_SEAM,
  drawAnnotations,
  drawCells,
  drawCoordinates,
  strokeBoardSeams,
  strokeGrid,
  THIN_GRID,
  MAIN_GRID,
} from './documentScreen'
import { gray255, type PdfSink } from './pdf'

/**
 * 纸面版 1:1 制作文档（第 7、11.3 节）。
 *
 * A4 = 210 × 297mm，不可打印边距 5mm，2.6mm 针距每页 76 × 110 格，重叠带 3 列。
 * 一块 52 板正好 1 张 A4 —— 这是设计上最幸运的数字，"默认按板导出"就是这么来的。
 */
export const A4_PT = { w: 210 * PT_PER_MM, h: 297 * PT_PER_MM }
/** 100mm 主标尺的长度（pt） */
export const RULER_MM = 100
export const RULER_PT = RULER_MM * PT_PER_MM
/** 针距校验条：20 格豆 */
export const BEAD_STRIP_CELLS = 20

const OVERLAP_TINT: [number, number, number] = [0x99, 0xc0, 0xf2]

export interface PaperPdfOptions {
  grid: CellGrid
  palette: Palette
  geom: BoardGeometry
  pitchMm: number
  pitchLabel: number
  marginMm?: number
  overlap?: number
  showCodes?: boolean
  includeBom?: boolean
  /** 只导出这些板；不传就是整图 */
  boards?: BoardGeometry['boards']
  /** 整图导出时附一页英文的拼接说明 */
  instructions?: boolean
  /** 多页时每页之间调用（用于让底层换页） */
  onNewSheet?: (sheet: SheetRange, pageIndex: number) => void
}

export interface PaperPdfResult {
  layout: DocumentLayout
  /** 每页画了几格（测试与自查用） */
  sheetsDrawn: number
  pages: number
}

export function renderPaperPdf(sink: PdfSink, options: PaperPdfOptions): PaperPdfResult {
  const { grid, palette } = options
  const layout = paperLayout(grid, options.pitchMm, {
    marginMm: options.marginMm,
    overlap: options.overlap,
    showCodes: options.showCodes,
    includeBom: options.includeBom,
    boards: options.boards,
  })
  const P = options.pitchMm * PT_PER_MM
  const margin = layout.marginMm * PT_PER_MM
  const plan = planAnnotations(grid, palette, options.pitchMm, {
    enabled: layout.drawCodes,
  })

  layout.sheets.forEach((sheet, index) => {
    if (index > 0) {
      sink.addPage(A4_PT.w, A4_PT.h)
      options.onNewSheet?.(sheet, index)
    }
    drawSheet(sink, {
      ...options,
      layout,
      plan,
      sheet,
      index,
      P,
      margin,
    })
  })

  if (layout.includeBom) {
    sink.addPage(A4_PT.w, A4_PT.h)
    const rows = buildBom(grid, palette)
    drawBom(sink, rows, {
      x: margin,
      yTop: A4_PT.h - 60,
      width: A4_PT.w - margin * 2,
      title: `${palette.brand} ${palette.displayName} · ${options.pitchLabel}mm · ${rows.length} colors`,
    })
  }

  if (options.instructions) {
    sink.addPage(A4_PT.w, A4_PT.h)
    drawInstructions(sink)
  }

  return { layout, sheetsDrawn: layout.sheets.length, pages: sink.pageCount() }
}

interface SheetDrawContext extends PaperPdfOptions {
  layout: DocumentLayout
  plan: ReturnType<typeof planAnnotations>
  sheet: SheetRange
  index: number
  P: number
  margin: number
}

function drawSheet(sink: PdfSink, ctx: SheetDrawContext): void {
  const { sheet, P, margin, grid, palette } = ctx
  // ⚠️ 网格锚在【上边距】上：第 7.3 节的公式是 cellRect.y = PAGE_H - MARGIN - (r+1)*P，
  //    也就是第 0 行贴着上边距，剩下的空边留在下方。锚在下方会把图案挪到纸的下半张。
  const origin = { x: margin, y: A4_PT.h - margin - sheet.rows * P }
  const total = ctx.layout.sheets.length

  // 重叠带底色（浅蓝 30%）——第 2 页起才有
  if (sheet.col0 > 0 && ctx.layout.overlap > 0) {
    sink.opacity(0.3)
    sink.fillColor(OVERLAP_TINT)
    sink.rect(origin.x, origin.y, ctx.layout.overlap * P, sheet.rows * P)
    sink.fill()
    sink.opacity(1)
  }

  // 底面
  sink.fillColor([0xfa, 0xfa, 0xf8])
  sink.rect(origin.x, origin.y, sheet.cols * P, sheet.rows * P)
  sink.fill()

  // 豆子（按色分桶）
  drawCells(sink, grid, palette, sheet, origin, P)

  // 网格：细网格每格，主网格每 10 格
  strokeGrid(sink, sheet, origin, P, THIN_GRID, 1)
  strokeGrid(sink, sheet, origin, P, MAIN_GRID, 10)

  // 板缝（红色）与页缝（蓝色虚线）必须一眼能区分
  strokeBoardSeams(sink, ctx.geom, sheet, origin, P)
  strokeSheetSeams(sink, ctx, origin)

  // 坐标数字（全局列号 / 行号）
  drawCoordinates(sink, sheet, origin, P, 10)

  // 色号（默认关）
  if (ctx.layout.drawCodes) {
    drawAnnotations(sink, grid, palette, ctx.plan, sheet, origin, P)
  }

  // 每块板左上角标一句"板 rXcY"
  drawBoardLabels(sink, ctx, origin)

  // 页眉
  drawHeader(sink, ctx, total)

  // 页脚校准尺 + 20 豆校验条
  if (ctx.layout.drawRuler) drawRuler(sink, ctx, origin)

  // 裁切线 + 对位十字
  if (sheet.col0 > 0) drawCropLineAndMarks(sink, ctx, origin)
}

/** 页缝：只在"右边还有内容"或"下边还有内容"的那条边上画蓝色虚线 */
function strokeSheetSeams(
  sink: PdfSink,
  ctx: SheetDrawContext,
  origin: { x: number; y: number },
): void {
  const { sheet, P, grid } = ctx
  const moreToRight = sheet.col0 + sheet.cols < grid.cols
  const moreBelow = sheet.row0 + sheet.rows < grid.rows
  sink.strokeColor(SHEET_SEAM.rgb)
  sink.lineWidth(SHEET_SEAM.widthPt)
  sink.dash([4, 3])
  if (moreToRight) {
    sink.moveTo(origin.x + sheet.cols * P, origin.y)
    sink.lineTo(origin.x + sheet.cols * P, origin.y + sheet.rows * P)
  }
  if (moreBelow) {
    sink.moveTo(origin.x, origin.y)
    sink.lineTo(origin.x + sheet.cols * P, origin.y)
  }
  sink.stroke()
  sink.dash([])
}

function drawHeader(sink: PdfSink, ctx: SheetDrawContext, total: number): void {
  const { sheet, P, grid } = ctx
  const board = findBoard(ctx.geom, sheet)
  // 页眉只印拉丁字符（第 11.4 节：v1 全程避开中文，保住矢量性）
  const header = board
    ? `Board r${board.row + 1}c${board.col + 1} ${board.board} | Page ${ctx.index + 1}/${total} | cols ${sheet.col0}-${sheet.col0 + sheet.cols - 1} rows ${sheet.row0}-${sheet.row0 + sheet.rows - 1}`
    : `Page ${ctx.index + 1}/${total} | cols ${sheet.col0}-${sheet.col0 + sheet.cols - 1} rows ${sheet.row0}-${sheet.row0 + sheet.rows - 1}`
  sink.fillColor([0, 0, 0])
  sink.text(header, ctx.margin, A4_PT.h - 6, 7, 'fill')
  sink.text(
    `${grid.cols}x${grid.rows} cells | pitch ${ctx.pitchLabel}mm | pitch field ${(ctx.grid.cols * ctx.pitchMm).toFixed(1)}x${(ctx.grid.rows * ctx.pitchMm).toFixed(1)}mm`,
    ctx.margin,
    A4_PT.h - 14.5,
    5.5,
    'fill',
  )
  void P
}

/** 每块板的左上角写一句板号，拼的时候知道自己在拼哪块 */
function drawBoardLabels(sink: PdfSink, ctx: SheetDrawContext, origin: { x: number; y: number }): void {
  const { sheet, P } = ctx
  sink.fillColor(gray255(0.35))
  for (const board of ctx.geom.boards) {
    const localCol = board.c0 - sheet.col0
    const localRow = board.r0 - sheet.row0
    if (localCol < 0 || localRow < 0) continue
    if (localCol >= sheet.cols || localRow >= sheet.rows) continue
    sink.text(
      `r${board.row + 1}c${board.col + 1}`,
      origin.x + localCol * P + 1.5,
      origin.y + (sheet.rows - localRow) * P - 5,
      4.5,
      'fill',
    )
  }
}

/**
 * 页脚校准尺（第 7.6 节）：
 *  1. 100mm 主标尺，每 10mm 一个刻度，50mm 加长，标 "100 mm"
 *  2. 20 格豆的针距校验条，标 "20 beads = 52.0 mm"
 * 比只印一个 10mm 方块准 10 倍：量 100mm 的误差是 ±0.5mm（0.5%），够发现打印机缩放 1%。
 */
function drawRuler(
  sink: PdfSink,
  ctx: SheetDrawContext,
  origin: { x: number; y: number },
): void {
  const { P, pitchMm } = ctx
  // 固定放在下边距里：不论这一页用了多少行，量尺的位置都一样，方便对照
  const baseY = Math.max(4, ctx.margin - 9)
  const tickTop = baseY + 4

  sink.strokeColor([0, 0, 0])
  sink.lineWidth(0.6)
  sink.dash([])
  sink.moveTo(origin.x, baseY)
  sink.lineTo(origin.x + RULER_PT, baseY)
  sink.stroke()
  for (let mm = 0; mm <= RULER_MM; mm += 10) {
    const long = mm % 50 === 0
    const x = origin.x + mm * PT_PER_MM
    sink.moveTo(x, baseY)
    sink.lineTo(x, long ? tickTop + 1.4 : tickTop)
    if (long) {
      sink.fillColor([0, 0, 0])
      sink.text(String(mm), x + 0.6, baseY - 0.8, 3.6, 'fill')
    }
  }
  sink.stroke()
  sink.fillColor([0, 0, 0])
  sink.text(
    `${RULER_MM} mm - measure this. Print at 100% / actual size, turn OFF "fit to page".`,
    origin.x,
    baseY + 7.5,
    4.6,
    'fill',
  )

  // 20 豆校验条
  const stripX = origin.x + RULER_PT + 24
  const stripWidth = BEAD_STRIP_CELLS * P
  sink.lineWidth(0.6)
  sink.moveTo(stripX, baseY)
  sink.lineTo(stripX + stripWidth, baseY)
  sink.stroke()
  for (let cell = 0; cell <= BEAD_STRIP_CELLS; cell++) {
    const x = stripX + cell * P
    sink.moveTo(x, baseY)
    sink.lineTo(x, tickTop)
  }
  sink.stroke()
  sink.fillColor([0, 0, 0])
  sink.text(
    `${BEAD_STRIP_CELLS} beads = ${(BEAD_STRIP_CELLS * pitchMm).toFixed(1)} mm`,
    stripX,
    baseY + 7.5,
    4.6,
    'fill',
  )
}

/**
 * 裁切线 + 对位十字（第 7.7 节）。
 * 裁切线在第 2 页起的左边距上：裁掉空白边距，让纸边正好落在上一页的重叠带上。
 * 对位十字在重叠带里：上、中、下各一个，臂长 3mm。
 */
function drawCropLineAndMarks(
  sink: PdfSink,
  ctx: SheetDrawContext,
  origin: { x: number; y: number },
): void {
  const { sheet, P } = ctx
  const height = sheet.rows * P
  const arm = 3 * PT_PER_MM
  const bandWidth = ctx.layout.overlap * P

  sink.strokeColor(SHEET_SEAM.rgb)
  sink.lineWidth(0.5)
  sink.dash([3, 2])
  sink.moveTo(origin.x, origin.y)
  sink.lineTo(origin.x, origin.y + height)
  sink.stroke()
  sink.dash([])
  sink.fillColor([0, 0, 0])
  sink.text('CUT HERE', origin.x + 1.5, origin.y + height - 8, 4.6, 'fill')

  // 对位十字：三个，落在重叠带中央
  const cx = origin.x + bandWidth / 2
  const ys = [origin.y + height * 0.06, origin.y + height * 0.5, origin.y + height * 0.94]
  sink.strokeColor([0, 0, 0])
  sink.lineWidth(0.5)
  for (const cy of ys) {
    sink.moveTo(cx - arm / 2, cy)
    sink.lineTo(cx + arm / 2, cy)
    sink.moveTo(cx, cy - arm / 2)
    sink.lineTo(cx, cy + arm / 2)
  }
  sink.stroke()
}

/** 找出这一页覆盖的是哪块板（按它的起点落在页内判定） */
function findBoard(geom: BoardGeometry, sheet: SheetRange) {
  return geom.boards.find(
    (board) =>
      board.c0 >= sheet.col0 &&
      board.c0 < sheet.col0 + sheet.cols &&
      board.r0 >= sheet.row0 &&
      board.r0 < sheet.row0 + sheet.rows,
  )
}

/**
 * 拼接说明页（第 7.5 节）。v1 的 PDF 里只能写拉丁字符，
 * 中文的操作说明在导出面板里给用户看。
 */
export function drawInstructions(sink: PdfSink): void {
  const lines = [
    'HOW TO PRINT AND TAPE THE PAGES TOGETHER',
    '',
    '1. Print at 100% / Actual size. Turn OFF every "fit to page" / "scale to fit" option.',
    '2. Print page 1 first. Measure the 100 mm ruler at the bottom of the page.',
    '   It must be exactly 100.0 mm. If not, the printer is scaling: fix the settings',
    '   or use another printer.',
    '3. For page 2 and later: cut off the left blank margin along the dashed "CUT HERE" line.',
    '4. Put the left edge of page k+1 on top of the right part of page k, so the columns',
    '   shared by both pages overlap. Matching colors is the best alignment guide.',
    '5. Check the registration crosses in the overlap band: all crosses must line up',
    '   with the pixels underneath.',
    '6. Tape the pages. Trim the excess paper on the right side of page k.',
    '',
    'WHY OVERLAP INSTEAD OF BUTT-JOINING:',
    'Cutting paper by hand gives about +/-0.5 mm error. Over 176 pages that becomes 8 mm',
    '(3 beads). The overlap band makes every page align to what the previous page',
    'ACTUALLY printed, not to an ideal position. So the error never accumulates.',
    '',
    'COLOR CODES:',
    'Big regions are labelled once in the middle with the bead code, and every cell on the',
    'boundary is labelled cell by cell, so you know exactly where to switch color.',
    'When a code does not fit inside a cell, a 1-2 digit number is printed instead and the',
    'bill of materials page maps numbers back to codes.',
  ]
  sink.fillColor([0, 0, 0])
  let y = A4_PT.h - 60
  sink.text(lines[0], 40, y, 12, 'fill')
  y -= 8
  for (const line of lines.slice(1)) {
    sink.text(line, 40, y, line === '' ? 6 : 8.5, 'fill')
    y -= line === '' ? 6 : 11
  }
}

export { EMPTY, BOARD_SEAM, SHEET_SEAM }
