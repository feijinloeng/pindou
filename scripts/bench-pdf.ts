#!/usr/bin/env node
/**
 * PDF 生成基准：跑真实尺寸，报文件大小、操作符数、生成耗时。
 * 用法：node scripts/bench-pdf.ts [cols]
 *
 * 用系统 PDF 引擎量渲染耗时（Roadmap 第 11.2 节的"实测 0.73 / 1.87 秒"那一列）：
 *   qlmanage -t -s 1200 -o /tmp/pindou-bench /tmp/pindou-screen.pdf
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { deriveGeometry } from '../src/domain/board.ts'
import { createGrid } from '../src/domain/grid.ts'
import { countStreamOps, createPdfSink } from '../src/render/pdf.ts'
import { renderScreenPdf } from '../src/render/documentScreen.ts'
import { renderPaperPdf } from '../src/render/documentPaper.ts'
import { buildBom, bomToCsv } from '../src/render/bom.ts'
import { PT_PER_MM } from '../src/domain/geometry.ts'

// 直接读 JSON：Node 的 ESM 需要 import attribute，绕开 src/data/palettes.ts 的封装
const paletteFile = JSON.parse(readFileSync('src/data/palettes.json', 'utf8'))
const PALETTES = paletteFile.palettes
const cols = Number(process.argv[2] ?? 1144)
const palette = PALETTES.find((p) => p.id === 'mard-291') ?? PALETTES[0]
const pitchMm = palette.pitchMm

console.log(`色板 ${palette.id}（${palette.colors.length} 色），画布 ${cols}×${cols}，针距 ${pitchMm}mm`)

const grid = createGrid(cols, cols)
const block = 9 // 9×9 色块是最不利图案（色号最密）
const started = performance.now()
for (let y = 0; y < cols; y++) {
  for (let x = 0; x < cols; x++) {
    grid.cells[y * cols + x] = (Math.floor(x / block) + Math.floor(y / block)) % palette.colors.length
  }
}
console.log(`填图案 ${Math.round(performance.now() - started)} ms`)

const geom = deriveGeometry({ rows: [['mini26']], gapMm: 0 })
const boards = deriveGeometry(
  cols <= 26 ? { rows: [['mini26']], gapMm: 0 } : { rows: [['mini104']], gapMm: 0 },
)

// ---- 屏幕版：单页矢量 ----
const pagePt = cols * pitchMm * PT_PER_MM
const sink = createPdfSink({ widthPt: pagePt, heightPt: pagePt })
const t0 = performance.now()
const screen = renderScreenPdf(sink, {
  grid,
  palette,
  geom: boards,
  pitchMm,
  pitchLabel: pitchMm,
  showCodes: true,
  includeBom: true,
})
const screenMs = performance.now() - t0
const stats = countStreamOps(sink.contentStream(0))
const bytes = sink.output()
writeFileSync('/tmp/pindou-screen.pdf', bytes)

console.log('\n--- 屏幕版单页 PDF ---')
console.log(`页面尺寸 ${(screen.widthPt / PT_PER_MM).toFixed(1)} × ${(screen.heightPt / PT_PER_MM).toFixed(1)} mm（${pagePt.toFixed(0)} pt）`)
console.log(`生成耗时 ${screenMs.toFixed(0)} ms`)
console.log(`文件 ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`)
console.log(`填充操作 ${stats.fillOps} 次 / 矩形 ${stats.rectOps} 个 / 文字对象 ${stats.textObjects} 个`)
console.log(`大标签 ${screen.plan.labels.length} 个，逐格标 ${screen.plan.stats.textObjects - screen.plan.labels.length} 格`)
console.log(`边界环 ${screen.plan.stats.boundaryCells} 格，内部 ${screen.plan.stats.interiorCells} 格，连通域 ${screen.plan.stats.regions} 个`)
console.log('写到 /tmp/pindou-screen.pdf')

// ---- 纸面版：3×3 个 52 板 ----
const paperGrid = createGrid(156, 156)
for (let y = 0; y < 156; y++) {
  for (let x = 0; x < 156; x++) paperGrid.cells[y * 156 + x] = (x + y) % 12
}
const paperGeom = deriveGeometry({
  rows: [
    ['mini52', 'mini52', 'mini52'],
    ['mini52', 'mini52', 'mini52'],
    ['mini52', 'mini52', 'mini52'],
  ],
  gapMm: 0,
})
const paperSink = createPdfSink({ widthPt: 210 * PT_PER_MM, heightPt: 297 * PT_PER_MM })
const t1 = performance.now()
const paper = renderPaperPdf(paperSink, {
  grid: paperGrid,
  palette,
  geom: paperGeom,
  pitchMm,
  pitchLabel: pitchMm,
  showCodes: true,
  includeBom: true,
  instructions: true,
})
const paperMs = performance.now() - t1
const paperBytes = paperSink.output()
writeFileSync('/tmp/pindou-paper.pdf', paperBytes)
console.log('\n--- 纸面版 1:1（3×3 个 52 板）---')
console.log(`页数 ${paper.pages}（其中 ${paper.sheetsDrawn} 张图纸页）`)
console.log(`生成耗时 ${paperMs.toFixed(0)} ms`)
console.log(`文件 ${(paperBytes.byteLength / 1024).toFixed(1)} KB`)
console.log('写到 /tmp/pindou-paper.pdf')

// ---- 用量 CSV ----
const csv = bomToCsv(buildBom(paperGrid, palette), palette.displayName)
writeFileSync('/tmp/pindou-bom.csv', csv)
console.log(`\n用量 CSV ${(csv.length / 1024).toFixed(1)} KB，写到 /tmp/pindou-bom.csv`)
void geom
