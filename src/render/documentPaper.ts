import type { BoardGeometry } from '../domain/board'
import { EMPTY, type CellGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { bomPageCount, bomRowsPerPage, buildBom, drawBom, paletteDisplayLabel, totalBeads } from './bom'
import {
  getPaperScope,
  OVERLAP_CELLS,
  PAPER_HEADER_MM,
  paperLayout,
  planAnnotations,
  type DocumentLayout,
  type PaperPage,
  type PaperOrientation,
  type SheetRange,
} from './documentLayout'
import {
  BOARD_GUIDE,
  BOARD_GUIDE_DASH,
  SHEET_SEAM,
  drawAnnotations,
  drawCells,
  drawCoordinates,
  strokeBoardGuides,
  strokeGrid,
  THIN_GRID,
} from './documentScreen'
import { type PdfSink } from './pdf'

/**
 * 纸面版 1:1 制作文档（第 7、11.3 节）。
 *
 * A4 = 210 × 297mm，不可打印边距 5mm；按整张板阵选择更省页的方向，
 * 每页尽量放满图案，并用 2–3 格重叠带帮助裁切和拼接。
 */
/** 旧调用保留的竖版 A4 尺寸常量；实际纸面导出会按布局自动选择横向或纵向。 */
export const A4_PT = { w: 210 * PT_PER_MM, h: 297 * PT_PER_MM }
/** 100mm 主标尺的长度（pt） */
export const RULER_MM = 100
export const RULER_PT = RULER_MM * PT_PER_MM
/** 针距校验条：20 格豆 */
export const BEAD_STRIP_CELLS = 20

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
  /** 兼容旧调用：这些板会合并成一个外接范围，不会拆成多份 PDF */
  boards?: BoardGeometry['boards']
  /** 附一页中文的打印、裁切和拼接说明；默认开启 */
  instructions?: boolean
  /** 用于说明页标题 */
  projectName?: string
  /** 多页时每页之间调用（用于让底层换页） */
  onNewSheet?: (sheet: SheetRange, pageIndex: number) => void
}

export interface PaperPdfResult {
  layout: DocumentLayout
  /** 每页画了几格（测试与自查用） */
  sheetsDrawn: number
  bomPages: number
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
  const pagePt = {
    w: layout.pageMm.w * PT_PER_MM,
    h: layout.pageMm.h * PT_PER_MM,
  }
  // 本次导出的范围。多个底板只决定外接范围，分页仍然是一张连续的纸样。
  const scope = getPaperScope(grid, options.boards)
  const plan = planAnnotations(grid, palette, options.pitchMm, {
    enabled: layout.drawCodes,
  })

  const pages = layout.pages ?? layout.sheets.map((sheet) => ({
    fragments: [
      {
        range: sheet,
        source: sheet,
        sourceIndex: 0,
        xPt: margin,
        yPt: pagePt.h - margin - PAPER_HEADER_MM * PT_PER_MM - sheet.rows * P,
        cropped: false,
        showLabel: false,
      },
    ],
  }))

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) {
      sink.addPage(pagePt.w, pagePt.h)
      options.onNewSheet?.(page.fragments[0].source, pageIndex)
    }
    drawHeader(
      sink,
      {
        ...options,
        layout,
        plan,
        scope,
        sheet: page.fragments[0].range,
        index: pageIndex,
        P,
        margin,
        pagePt,
        origin: { x: page.fragments[0].xPt, y: page.fragments[0].yPt },
        sourceSheet: page.fragments[0].source,
      },
      page,
      pages.length,
    )
    for (const fragment of page.fragments) {
      drawSheet(sink, {
        ...options,
        layout,
        plan,
        scope,
        sheet: fragment.range,
        sourceSheet: fragment.source,
        fragmentLabel: fragment.showLabel ? `片段 ${fragment.sourceIndex + 1}` : undefined,
        index: pageIndex,
        P,
        margin,
        pagePt,
        origin: { x: fragment.xPt, y: fragment.yPt },
      })
    }
    // 一张物理 A4 只放一套校准尺；片段不能各画一套，否则会挤占剪裁空白。
    if (layout.drawRuler) {
      drawRuler(
        sink,
        {
          ...options,
          layout,
          plan,
          scope,
          sheet: page.fragments[0].range,
          sourceSheet: page.fragments[0].source,
          index: pageIndex,
          P,
          margin,
          pagePt,
          origin: { x: page.fragments[0].xPt, y: page.fragments[0].yPt },
        },
        { x: margin, y: margin },
      )
    }
  })

  let bomPages = 0
  if (layout.includeBom) {
    const rows = buildBom(grid, palette)
    bomPages = bomPageCount(rows.length, pagePt.h)
    const rowsPerPage = bomRowsPerPage(pagePt.h)
    for (let pageIndex = 0; pageIndex < bomPages; pageIndex++) {
      sink.addPage(pagePt.w, pagePt.h)
      const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage)
      const pageLabel = bomPages > 1 ? ` · 第 ${pageIndex + 1}/${bomPages} 页` : ''
      drawBom(sink, pageRows, {
        x: margin,
        yTop: pagePt.h - 60,
        width: pagePt.w - margin * 2,
        title: `${printPaletteLabel(palette)} · ${options.pitchLabel} 毫米 · ${rows.length} 色 · 用量清单${pageLabel}`,
        showSummary: pageIndex === bomPages - 1,
        summary: { total: totalBeads(rows), colors: rows.length },
      })
    }
  }

  if (options.instructions ?? true) {
    sink.addPage(pagePt.w, pagePt.h)
    drawInstructions(sink, {
      projectName: options.projectName,
      sheetCount: pages.length,
      overlap: layout.overlap,
      pitchMm: options.pitchLabel,
      orientation: layout.orientation ?? 'portrait',
      widthMm: (scope.col1 - scope.col0) * options.pitchMm,
      heightMm: (scope.row1 - scope.row0) * options.pitchMm,
    })
  }

  return { layout, sheetsDrawn: layout.sheets.length, bomPages, pages: sink.pageCount() }
}

