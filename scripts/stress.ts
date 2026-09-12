#!/usr/bin/env node
/**
 * 500 万格全链路压测（M8 的验收）：
 *   建板阵 → 造图案 → 转换（模拟源图）→ 屏幕版 PDF → 用量 CSV
 * 用法：npx jiti scripts/stress.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { deriveGeometry } from '../src/domain/board.ts'
import { createGrid, usedCells } from '../src/domain/grid.ts'
import { convert } from '../src/conversion/convert.ts'
import { defaultColorIndex } from '../src/data/palettes.ts'
import { countStreamOps, createPdfSink } from '../src/render/pdf.ts'
import { renderScreenPdf } from '../src/render/documentScreen.ts'
import { screenLayout } from '../src/render/documentLayout.ts'
import { buildBom, bomToCsv } from '../src/render/bom.ts'
import { PT_PER_MM } from '../src/domain/geometry.ts'
import type { SourceImage } from '../src/conversion/types.ts'

const paletteFile = JSON.parse(readFileSync('src/data/palettes.json', 'utf8'))
const palette = paletteFile.palettes.find((p: { id: string }) => p.id === 'mard-291')
const pixel = (hex: string) => {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const colors = palette.colors.map((c: { hex: string }) => pixel(c.hex))

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const mem = () => {
  const m = process.memoryUsage()
  return `${mb(m.heapUsed)} heap + ${mb(m.arrayBuffers)} buffers`
}

console.log(`色板 ${palette.id}（${palette.colors.length} 色）；转换前内存 ${mem()}`)

// 1) 建板阵：86×86 个 26 板 = 2236 × 2236
let t = performance.now()
const boardArray = {
  rows: Array.from({ length: 86 }, () => Array.from({ length: 86 }, () => 'mini26' as const)),
  gapMm: 0,
}
const geom = deriveGeometry(boardArray)
const buildMs = Math.round(performance.now() - t)
console.log(`\n[1] 建板阵 ${geom.boards.length} 块 → ${geom.cols}×${geom.rows} = ${(geom.cols * geom.rows).toLocaleString()} 格，${buildMs} ms`)
console.log(`    板缝 ${geom.seamCols.length + geom.seamRows.length} 条；内存 ${mem()}`)

// 2) 造一张 2000×2000 的源图（色块图案，接近实拍）
t = performance.now()
const side = 2000
const data = new Uint8ClampedArray(side * side * 4)
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const index = (Math.floor(x / 37) + Math.floor(y / 29)) % colors.length
    const c = colors[index]
    const i = (y * side + x) * 4
    data[i] = c[0]
    data[i + 1] = c[1]
    data[i + 2] = c[2]
    data[i + 3] = 255
  }
}
const image: SourceImage = { width: side, height: side, data }
console.log(`[2] 造源图 ${side}×${side}，${Math.round(performance.now() - t)} ms`)

// 3) 转换到 500 万格
t = performance.now()
const stages: string[] = []
const result = convert({
  image,
  paletteColors: colors,
  cols: geom.cols,
  rows: geom.rows,
  settings: {
    strategyId: 'general',
    maxColors: 48,
    dither: null,
    cropToSubject: false,
    removeBackground: false,
    clearExisting: true,
    fit: 'cover',
  },
  onProgress: (stage) => {
    if (stages.at(-1) !== stage) stages.push(stage)
  },
})
const convertMs = performance.now() - t
console.log(`[3] 转换 → ${usedCells({ cols: geom.cols, rows: geom.rows, cells: result.cells }).toLocaleString()} 颗豆，用了 ${result.usedIndexes.length} 色，${Math.round(convertMs)} ms`)
console.log(`    阶段：${stages.join(' → ')}`)
console.log(`    内存 ${mem()}`)

const grid = createGrid(geom.cols, geom.rows)
grid.cells.set(result.cells)

// 4) 屏幕版 PDF
t = performance.now()
// 页面尺寸必须按布局算：2236 格 × 2.6mm = 5813mm 超过 PDF 单页上限，会分页
const layout = screenLayout(grid, palette.pitchMm, { showCodes: true, includeBom: true })
const sink = createPdfSink({
  widthPt: layout.pageMm.w * PT_PER_MM,
  heightPt: layout.pageMm.h * PT_PER_MM,
})
const screen = renderScreenPdf(sink, {
  grid,
  palette,
  geom,
  pitchMm: palette.pitchMm,
  pitchLabel: palette.pitchMm,
  showCodes: true,
  includeBom: true,
})
const pdfMs = performance.now() - t
const bytes = sink.output()
writeFileSync('/tmp/pindou-stress-screen.pdf', bytes)
const stats = countStreamOps(sink.contentStream(0))
console.log(`[4] 屏幕版 PDF ${mb(bytes.byteLength)}，生成 ${Math.round(pdfMs)} ms，${layout.sheets.length} 页`)
console.log(`    填充 ${stats.fillOps} 次 / 矩形 ${stats.rectOps} 个 / 文字对象 ${stats.textObjects} 个`)
console.log(`    大标签 ${screen.plan.labels.length} 个`)
console.log(`    内存 ${mem()}`)

// 5) 用量 CSV
const csv = bomToCsv(buildBom(grid, palette), palette.displayName)
writeFileSync('/tmp/pindou-stress-bom.csv', csv)
console.log(`[5] 用量 CSV ${(csv.length / 1024).toFixed(1)} KB`)

console.log('\n判定：')
console.log(`  建板阵 < 3 秒？${buildMs < 3000 ? '✓' : '✗'}（${buildMs} ms）`)
console.log(`  转换 < 30 秒？${convertMs < 30_000 ? '✓' : '✗'}（${Math.round(convertMs)} ms）`)
console.log(`  屏幕版 PDF ≤ 20 MB？${bytes.byteLength <= 20 * 1024 * 1024 ? '✓' : '✗'}（${mb(bytes.byteLength)}）`)
console.log(`  峰值内存 < 500 MB？${process.memoryUsage().heapUsed < 500 * 1024 * 1024 ? '✓' : '✗'}（${mem()}）`)
void defaultColorIndex
