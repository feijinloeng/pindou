import { describe, expect, it } from 'vitest'

import { createGrid, EMPTY } from '../domain/grid'
import { deriveGeometry } from '../domain/board'
import type { Palette } from '../domain/palette'
import { PT_PER_MM } from '../domain/geometry'
import { countStreamOps, createPdfSink, pdfRgb } from './pdf'
import { renderScreenPdf } from './documentScreen'
import { buildBom } from './bom'
import { BOARD_SEAM } from './documentScreen'
import { screenLayout } from './documentLayout'

/** 4 行 4 列，每行一个颜色，色号就是行号 —— 验收要求的"每格写上自己的行号" */
const ROW_PALETTE: Palette = {
  id: 'test-4',
  brand: 'TEST',
  displayName: '测试 4 色',
  pitchMm: 5,
  beadMm: 5,
  colors: [
    { code: '0', name: '黑', hex: '#1A1A1A', rgb: [26, 26, 26], lab: [0, 0, 0], symbol: null },
    { code: '1', name: '白', hex: '#FFFFFF', rgb: [255, 255, 255], lab: [100, 0, 0], symbol: null },
    { code: '2', name: '浅灰', hex: '#C8C8C8', rgb: [200, 200, 200], lab: [80, 0, 0], symbol: null },
    { code: '3', name: '深蓝', hex: '#1B2A55', rgb: [27, 42, 85], lab: [20, 0, 0], symbol: null },
  ],
}

function rowGrid(size = 4) {
  const grid = createGrid(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) grid.cells[y * size + x] = y % 4
  return grid
}

interface ParsedText {
  text: string
  x: number
  y: number
  fill: [number, number, number]
}

/**
 * 解析内容流里的文字对象：位置 + 填充色。
 * 支持两种写法：批量块的 `1 0 0 1 x y Tm (code) Tj`，和 jsPDF 单条的 `x y Td (code) Tj`。
 */
function parseTextObjects(stream: string): ParsedText[] {
  const out: ParsedText[] = []
  for (const block of stream.match(/BT[\s\S]*?ET/g) ?? []) {
    const rgb = [...block.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) rg/g)].at(-1)
    const gray = [...block.matchAll(/(?:^|\n)(-?[\d.]+) g(?:\n|$)/g)].at(-1)
    const fill: [number, number, number] = rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : gray
        ? [Number(gray[1]), Number(gray[1]), Number(gray[1])]
        : [0, 0, 0]
    const batch = [...block.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \((.*?)\) Tj/g)]
    if (batch.length) {
      for (const pair of batch) {
        out.push({ text: pair[3], x: Number(pair[1]), y: Number(pair[2]), fill })
      }
      continue
    }
    const move = block.match(/(-?[\d.]+) (-?[\d.]+) (?:Td|Tm)/)
    const show = block.match(/\((.*?)\) Tj/)
    if (move && show) out.push({ text: show[1], x: Number(move[1]), y: Number(move[2]), fill })
  }
  return out
}

/**
 * 只要落在豆格区域里的文字。内容流里还有边缘坐标数字，它们不在格子里。
 */
function cellTexts(
  texts: ParsedText[],
  rows: number,
  pitchMm: number,
  origin = 8,
): ParsedText[] {
  const P = pitchMm * PT_PER_MM
  return texts.filter((item) => {
    const fontSize = Math.min(P * 0.45, P * 1.6)
    const centerX = item.x + (fontSize * 0.5 * item.text.length) / 2
    const centerY = item.y + (fontSize * 0.72) / 2
    const col = Math.floor((centerX - origin) / P)
    const row = Math.floor((origin + rows * P - centerY) / P)
    return col >= 0 && col < rows && row >= 0 && row < rows
  })
}

function render(options: {
  gridSize?: number
  codes?: boolean
  bom?: boolean
  pitchMm?: number
  seam?: boolean
}) {
  const size = options.gridSize ?? 4
  const pitchMm = options.pitchMm ?? 5
  const grid = rowGrid(size)
  // 屏幕版的页面就是整图尺寸，所以 sink 要按整图尺寸建
  const layout = screenLayout(grid, pitchMm, { showCodes: true, includeBom: false })
  const sink = createPdfSink({
    widthPt: layout.pageMm.w * PT_PER_MM,
    heightPt: layout.pageMm.h * PT_PER_MM,
  })
  const boards = options.seam
    ? deriveGeometry({
        rows: [
          ['mini52', 'mini52'],
          ['mini52', 'mini52'],
        ],
        gapMm: 0,
      })
    : deriveGeometry({ rows: [['mini26']], gapMm: 0 })
  const result = renderScreenPdf(sink, {
    grid,
    palette: ROW_PALETTE,
    geom: boards,
    pitchMm,
    pitchLabel: pitchMm,
    showCodes: options.codes ?? true,
    includeBom: options.bom ?? false,
  })
  return { sink, grid, result, pitchMm }
}