function printPaletteLabel(palette: Palette): string {
  return paletteDisplayLabel(palette).replace(/\bmm\b/gi, '毫米')
}

interface SheetDrawContext extends PaperPdfOptions {
  layout: DocumentLayout
  plan: ReturnType<typeof planAnnotations>
  /** 本次导出覆盖的范围（全局坐标） */
  scope: { col0: number; row0: number; col1: number; row1: number }
  sheet: SheetRange
  sourceSheet?: SheetRange
  origin: { x: number; y: number }
  fragmentLabel?: string
  index: number
  P: number
  margin: number
  pagePt: { w: number; h: number }
}

function drawSheet(sink: PdfSink, ctx: SheetDrawContext): void {
  const { sheet, P, grid, palette, origin } = ctx

  // 底面
  sink.fillColor([0xfa, 0xfa, 0xf8])
  sink.rect(origin.x, origin.y, sheet.cols * P, sheet.rows * P)
  sink.fill()

  // 豆子（按色分桶）
  drawCells(sink, grid, palette, sheet, origin, P)

  // 10×10 工作区保留灰格，黑色虚线下方的灰线段留空
  strokeGrid(sink, sheet, origin, P, THIN_GRID, 1, ctx.geom)

  // 实体板定位线：黑色 10 格实线 + 5 格虚线十字
  strokeBoardGuides(sink, ctx.geom, sheet, origin, P)
  drawAssemblyGuides(sink, ctx, origin)

  // 坐标数字（全局列号 / 行号）
  drawCoordinates(sink, sheet, origin, P, 10)

  // 色号：纸面版默认打开，保证垫板时每个区域都能找到对应色号
  if (ctx.layout.drawCodes) {
    drawAnnotations(sink, grid, palette, ctx.plan, sheet, origin, P, {
      ensureVisibleCodes: true,
    })
  }

  if (ctx.fragmentLabel) {
    drawCutOutline(sink, origin, sheet.cols * P, sheet.rows * P)
    sink.setFont('cjk')
    sink.fillColor([70, 70, 70])
    sink.text(`${ctx.fragmentLabel}｜沿灰色虚线裁切`, origin.x, origin.y + sheet.rows * P + 11, 5.5, 'fill')
    sink.setFont('latin')
  }
}

/** 稀疏片段的剪裁边界；灰色虚线与红色重叠线区分开，剪刀沿这里走。 */
function drawCutOutline(
  sink: PdfSink,
  origin: { x: number; y: number },
  width: number,
  height: number,
): void {
  sink.strokeColor([135, 135, 135])
  sink.lineWidth(0.65)
  sink.dash([3, 2])
  sink.rect(origin.x, origin.y, width, height)
  sink.stroke()
  sink.dash([])
}

/**
 * 用红色虚线标出纸页关系：
 * - 右 / 下边缘：下一页从这里继续；
 * - 左 / 上边缘：这是本页可裁掉的空白边；
 * - 内侧红线：本页开头的重叠带到这里结束。
 * 两张纸的红线相互对准，比凭纸边猜位置可靠。
 */
