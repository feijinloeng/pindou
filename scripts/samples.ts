#!/usr/bin/env node
/**
 * 生成可以拿去看的样例文件（不是一次性产物，改完渲染重跑这个）。
 * 用法：npx jiti scripts/samples.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { deriveGeometry } from '../src/domain/board.ts'
import { createGrid } from '../src/domain/grid.ts'
import { buildPaperPdf, buildScreenPdf, buildPaperZip, buildBomCsv, type ExportContext } from '../src/render/exporters.ts'

const paletteFile = JSON.parse(readFileSync('src/data/palettes.json', 'utf8'))
const palette = paletteFile.palettes.find((p: { id: string }) => p.id === 'mard-291')

mkdirSync('samples', { recursive: true })

/** 一只晚上 + 月亮 + 猫头 + 草地（第 7.8 节那个 A4 样例的同类图案） */
function catBoard(cols: number, rows: number) {
  const grid = createGrid(cols, rows)
  const pick = (code: string) => palette.colors.findIndex((c: { code: string }) => c.code === code)
  const night = pick('C21') >= 0 ? pick('C21') : 20
  const head = pick('H7')
  const grass = pick('B8')
  const moon = pick('A3')
  const face = pick('H2')
  const nose = pick('H12')
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) grid.cells[y * cols + x] = night
  // 月亮
  for (let y = 6; y < 26; y++) for (let x = 12; x < 34; x++) {
    if (Math.hypot(x - 23, y - 16) < 10) grid.cells[y * cols + x] = moon
  }
  // 草地
  for (let y = Math.floor(rows * 0.72); y < rows; y++) for (let x = 0; x < cols; x++) grid.cells[y * cols + x] = grass
  // 猫头
  const cx = Math.floor(cols / 2)
  const cy = Math.floor(rows * 0.55)
  for (let y = cy - 18; y < cy + 18; y++) for (let x = cx - 16; x < cx + 16; x++) {
    if (y < 0 || y >= rows || x < 0 || x >= cols) continue
    if (Math.hypot((x - cx) / 16, (y - cy) / 18) <= 1) grid.cells[y * cols + x] = head
  }
  // 脸
  for (let y = cy - 8; y < cy + 4; y++) for (let x = cx - 9; x < cx + 9; x++) {
    if (y < 0 || y >= rows || x < 0 || x >= cols) continue
    if (Math.hypot((x - cx) / 9, (y - cy + 2) / 6) <= 1) grid.cells[y * cols + x] = face
  }
  // 眼睛和鼻子（高对比孤块，去杂时不能被吃掉）
  for (const [ex, ey] of [[cx - 5, cy - 4], [cx + 5, cy - 4]]) {
    for (let y = ey; y < ey + 3; y++) for (let x = ex; x < ex + 3; x++) grid.cells[y * cols + x] = pick('H01') >= 0 ? pick('H01') : 0
  }
  for (let y = cy + 2; y < cy + 4; y++) for (let x = cx; x < cx + 2; x++) grid.cells[y * cols + x] = nose
  return grid
}

// 样例 1：3×3 个 52 板（156×156）—— 屏幕版
{
  const boardArray = {
    rows: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 'mini52' as const)),
    gapMm: 0,
  }
  const grid = catBoard(156, 156)
  const ctx: ExportContext = {
    grid, palette, geom: deriveGeometry(boardArray), pitchMm: 2.6, name: '样例-猫',
  }
  writeFileSync('samples/样例-屏幕版-3x3个52.pdf', buildScreenPdf(ctx, { showCodes: true, includeBom: true }))
  writeFileSync('samples/样例-用量.csv', buildBomCsv(ctx))
  console.log('✓ samples/样例-屏幕版-3x3个52.pdf')
}

// 样例 2：一块 52 板 —— 纸面版（正好一张 A4）
{
  const boardArray = { rows: [['mini52' as const]], gapMm: 0 }
  const grid = catBoard(52, 52)
  const ctx: ExportContext = {
    grid, palette, geom: deriveGeometry(boardArray), pitchMm: 2.6, name: '样例-一块板',
  }
  writeFileSync(
    'samples/样例-纸面版-1块52.pdf',
    buildPaperPdf(ctx, { boards: ctx.geom.boards, showCodes: false, includeBom: true, instructions: true }),
  )
  writeFileSync(
    'samples/样例-纸面版-带色号.pdf',
    buildPaperPdf(ctx, { boards: ctx.geom.boards, showCodes: true, includeBom: false, instructions: true }),
  )
  console.log('✓ samples/样例-纸面版-1块52.pdf（+ 带色号版）')
}

// 样例 3：整图按板打包的 zip
{
  const boardArray = {
    rows: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => 'mini52' as const)),
    gapMm: 0,
  }
  const grid = catBoard(104, 104)
  const ctx: ExportContext = {
    grid, palette, geom: deriveGeometry(boardArray), pitchMm: 2.6, name: '样例-四块板',
  }
  writeFileSync('samples/样例-按板导出.zip', buildPaperZip(ctx, { showCodes: false }))
  console.log('✓ samples/样例-按板导出.zip（每块板一个 PDF + 总览 + 用量.csv）')
}
