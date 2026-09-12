import { EMPTY, type CellGrid, usageByIndex } from '../domain/grid'
import { hexToRgb, type Palette } from '../domain/palette'
import { PT_PER_MM } from '../domain/geometry'
import { gray255, type PdfSink } from './pdf'

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
}

const COLUMNS: Array<{ key: keyof BomRow | 'swatch'; label: string; weight: number }> = [
  { key: 'number', label: 'No.', weight: 0.12 },
  { key: 'swatch', label: 'Color', weight: 0.16 },
  { key: 'code', label: 'Code', weight: 0.24 },
  { key: 'hex', label: 'HEX', weight: 0.28 },
  { key: 'count', label: 'Qty', weight: 0.2 },
]

/**
 * 用量清单：五列（编号 / 色块 / 色号 / HEX / 颗数）。
 * ⚠️ v1 全程避开中文，表头用拉丁字符，保住矢量性（第 11.4 节）。
 * 色块画成实心矩形，不是图片。
 */
export function drawBom(sink: PdfSink, rows: BomRow[], options: BomDrawOptions): number {
  const fontPt = options.fontPt ?? 9
  const rowHeight = options.rowHeightPt ?? fontPt * 1.8
  const limit = options.maxRows ?? rows.length
  let y = options.yTop

  if (options.title) {
    sink.fillColor([0, 0, 0])
    sink.text(options.title, options.x, y, fontPt * 1.6, 'fill')
    y -= rowHeight * 1.6
  }

  // 表头
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
        // 实心矩形色块（矢量）
        sink.fillColor(hexToRgb(row.hex))
        sink.rect(x, y - fontPt * 0.25, cellWidth * 0.6, rowHeight * 0.7)
        sink.fill()
      } else if (column.key === 'count') {
        sink.fillColor([0, 0, 0])
        sink.text(String(row.count), x, y, fontPt, 'fill')
      } else {
        const value = String(row[column.key as keyof BomRow] ?? '')
        sink.fillColor([0, 0, 0])
        sink.text(value, x, y, fontPt, 'fill')
      }
      x += cellWidth
    }
    y -= rowHeight
  }
  return y
}

/** 用量 CSV：UTF-8 带 BOM，Excel 直接打开不乱码（第 11.4 节） */
export function bomToCsv(rows: BomRow[], paletteName: string): string {
  const lines = [`# ${paletteName}`, 'No.,Code,Name,HEX,Qty,Total']
  for (const row of rows) lines.push(`${row.number},${row.code},${row.name},${row.hex},${row.count},`)
  lines.push(`Total,,,,${totalBeads(rows)},${rows.length} colors`)
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export { EMPTY, PT_PER_MM }