function drawAssemblyGuides(
  sink: PdfSink,
  ctx: SheetDrawContext,
  origin: { x: number; y: number },
): void {
  const { sheet, sourceSheet = sheet, P, scope } = ctx
  const overlap = Math.min(ctx.layout.overlap, sheet.cols - 1, sheet.rows - 1)
  const previousCol = sourceSheet.col0 > scope.col0 && sheet.col0 <= sourceSheet.col0
  const previousRow = sourceSheet.row0 > scope.row0 && sheet.row0 <= sourceSheet.row0
  const nextCol =
    sourceSheet.col0 + sourceSheet.cols < scope.col1 &&
    sheet.col0 + sheet.cols >= sourceSheet.col0 + sourceSheet.cols
  const nextRow =
    sourceSheet.row0 + sourceSheet.rows < scope.row1 &&
    sheet.row0 + sheet.rows >= sourceSheet.row0 + sourceSheet.rows
  const height = sheet.rows * P
  const width = sheet.cols * P

  sink.strokeColor(SHEET_SEAM.rgb)
  sink.lineWidth(SHEET_SEAM.widthPt)
  sink.dash([4, 3])

  if (nextCol) {
    sink.moveTo(origin.x + width, origin.y)
    sink.lineTo(origin.x + width, origin.y + height)
    if (overlap > 0) {
      sink.moveTo(origin.x + width - overlap * P, origin.y)
      sink.lineTo(origin.x + width - overlap * P, origin.y + height)
    }
  }
  if (previousCol) {
    // 裁掉本页左侧的空白边，保留从这里开始的重叠内容。
    sink.moveTo(origin.x, origin.y)
    sink.lineTo(origin.x, origin.y + height)
    if (overlap > 0) {
      sink.moveTo(origin.x + overlap * P, origin.y)
      sink.lineTo(origin.x + overlap * P, origin.y + height)
    }
  }
  if (nextRow) {
    sink.moveTo(origin.x, origin.y)
    sink.lineTo(origin.x + width, origin.y)
    if (overlap > 0) {
      sink.moveTo(origin.x, origin.y + overlap * P)
      sink.lineTo(origin.x + width, origin.y + overlap * P)
    }
  }
  if (previousRow) {
    // 本页顶部的重叠行放在上一页底部，顶部空白边可以裁掉。
    sink.moveTo(origin.x, origin.y + height)
    sink.lineTo(origin.x + width, origin.y + height)
    if (overlap > 0) {
      const y = origin.y + (sheet.rows - overlap) * P
      sink.moveTo(origin.x, y)
      sink.lineTo(origin.x + width, y)
    }
  }
  sink.stroke()
  sink.dash([])

  if (overlap > 0 && (previousCol || previousRow || nextCol || nextRow)) {
    drawRegistrationMarks(
      sink,
      origin,
      width,
      height,
      P,
      overlap,
      previousCol,
      previousRow,
      nextCol,
      nextRow,
    )
    sink.setFont('cjk')
    sink.fillColor(SHEET_SEAM.rgb)
    if (previousCol) {
      sink.text(`重叠 ${overlap} 列`, origin.x + overlap * P + 2, origin.y + height + 3, 4.5, 'fill')
    }
    if (previousRow) {
      sink.text(`重叠 ${overlap} 行`, origin.x + 2, origin.y + (sheet.rows - overlap) * P - 2, 4.5, 'fill')
    }
    sink.setFont('latin')
  }
}

function drawRegistrationMarks(
  sink: PdfSink,
  origin: { x: number; y: number },
  width: number,
  height: number,
  P: number,
  overlap: number,
  previousCol: boolean,
  previousRow: boolean,
  nextCol: boolean,
  nextRow: boolean,
): void {
  const arm = Math.min(2.2 * PT_PER_MM, P * 0.72)
  const cross = (x: number, y: number) => {
    sink.moveTo(x - arm / 2, y)
    sink.lineTo(x + arm / 2, y)
    sink.moveTo(x, y - arm / 2)
    sink.lineTo(x, y + arm / 2)
  }

  sink.strokeColor(SHEET_SEAM.rgb)
  sink.lineWidth(0.6)
  if (previousCol) {
    const x = origin.x + (overlap * P) / 2
    for (const ratio of [0.12, 0.5, 0.88]) cross(x, origin.y + height * ratio)
  }
  if (nextCol) {
    const x = origin.x + width - (overlap * P) / 2
    for (const ratio of [0.12, 0.5, 0.88]) cross(x, origin.y + height * ratio)
  }
  if (previousRow) {
    const y = origin.y + height - (overlap * P) / 2
    for (const ratio of [0.12, 0.5, 0.88]) cross(origin.x + width * ratio, y)
  }
  if (nextRow) {
    const y = origin.y + (overlap * P) / 2
    for (const ratio of [0.12, 0.5, 0.88]) cross(origin.x + width * ratio, y)
  }
  sink.stroke()
}

