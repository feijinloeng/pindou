import { EMPTY, type CellGrid, usageByIndex } from '../domain/grid.ts'
import { hexToRgb, paletteDisplayLabel, type Palette } from '../domain/palette.ts'
import { PT_PER_MM } from '../domain/geometry.ts'
import { gray255, type PdfSink } from './pdf.ts'

export { paletteDisplayLabel }

export interface BomRow {
  /** 1-2 位编号，按用量降序分配 */
  number: string
  code: string
  name: string
  hex: string
  count: number
  colorIndex: number
}

/**
 * 编号按用量降序分配（第 7.8 节的降级 + 第 11.4 节的对照表都用这一套）。
 * 同一个色板、同一张图，编号必须处处一致 —— 色板、每颗豆、用量清单、导出件。
 */
export function assignNumbers(usage: Uint32Array, palette: Palette): Map<string, string> {
  const used: number[] = []
  for (let i = 0; i < usage.length; i++) if (usage[i] > 0) used.push(i)
  used.sort((a, b) => usage[b] - usage[a] || a - b)
  const map = new Map<string, string>()
  used.forEach((index, order) => map.set(palette.colors[index].code, String(order + 1)))
  return map
}

export function buildBom(grid: CellGrid, palette: Palette): BomRow[] {
  const usage = usageByIndex(grid, palette.colors.length)
  const numbers = assignNumbers(usage, palette)
  const rows: BomRow[] = []
  for (let i = 0; i < palette.colors.length; i++) {
    if (usage[i] === 0) continue
    const color = palette.colors[i]
    rows.push({
      number: numbers.get(color.code) ?? '',
      code: color.code,
      name: color.name,
      hex: color.hex,
      count: usage[i],
      colorIndex: i,
    })
  }
  rows.sort((a, b) => b.count - a.count || a.colorIndex - b.colorIndex)
  return rows
}

export function totalBeads(rows: BomRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0)
}

export interface BomDrawOptions {
  x: number
  /** 表格左上角的 y（PDF 点，从左下角量） */
  yTop: number
  width: number
  fontPt?: number
  rowHeightPt?: number
  maxRows?: number
  title?: string
  /** 分页时只在最后一页显示总计；默认显示当前 rows 的总计。 */
  showSummary?: boolean
  /** 分页时传入整张图的总颗数 / 总色数。 */
  summary?: { total: number; colors: number }
}

const COLUMNS: Array<{ key: keyof BomRow | 'swatch'; label: string; weight: number }> = [
  { key: 'number', label: '序号', weight: 0.12 },
  { key: 'swatch', label: '色块', weight: 0.14 },
  { key: 'code', label: '色号', weight: 0.18 },
  { key: 'name', label: '名称', weight: 0.26 },
  { key: 'hex', label: '色卡值', weight: 0.18 },
  { key: 'count', label: '用量（颗）', weight: 0.12 },
]

/** 按 A4 页面高度估算一页能放的色号行数，留出页眉和合计行。 */
export function bomRowsPerPage(pageHeightPt: number, fontPt = 9, rowHeightPt = fontPt * 1.8): number {
  const yTop = pageHeightPt - 60
  const beforeRows = rowHeightPt * 2.9
  const summaryHeight = rowHeightPt * 1.05
  const bottomReserve = 42
  return Math.max(1, Math.floor((yTop - bottomReserve) / rowHeightPt - beforeRows / rowHeightPt - summaryHeight / rowHeightPt))
}

export function bomPageCount(
  rowCount: number,
  pageHeightPt: number,
  fontPt = 9,
  rowHeightPt = fontPt * 1.8,
): number {
  return Math.max(1, Math.ceil(Math.max(0, rowCount) / bomRowsPerPage(pageHeightPt, fontPt, rowHeightPt)))
}

/**
 * Usage list: swatch, code, color-card value, and quantity.
 * Text is rendered with the embedded CJK font by the PDF sink and remains vector text.
 * Swatches are solid vector rectangles, not images.
 */
export function drawBom(sink: PdfSink, rows: BomRow[], options: BomDrawOptions): number {
  const fontPt = options.fontPt ?? 9
  const rowHeight = options.rowHeightPt ?? fontPt * 1.8
  const limit = options.maxRows ?? rows.length
  let y = options.yTop

  sink.setFont('cjk')
  try {
    if (options.title) {
      sink.fillColor([0, 0, 0])
      sink.text(options.title, options.x, y, fontPt * 1.6, 'fill')
      y -= rowHeight * 1.6
    }

    // Header
    let x = options.x
    sink.fillColor([0, 0, 0])
    for (const column of COLUMNS) {
      sink.text(column.label, x, y, fontPt, 'fill')
      x += options.width * column.weight
    }
    y -= rowHeight * 0.5
    sink.strokeColor(gray255(0.6))
    sink.lineWidth(0.5)
    sink.moveTo(options.x, y)
    sink.lineTo(options.x + options.width, y)
    sink.stroke()
    y -= rowHeight * 0.8

    for (let i = 0; i < Math.min(limit, rows.length); i++) {
      const row = rows[i]
      x = options.x
      for (const column of COLUMNS) {
        const cellWidth = options.width * column.weight
        if (column.key === 'swatch') {
          // Solid vector swatch.
          sink.fillColor(hexToRgb(row.hex))
          sink.rect(x, y - fontPt * 0.25, cellWidth * 0.6, rowHeight * 0.7)
          sink.fill()
        } else {
          sink.fillColor([0, 0, 0])
          sink.text(String(row[column.key as keyof BomRow] ?? ''), x, y, fontPt, 'fill')
        }
        x += cellWidth
      }
      y -= rowHeight
    }
    if (options.showSummary === false) return y

    const summary = options.summary ?? { total: totalBeads(rows), colors: rows.length }
    sink.strokeColor(gray255(0.6))
    sink.lineWidth(0.5)
    sink.moveTo(options.x, y - rowHeight * 0.15)
    sink.lineTo(options.x + options.width, y - rowHeight * 0.15)
    sink.stroke()
    y -= rowHeight * 0.9
    sink.fillColor([0, 0, 0])
    sink.text(`合计：${summary.total} 颗 · ${summary.colors} 种色号`, options.x, y, fontPt, 'fill')
    y -= rowHeight
    return y
  } finally {
    sink.setFont('latin')
  }
}

/** 用量 CSV：UTF-8 带 BOM，Excel 直接打开不乱码（第 11.4 节） */
export function bomToCsv(rows: BomRow[], paletteName: string): string {
  const lines = [`# ${paletteName}`, '序号,色号,名称,HEX,数量,合计']
  for (const row of rows) lines.push(`${row.number},${row.code},${row.name},${row.hex},${row.count},`)
  lines.push(`合计,,,,${totalBeads(rows)},${rows.length} 色`)
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export { EMPTY, PT_PER_MM }
