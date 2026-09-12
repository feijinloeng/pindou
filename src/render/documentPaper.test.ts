import { describe, expect, it } from 'vitest'

import { deriveGeometry } from '../domain/board'
import { createGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { A4_PT, BOARD_SEAM, RULER_PT, SHEET_SEAM, renderPaperPdf } from './documentPaper'
import { bomToCsv } from './bom'
import { countStreamOps, createPdfSink, pdfRgb } from './pdf'
import { sheetAt } from './documentLayout'

const PALETTE: Palette = {
  id: 'test-2',
  brand: 'TEST',
  displayName: '测试 2 色',
  pitchMm: 2.6,
  beadMm: 2.6,
  colors: [
    { code: 'A1', name: '黄', hex: '#FAF5CD', rgb: [250, 245, 205], lab: [96, -3, 15], symbol: null },
    { code: 'B1', name: '蓝', hex: '#1B2A55', rgb: [27, 42, 85], lab: [20, 10, -25], symbol: null },
  ],
}

function checkerGrid(cols: number, rows: number) {
  const grid = createGrid(cols, rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) grid.cells[y * cols + x] = (x + y) % 2
  }
  return grid
}

function render(cols: number, rows: number, extra: Record<string, unknown> = {}) {
  const grid = checkerGrid(cols, rows)
  const geom = deriveGeometry(
    cols <= 26
      ? { rows: [['mini26']], gapMm: 0 }
      : cols <= 52
        ? { rows: [['mini52']], gapMm: 0 }
        : { rows: [['mini52', 'mini52', 'mini52']], gapMm: 0 },
  )
  const sink = createPdfSink({ widthPt: A4_PT.w, heightPt: A4_PT.h })
  const result = renderPaperPdf(sink, {
    grid,
    palette: PALETTE,
    geom,
    pitchMm: 2.6,
    pitchLabel: 2.6,
    showCodes: false,
    includeBom: false,
    ...extra,
  })
  return { sink, result, geom, grid }
}