function drawHeader(sink: PdfSink, ctx: SheetDrawContext, page: PaperPage, total: number): void {
  const { pagePt, layout } = ctx
  const direction = layout.orientation === 'landscape' ? '横向' : '纵向'
  const projectName = ctx.projectName?.trim().replace(/\s+/g, ' ').slice(0, 28)
  const title = projectName ? `《${projectName}》· ` : ''
  const header = `${title}打印纸样｜第 ${ctx.index + 1}/${total} 页｜${direction}`
  const fragments = page.fragments
  const range =
    fragments.length === 1
      ? `本页范围：第 ${fragments[0].range.col0 + 1}—${fragments[0].range.col0 + fragments[0].range.cols} 列，第 ${fragments[0].range.row0 + 1}—${fragments[0].range.row0 + fragments[0].range.rows} 行｜每格 ${ctx.pitchLabel} 毫米`
      : `本页含 ${fragments.length} 个纸样片段｜片段号：${fragments.map((fragment) => fragment.sourceIndex + 1).join('、')}｜请按编号剪下、拼接`
  const boards = new Set<number>()
  for (const fragment of fragments) {
    for (const board of ctx.geom.boards) {
      if (
        board.c0 < fragment.source.col0 + fragment.source.cols &&
        board.c0 + board.cw > fragment.source.col0 &&
        board.r0 < fragment.source.row0 + fragment.source.rows &&
        board.r0 + board.rh > fragment.source.row0
      ) {
        boards.add(board.index + 1)
      }
    }
  }
  const boardLine = boards.size > 0 ? `本页底板：${[...boards].join('、')}` : ''
  sink.setFont('cjk')
  sink.fillColor([0, 0, 0])
  sink.text(header, ctx.margin, pagePt.h - 6, 7, 'fill')
  sink.text(range, ctx.margin, pagePt.h - 14.5, 5.5, 'fill')
  if (fragments.length === 1 && fragments[0].showLabel) {
    sink.text(`纸样片段：${fragments[0].sourceIndex + 1}｜请沿灰色虚线裁切`, ctx.margin, pagePt.h - 23, 5, 'fill')
    if (boardLine) sink.text(boardLine, ctx.margin, pagePt.h - 31, 5, 'fill')
  } else if (boardLine) {
    sink.text(boardLine, ctx.margin, pagePt.h - 23, 5, 'fill')
  }
  sink.setFont('latin')
}

/** 页脚校准尺：量 100 毫米比量一格更容易发现打印缩放。 */
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
  sink.setFont('cjk')
  sink.fillColor([0, 0, 0])
  sink.text(
    `${RULER_MM} 毫米校准尺：应量到 ${RULER_MM}.0 毫米，打印请选 100% / 实际大小`,
    origin.x,
    baseY + 7.5,
    4.6,
    'fill',
  )

  // 20 颗豆的针距校验条；5mm 针距在窄边 A4 上放不下时只保留文字提示。
  const stripX = origin.x + RULER_PT + 24
  const stripWidth = BEAD_STRIP_CELLS * P
  const canDrawStrip = stripX + stripWidth <= ctx.pagePt.w - ctx.margin
  if (canDrawStrip) {
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
      `${BEAD_STRIP_CELLS} 颗豆 = ${(BEAD_STRIP_CELLS * pitchMm).toFixed(1)} 毫米`,
      stripX,
      baseY + 7.5,
      4.6,
      'fill',
    )
  } else {
    sink.fillColor([0, 0, 0])
    sink.text(`每颗豆间距 ${pitchMm.toFixed(1)} 毫米`, stripX, baseY + 7.5, 4.6, 'fill')
  }
  sink.setFont('latin')
}

export interface PaperInstructionOptions {
  projectName?: string
  sheetCount?: number
  overlap?: number
  pitchMm?: number
  orientation?: PaperOrientation
  widthMm?: number
  heightMm?: number
}