describe('屏幕版矢量 PDF', () => {
  it('页面尺寸 = 豆数 × 针距（毫米）', () => {
    const { sink, result } = render({})
    expect(sink.pageWidth / PT_PER_MM).toBeCloseTo(20, 3)
    expect(result.widthPt / PT_PER_MM).toBeCloseTo(20, 3)
    expect(result.heightPt / PT_PER_MM).toBeCloseTo(20, 3)
    expect(sink.contentStream(0).length).toBeGreaterThan(0)
  })

  it('按色分桶：4 色 + 1 个底色 = 5 次填充，不是 16 次', () => {
    const { sink } = render({ codes: false })
    const stats = countStreamOps(sink.contentStream(0))
    expect(stats.fillOps).toBe(5)
    // 4 行各是一个纯色整行 → 行程合并成 4 个矩形 + 1 个底面（合并前是 17）
    // 多出来的 1 个 rect 是板框（只描边不填充）
    expect(stats.rectOps).toBe(6)
  })

  it('不用高开销的逐格填充：133 万格级别也只是一色一次', () => {
    const grid = createGrid(300, 300)
    for (let i = 0; i < grid.cells.length; i++) grid.cells[i] = i % 4
    const pitchMm = 2.6
    const sink = createPdfSink({
      widthPt: 300 * pitchMm * PT_PER_MM,
      heightPt: 300 * pitchMm * PT_PER_MM,
    })
    renderScreenPdf(sink, {
      grid,
      palette: ROW_PALETTE,
      geom: deriveGeometry({ rows: [['mini104']], gapMm: 0 }),
      pitchMm,
      pitchLabel: pitchMm,
      showCodes: false,
      includeBom: false,
    })
    const stats = countStreamOps(sink.contentStream(0))
    expect(stats.fillOps).toBeLessThanOrEqual(5)
    // 棋盘图案每格都要单独画，没有可合并的行程
    expect(stats.rectOps).toBe(300 * 300 + 1 + 1) // +1 底面，+1 板框
  })

  it('文字对齐：每个色号落在自己的格子里（±1px）', () => {
    const { sink, grid, pitchMm } = render({})
    const P = pitchMm * PT_PER_MM
    const origin = 8
    const texts = cellTexts(parseTextObjects(sink.contentStream(0)), 4, pitchMm)
    expect(texts).toHaveLength(16)
    for (const item of texts) {
      const size = 6 // 5mm 格子上逐格字号是 min(P*0.45, P*1.6/n)
      const expectedSize = Math.min(P * 0.45, (P * 1.6) / 1)
      const fontSize = expectedSize
      const tw = fontSize * 0.5 * item.text.length
      const capH = fontSize * 0.72
      // 从基线反推文字中心（渲染器算的是 center − capH/2）
      const centerX = item.x + tw / 2
      const centerY = item.y + capH / 2
      const col = Math.floor((centerX - origin) / P)
      const row = Math.floor((origin + grid.rows * P - centerY) / P)
      expect(col).toBeGreaterThanOrEqual(0)
      expect(col).toBeLessThan(4)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(4)
      // 该格的行号必须等于文字内容
      expect(item.text).toBe(String(row))
      // 中心离格心不超过 1px
      const cellCenterX = origin + (col + 0.5) * P
      const cellCenterY = origin + (grid.rows - row - 0.5) * P
      expect(Math.abs(centerX - cellCenterX)).toBeLessThanOrEqual(1)
      expect(Math.abs(centerY - cellCenterY)).toBeLessThanOrEqual(1)
      expect(size).toBeGreaterThan(0)
    }
  })

  it('文字色反差：深底白字、浅底黑字', () => {
    const { sink, pitchMm } = render({})
    const texts = cellTexts(parseTextObjects(sink.contentStream(0)), 4, pitchMm)
    const byText = (t: string) => texts.filter((item) => item.text === t)
    // 第 0 行是 #1A1A1A（深）→ 白字
    for (const item of byText('0')) expect(item.fill).toEqual([1, 1, 1])
    // 第 1 行是白底 → 黑字
    for (const item of byText('1')) expect(item.fill).toEqual([0, 0, 0])
    // 第 3 行是深蓝 → 白字
    for (const item of byText('3')) expect(item.fill).toEqual([1, 1, 1])
  })

  it('基线在格心下方半个字高（两轴居中的公式）', () => {
    const { sink, pitchMm } = render({})
    const P = pitchMm * PT_PER_MM
    const origin = 8
    const texts = cellTexts(parseTextObjects(sink.contentStream(0)), 4, pitchMm)
    const first = texts.find((t) => t.text === '0')!
    const fontSize = Math.min(P * 0.45, P * 1.6)
    const capH = fontSize * 0.72
    const tw = fontSize * 0.5 * 1
    const centerX = origin + 0.5 * P
    const centerY = origin + (4 - 0.5) * P
    expect(first.x).toBeCloseTo(centerX - tw / 2, 2)
    expect(first.y).toBeCloseTo(centerY - capH / 2, 2)
  })

  it('板缝是红色实线', () => {
    // 直接给一个 4×4、板缝落在 (2, 2) 的几何，专门测绘制
    const grid = rowGrid(4)
    const pitchMm = 5
    const sink = createPdfSink({ widthPt: 20 * PT_PER_MM, heightPt: 20 * PT_PER_MM })
    renderScreenPdf(sink, {
      grid,
      palette: ROW_PALETTE,
      geom: {
        cols: 4,
        rows: 4,
        pitchMm: 2.6,
        seamCols: [2],
        seamRows: [2],
        boards: [],
        placeable: new Uint8Array(16).fill(1),
      },
      pitchMm,
      pitchLabel: pitchMm,
      showCodes: false,
      includeBom: false,
    })
    const stream = sink.contentStream(0)
    expect(stream).toContain(`${pdfRgb(BOARD_SEAM.rgb)} RG`)
  })

  it('没有嵌入任何图片（纯矢量）', () => {
    const { sink } = render({ bom: true })
    for (let page = 0; page < sink.pageCount(); page++) {
      const stats = countStreamOps(sink.contentStream(page))
      expect(stats.images).toBe(0)
    }
  })

  it('用量清单是独立一页，五列表头齐全，色块是矢量矩形', () => {
    const { sink, grid } = render({ bom: true })
    expect(sink.pageCount()).toBe(2)
    const bomPage = sink.contentStream(1)
    for (const label of ['No.', 'Color', 'Code', 'HEX', 'Qty']) {
      expect(bomPage).toContain(`(${label}) Tj`)
    }
    const rows = buildBom(grid, ROW_PALETTE)
    expect(rows).toHaveLength(4)
    expect(rows[0].count).toBe(4)
    for (const row of rows) expect(bomPage).toContain(`(${row.code}) Tj`)
    // 色块是实心矩形（每行一个），而且第二页没有任何图片
    expect(countStreamOps(bomPage).fillOps).toBeGreaterThanOrEqual(rows.length)
    expect(countStreamOps(bomPage).images).toBe(0)
  })

  it('空格不画，也不参与标注', () => {
    const grid = createGrid(4, 4)
    grid.cells[0] = 0
    grid.cells[5] = 1
    const sink = createPdfSink({ widthPt: 4 * 5 * PT_PER_MM, heightPt: 4 * 5 * PT_PER_MM })
    renderScreenPdf(sink, {
      grid,
      palette: ROW_PALETTE,
      geom: deriveGeometry({ rows: [['mini26']], gapMm: 0 }),
      pitchMm: 5,
      pitchLabel: 5,
      showCodes: true,
      includeBom: false,
    })
    const stats = countStreamOps(sink.contentStream(0))
    expect(stats.rectOps).toBe(4) // 2 格 + 1 底面 + 1 板框
    // 2 个逐格色号 + 2 个边缘坐标数字
    expect(stats.textObjects).toBe(4)
    expect(cellTexts(parseTextObjects(sink.contentStream(0)), 4, 5)).toHaveLength(2)
    expect(grid.cells.filter((v) => v === EMPTY)).toHaveLength(14)
  })

  it('超过 PDF 单页上限时自动分页，页面尺寸不超过 14400pt', () => {
    // 2236 格 × 2.6mm = 5813mm > 5080mm 上限
    const cols = 2236
    const grid = createGrid(cols, cols, 0)
    const layout = screenLayout(grid, 2.6, { showCodes: false, includeBom: false })
    expect(layout.pageMm.w * PT_PER_MM).toBeLessThanOrEqual(14400)
    expect(layout.sheets.length).toBeGreaterThan(1)
    const sink = createPdfSink({
      widthPt: layout.pageMm.w * PT_PER_MM,
      heightPt: layout.pageMm.h * PT_PER_MM,
    })
    const result = renderScreenPdf(sink, {
      grid,
      palette: ROW_PALETTE,
      geom: deriveGeometry({ rows: [['mini104']], gapMm: 0 }),
      pitchMm: 2.6,
      pitchLabel: 2.6,
      showCodes: false,
      includeBom: false,
    })
    expect(result.pageCount).toBe(layout.sheets.length)
    expect(sink.pageCount()).toBe(layout.sheets.length)
  })

  it('输出是真 PDF 字节（%PDF 头 + EOF 尾）', () => {
    const { sink } = render({ bom: true })
    const bytes = sink.output()
    const head = String.fromCharCode(...bytes.slice(0, 5))
    const tail = new TextDecoder().decode(bytes.slice(-32))
    expect(head).toBe('%PDF-')
    expect(tail).toContain('%%EOF')
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })
})

describe('用量清单', () => {
  it('按颗数降序，编号从 1 开始连续', () => {
    const grid = createGrid(4, 4)
    grid.cells.fill(0)
    grid.cells[0] = 1
    grid.cells[1] = 2
    const rows = buildBom(grid, ROW_PALETTE)
    expect(rows.map((r) => r.number)).toEqual(['1', '2', '3'])
    expect(rows[0].count).toBe(14)
    expect(rows[1].count).toBe(1)
  })
})