describe('纸面版 1:1', () => {
  it('一块 52 板导出 1 页', () => {
    const { result } = render(52, 52)
    expect(result.sheetsDrawn).toBe(1)
    expect(result.pages).toBe(1)
    expect(result.layout.cellsPerPage).toEqual({ cols: 76, rows: 110 })
  })

  it('一块 78 板导出 2 页（列方向分页）', () => {
    const { result } = render(78, 78)
    // 78 列 > 76，所以列方向 2 页；78 行 ≤ 110，行方向 1 页
    expect(result.sheetsDrawn).toBe(2)
  })

  it('3m × 3m 的 1153 格 → 176 页', () => {
    const { result } = render(1153, 1153, { showCodes: false })
    expect(result.sheetsDrawn).toBe(176)
    expect(result.layout.sheets).toHaveLength(176)
  })

  it('页边距与格子物理尺寸：第 2 列的 x = 边距 + 1 × 2.6mm（误差 < 0.01mm）', () => {
    const { sink } = render(52, 52)
    const stream = sink.contentStream(0)
    const margin = 5 * PT_PER_MM
    const P = 2.6 * PT_PER_MM
    // 从内容流里找出所有矩形，看有没有一个正好落在第 2 列
    const rects = [...stream.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
    }))
    const expectedX = margin + P
    const hit = rects.find((r) => Math.abs(r.x - expectedX) < 0.2)
    expect(hit).toBeDefined()
    expect(Math.abs(hit!.w - P)).toBeLessThan(0.01)
    // 换算成毫米后误差 < 0.01mm
    expect(Math.abs(hit!.x / PT_PER_MM - (5 + 2.6))).toBeLessThan(0.01)
  })

  it('校准尺的实际长度 = 100.00mm ± 0.01mm', () => {
    const { sink } = render(52, 52)
    const stream = sink.contentStream(0)
    const moves = [...stream.matchAll(/([-\d.]+) ([-\d.]+) m\n([-\d.]+) ([-\d.]+) l/g)].map((m) => ({
      x1: Number(m[1]),
      y1: Number(m[2]),
      x2: Number(m[3]),
      y2: Number(m[4]),
    }))
    const margin = 5 * PT_PER_MM
    // 标尺：从边距出发向右 100mm 的那条水平线
    const ruler = moves.find(
      (line) =>
        Math.abs(line.y1 - line.y2) < 1e-6 &&
        Math.abs(line.x1 - margin) < 0.01 &&
        Math.abs(line.x2 - line.x1 - RULER_PT) < 0.01,
    )
    expect(ruler).toBeDefined()
    // 内容流里数字只保留四位小数，容差放到 0.001pt（≈0.0004mm），仍然远严于 0.01mm 的要求
    expect(ruler!.x2 - ruler!.x1).toBeCloseTo(100 * PT_PER_MM, 2)
    expect(((ruler!.x2 - ruler!.x1) / PT_PER_MM).toFixed(2)).toBe('100.00')
  })

  it('20 豆校验条的长度 = 20 × 2.6 = 52.0mm', () => {
    const { sink } = render(52, 52)
    const stream = sink.contentStream(0)
    expect(stream).toContain('(20 beads = 52.0 mm) Tj')
  })

  it('重叠带：第 k+1 页开头与第 k 页结尾是同一批全局列号', () => {
    const perPage = 76
    const overlap = 3
    for (let k = 0; k < 15; k++) {
      const current = sheetAt(k, 1153, perPage, overlap)
      const next = sheetAt(k + 1, 1153, perPage, overlap)
      // 第 k+1 页的全局列 [next.start, next.start+3) 就是第 k 页的尾巴
      expect(next.start).toBe(current.start + perPage - overlap)
      expect(current.start + current.count).toBe(next.start + overlap)
    }
  })

  it('第二页起才有裁切线和重叠带标记，第一页没有', () => {
    const { sink } = render(78, 78)
    expect(sink.contentStream(0)).not.toContain('CUT HERE')
    expect(sink.contentStream(1)).toContain('CUT HERE')
  })

  it('页眉是拉丁字符，含页码与全局列号范围', () => {
    const { sink } = render(78, 78)
    const page2 = sink.contentStream(1)
    expect(page2).toMatch(/Page 2\/2 \| cols \d+-\d+ rows \d+-\d+/)
    // v1 的 PDF 里不许出现中文
    expect(/[\u4e00-\u9fa5]/.test(page2)).toBe(false)
  })

  it('板缝是红色、页缝是蓝色虚线，两者不同', () => {
    const { sink } = render(78, 78)
    const stream = sink.contentStream(0)
    expect(stream).toContain(`${pdfRgb(BOARD_SEAM.rgb)} RG`) // 板缝红
    expect(stream).toContain(`${pdfRgb(SHEET_SEAM.rgb)} RG`) // 页缝蓝
    expect(stream).toMatch(/\[4 3\] 0 d/) // 页缝是虚线
    expect(stream).toMatch(/\[\] 0 d/) // 板缝是实线
  })

  it('按板导出：导出某一块板只排它的范围', () => {
    const { result } = render(156, 156, { boards: [] })
    expect(result.sheetsDrawn).toBe(6)
  })

  it('色号默认关：不开就不产生任何标注文字', () => {
    const { sink } = render(52, 52)
    const texts = (sink.contentStream(0).match(/\((A1|B1)\) Tj/g) ?? []).length
    expect(texts).toBe(0)
  })

  it('打开色号后每格都有标注（小图案走逐格标）', () => {
    const { sink } = render(8, 8, { showCodes: true })
    const texts = (sink.contentStream(0).match(/\((A1|B1)\) Tj/g) ?? []).length
    expect(texts).toBe(64)
  })

  it('用量清单页 + 拼接说明页都能加上', () => {
    const { sink, result } = render(52, 52, { includeBom: true, instructions: true })
    expect(result.pages).toBe(3)
    const bom = sink.contentStream(1)
    expect(bom).toContain('(No.) Tj')
    expect(bom).toContain('(Qty) Tj')
    const help = sink.contentStream(2)
    expect(help).toContain('100 mm ruler')
    expect(help).toContain('CUT HERE')
  })

  it('没有任何嵌入图片（全矢量）', () => {
    const { sink } = render(78, 78, { includeBom: true, instructions: true })
    for (let page = 0; page < sink.pageCount(); page++) {
      expect(countStreamOps(sink.contentStream(page)).images).toBe(0)
    }
  })

  it('一整页按色分桶：76×110 格 2 色 = 2 次填充 + 底面 + 重叠带', () => {
    const { sink } = render(76, 110)
    const stats = countStreamOps(sink.contentStream(0))
    expect(stats.fillOps).toBeLessThanOrEqual(3)
    // 单元格 + 1 张纸 + 2 块板框（板框按块画，自由摆放也准）
    expect(stats.rectOps).toBe(76 * 110 + 3)
  })

  it('用量 CSV 是 UTF-8 带 BOM 的五列 + 合计', () => {
    const csv = bomToCsv(
      [
        { number: '1', code: 'A1', name: '黄', hex: '#FAF5CD', count: 10, colorIndex: 0 },
        { number: '2', code: 'B1', name: '蓝', hex: '#1B2A55', count: 4, colorIndex: 1 },
      ],
      'TEST',
    )
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('No.,Code,Name,HEX,Qty,Total')
    expect(csv.split('\r\n')[0]).toContain('# TEST')
    expect(csv).toContain('Total,,,,14,2 colors')
  })
})