/** 打印 PDF 最后一页的中文使用说明。 */
export function drawInstructions(sink: PdfSink, options: PaperInstructionOptions = {}): void {
  const direction = options.orientation === 'landscape' ? '横向' : '纵向'
  const projectName = options.projectName?.trim().replace(/\s+/g, ' ').slice(0, 32)
  const title = projectName ? `《${projectName}》打印使用说明` : '打印使用说明'
  const overlap = Math.max(0, options.overlap ?? OVERLAP_CELLS)
  const sheetCount = options.sheetCount ?? 0
  const pitch = options.pitchMm ?? 0
  const overlapHint = overlap === 2 ? '（约两颗豆）' : overlap === 3 ? '（约三颗豆）' : ''
  const size =
    options.widthMm && options.heightMm
      ? `成品外接尺寸约 ${options.widthMm.toFixed(1)} × ${options.heightMm.toFixed(1)} 毫米。`
      : ''

  const lines: Array<{ text: string; size: number; gapAfter?: number }> = [
    { text: title, size: 16, gapAfter: 14 },
    { text: `这份纸样共 ${sheetCount} 页图纸，纸张为 A4，自动采用${direction}。${size}`, size: 9 },
    { text: `每格针距为 ${pitch.toFixed(1)} 毫米；按 1:1 打印后，一格对应一颗豆。`, size: 9, gapAfter: 10 },
    { text: '一、打印设置', size: 11, gapAfter: 4 },
    { text: '1. 打印纸张选择 A4，方向按每页页眉写的“横向”或“纵向”。', size: 9 },
    { text: '2. 缩放选择“100%”或“实际大小”，不要选择“适合页面”“缩放到可打印区域”。', size: 9 },
    { text: '3. 第一页打印后，先用页脚的 100 毫米校准尺测量。必须是 100.0 毫米；不准确就调整打印机缩放。', size: 9, gapAfter: 10 },
    { text: '二、纸页编号和拼接顺序', size: 11, gapAfter: 4 },
    { text: '1. 每页页眉都有“第 X/Y 页”和本页列、行范围。先找第 1 页，再按页码顺序整理。', size: 9 },
    { text: '2. 页码从左到右、从上到下排列：先把同一排的纸横向拼好，再把各排从上到下拼起来。', size: 9 },
    { text: `3. 每次相邻纸页共享 ${overlap} 格${overlapHint}内容。下一页的重叠部分要盖住上一页对应的颜色和格线。`, size: 9 },
    { text: '4. 同一张 A4 上若有多个“纸样片段”，先按片段编号沿灰色虚线剪下，再按页眉的列、行范围定位。', size: 9 },
    { text: '5. 先把红色对位十字和相同颜色格子对齐，再从纸背面贴胶带；不要让重叠区产生错位。', size: 9, gapAfter: 10 },
    { text: '三、红线和裁切线怎么看', size: 11, gapAfter: 4 },
    { text: '1. 红色虚线表示相邻纸页的连接位置，红线围出的部分就是重叠区，不是要删除的图案。', size: 9 },
    { text: '2. 下一页开头的红线要对准上一页末端的红线；红色十字也要上下、左右重合。', size: 9 },
    { text: '3. 只裁掉图案外的空白边，保留重叠区里的颜色、格线和红色对位标记。边缘多出的空白纸，贴好后再裁掉。', size: 9, gapAfter: 10 },
    { text: '四、色号怎么看', size: 11, gapAfter: 4 },
    { text: '1. 大片连续同色区域：中间印一个较大的色号，外围一圈格子逐格印色号，换色时看边界圈。', size: 9 },
    { text: '2. 小片或零散区域：每一格都会印色号。格子太小放不下完整色号时，改印短编号，最后的色用量清单有对应关系。', size: 9 },
    { text: '3. 最后一页是色用量清单，包含色块、色号、名称、色卡值和需要的颗数；按它准备材料。', size: 9, gapAfter: 10 },
    { text: '五、开始拼豆', size: 11, gapAfter: 4 },
    { text: '把拼好的整张纸样垫在透明底板下面，一格对一格，从上到下、从左到右放豆。底板边框和纸样边界对齐后再开始。', size: 9 },
  ]

  sink.setFont('cjk')
  sink.fillColor([0, 0, 0])
  let y = sink.pageHeight - 44
  for (const line of lines) {
    sink.text(line.text, 40, y, line.size, 'fill')
    y -= line.size * 1.45 + (line.gapAfter ?? 0)
  }
  sink.setFont('latin')
}

export { EMPTY, BOARD_GUIDE, BOARD_GUIDE_DASH, SHEET_SEAM }
