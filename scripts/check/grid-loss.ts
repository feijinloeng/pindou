#!/usr/bin/env node
/**
 * 网格、布局、导出和工程输入的自检：这些结果算错就等于悄悄丢内容。
 * `npm run check` 直接跑（Node 24 跑 TS，不装任何测试框架）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { zlibSync } from 'fflate'

import { PALETTES } from '../../src/data/palettes.ts'
import { DEFAULT_SETTINGS } from '../../src/conversion/settings.ts'
import { downscalePositioned } from '../../src/conversion/downscale.ts'

import {
  boardGuide,
  boardPlacementOverlapsOthers,
  deriveLayoutGeometry,
  placementsSizeMm,
  validateLayout,
} from '../../src/domain/board.ts'
import { EMPTY, lostCells } from '../../src/domain/grid.ts'
import { PT_PER_MM } from '../../src/domain/geometry.ts'
import { paletteDisplayLabel } from '../../src/domain/palette.ts'
import {
  PAPER_FOOTER_MM,
  PAPER_HEADER_MM,
  paginate,
  paperLayout,
  planAnnotations,
} from '../../src/render/documentLayout.ts'
import { exportFilename, safeName } from '../../src/render/download.ts'
import { createPdfSink } from '../../src/render/pdf.ts'
import {
  createProject,
  serializeProject,
  validateProject,
} from '../../src/domain/project.ts'

/** 全板可用（placeable 省略）或按遮罩给 */
function grid(cols: number, rows: number, placeable?: Uint8Array) {
  return { cols, rows, cells: new Uint16Array(cols * rows).fill(EMPTY), placeable }
}

function fill(g: ReturnType<typeof grid>, index: number, value = 0) {
  g.cells[index] = value
}

// 1. 内容全在新板阵里面：一格都不丢
{
  const g = grid(4, 4)
  fill(g, 0)
  fill(g, 15)
  assert.equal(lostCells(g, { cols: 4, rows: 4, placeable: new Uint8Array(16).fill(1) }), 0)
}

// 2. 新板阵变小：外面的格子算丢
{
  const g = grid(4, 4)
  fill(g, 0) // 第 0 行第 0 列，留着
  fill(g, 3 * 4 + 3) // 第 3 行第 3 列，新板阵只有 2×2，丢掉
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable: new Uint8Array(4).fill(1) }), 1)
}

// 3. 新的空档（外接矩形里没有板的地方）：落在空档里的格子算丢
{
  const g = grid(2, 2)
  fill(g, 1) // 第 0 行第 1 列
  const placeable = new Uint8Array([1, 0, 1, 1]) // 右上角是空档
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable }), 1)
}

// 4. 现在的空档里的脏数据不算内容，丢了也不算丢
{
  const g = grid(2, 2, new Uint8Array([1, 0, 1, 1]))
  fill(g, 1) // 在空档里，本来就不算作品
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable: new Uint8Array(4) }), 0)
}

// 5-8. Physical mini-board guide geometry: safe margin, 10×10 frames, 5×5 dashed crosses, seam gap
{
  const guide104 = boardGuide({ board: 'mini104', c0: 0, r0: 0 })
  assert.ok(guide104)
  assert.equal(guide104.left, 2)
  assert.equal(guide104.right, 102)
  assert.equal(guide104.solidCols.length, 11)
  assert.equal(guide104.dashedCols[0], 7)
  assert.equal(guide104.dashedCols.at(-1), 97)

  const guide52 = boardGuide({ board: 'mini52', c0: 0, r0: 0 })
  const next104 = boardGuide({ board: 'mini104', c0: 104, r0: 0 })
  assert.ok(guide52)
  assert.ok(next104)
  assert.equal(guide52.left, 1)
  assert.equal(next104.left - guide104.right, 4)
  assert.equal(boardGuide({ board: 'midi29', c0: 0, r0: 0 }), null)

  const blank = deriveLayoutGeometry({ placements: [], gapMm: 0 })
  assert.equal(blank.boards.length, 0)
  const irregular = deriveLayoutGeometry({
    placements: [
      { board: 'mini52', col: 0, row: 0 },
      { board: 'mini26', col: 60, row: 7 },
    ],
    gapMm: 0,
  })
  assert.equal(irregular.boards.length, 2)
  assert.equal(irregular.placeable[7 * irregular.cols + 60], 1)
  const overlap = {
    placements: [
      { board: 'mini26', col: 0, row: 0 },
      { board: 'mini26', col: 10, row: 10 },
    ],
    gapMm: 0,
  }
  assert.throws(() => deriveLayoutGeometry(overlap), /叠在一起/)

  // 共边、留缝和阶梯形都属于合法自由布局；只有面积交集才是重叠。
  const stepped = [
    { board: 'mini26' as const, col: 0, row: 0 },
    { board: 'mini26' as const, col: 26, row: 7 },
  ]
  assert.equal(validateLayout({ placements: stepped, gapMm: 0 }), null)
  assert.equal(boardPlacementOverlapsOthers(stepped, 1, stepped[1]), false)
  assert.equal(
    boardPlacementOverlapsOthers(stepped, 1, { board: 'mini26', col: 25, row: 7 }),
    true,
  )
}

// 9. Physical summaries count only internal board seams, never the outer frame.
{
  const one = placementsSizeMm([{ board: 'mini52', col: 0, row: 0 }])
  assert.equal(`${one.w.toFixed(1)}×${one.h.toFixed(1)}`, '135.2×135.2')
  const pair = placementsSizeMm([
    { board: 'mini52', col: 0, row: 0 },
    { board: 'mini52', col: 52, row: 0 },
  ], 1)
  assert.equal(`${pair.w.toFixed(1)}×${pair.h.toFixed(1)}`, '271.4×135.2')
}

// 10. Export bundle primary files keep a readable numeric order and distinguish preview/vector/print output.
assert.equal(exportFilename(1, '春日作品', '预览图', 'png'), '1.春日作品（预览图）.png')
assert.equal(exportFilename(2, '春日作品', '矢量版', 'pdf'), '2.春日作品（矢量版）.pdf')
assert.equal(exportFilename(3, '春日作品', '打印版', 'pdf'), '3.春日作品（打印版）.pdf')
assert.equal(safeName('  a/b\n'), 'a_b')

// jsPDF receives user text raw; its own escaping must handle parentheses and backslashes once.
{
  const sink = createPdfSink({ widthPt: 100, heightPt: 100, cjkFontBase64: '', compress: false })
  sink.text('a(b)\\c', 10, 10, 10, 'fill')
  sink.text('a(b)\\c', 10, 30, 10, 'fillstroke')
  sink.textBatch([{ text: 'a(b)\\c', x: 10, baselineY: 50 }], 10, [0, 0, 0], 'fill')
  const content = new TextDecoder().decode(sink.output())
  assert.equal(content.split('(a\\(b\\)\\\\c) Tj').length - 1, 3)
}

// 11. Vector usage-list labels use Chinese while codes and palette identifiers stay intact.
const mardLabel = paletteDisplayLabel({
  brand: 'MARD',
  displayName: 'MARD 221（221/221 有色值）',
})
assert.equal(mardLabel, 'MARD（曼德） 221（221/221 有色值）')

// 12. Paper output uses one continuous scope for a multi-board layout, then chooses the
// orientation that needs fewer A4 sheets instead of starting a new PDF per board.
{
  const wide = grid(104, 52)
  for (let i = 0; i < wide.cells.length; i++) wide.cells[i] = 0
  const layout = paperLayout(wide, 2.6, {
    overlap: 3,
    boards: [
      { index: 0, board: 'mini52', c0: 0, r0: 0, cw: 52, rh: 52 },
      { index: 1, board: 'mini52', c0: 52, r0: 0, cw: 52, rh: 52 },
    ],
  })
  assert.equal(layout.orientation, 'landscape')
  assert.equal(layout.sheets.length, 1)
  assert.equal(layout.sheets[0].cols, 104)
  assert.equal(layout.sheets[0].rows, 52)
}

// 13. Adjacent sheets share the configured overlap band.
{
  const large = grid(150, 150)
  const layout = paperLayout(large, 2.6, { overlap: 3 })
  assert.ok(layout.sheets.length > 1)
  assert.equal(layout.sheets[1].col0, layout.sheets[0].col0 + layout.sheets[0].cols - 3)
  assert.equal(layout.sheets[3].row0, layout.sheets[0].row0 + layout.sheets[0].rows - 3)
}

// 14. A uniform region gets a large center label plus an outer boundary ring.
{
  const uniform = grid(12, 12)
  uniform.cells.fill(0)
  const palette = {
    colors: [{ code: 'A01', name: '测试色', hex: '#123456', rgb: [18, 52, 86], lab: [0, 0, 0] }],
  } as unknown as Parameters<typeof planAnnotations>[1]
  const plan = planAnnotations(uniform, palette, 2.6)
  assert.equal(plan.labels.length, 1)
  assert.equal(plan.stats.boundaryCells, 44)
  assert.equal(plan.cellMarks.reduce((total, marked) => total + marked, 0), 44)
}

// 15. Two very sparse neighboring logical sheets are cropped and packed on one A4 without scaling.
{
  const sparse = grid(150, 150)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) sparse.cells[row * sparse.cols + col] = 0
    for (let col = 103; col < 107; col++) sparse.cells[row * sparse.cols + col] = 0
  }
  const layout = paperLayout(sparse, 2.6, { overlap: 3 })
  const firstPage = layout.pages?.[0]
  assert.ok(firstPage)
  assert.equal(firstPage.fragments.length, 2)
  assert.equal(firstPage.fragments[0].sourceIndex, 0)
  assert.equal(firstPage.fragments[1].sourceIndex, 1)
  assert.ok(firstPage.fragments.every((fragment) => fragment.cropped && fragment.showLabel))
  assert.ok(layout.pages!.length < layout.sheets.length)
  const first = firstPage.fragments[0]
  const second = firstPage.fragments[1]
  const gapPt = second.xPt - (first.xPt + first.range.cols * 2.6 * PT_PER_MM)
  assert.ok(gapPt >= 10 * PT_PER_MM)
  assert.equal(first.range.cols * 2.6, 18.2)
}

// 16. Pagination keeps the minimum page count but balances the shared ranges instead of
// leaving a tiny final strip that costs paper and extra cutting.
{
  const ranges = paginate(208, 70, 110, 70, 3)
  assert.equal(ranges.length, 2)
  assert.ok(Math.abs(ranges[0].cols - ranges[1].cols) <= 1)
  assert.equal(ranges[1].col0, ranges[0].cols - 3)

  const blank = paperLayout(grid(150, 150), 2.6, { overlap: 3 })
  assert.equal(blank.sheets.length, 6)
  const rowRanges = [...new Map(blank.sheets.map((sheet) => [sheet.row0, sheet.rows])).values()]
  assert.equal(rowRanges.length, 2)
  assert.ok(Math.max(...rowRanges) - Math.min(...rowRanges) <= 1)
}

// 17. The pattern never enters the reserved header/footer bands on a physical A4 page.
{
  const g = grid(208, 70)
  g.cells.fill(0)
  const layout = paperLayout(g, 2.6, { overlap: 3 })
  const pageHeightPt = layout.pageMm.h * PT_PER_MM
  const bodyBottom = (layout.marginMm + PAPER_FOOTER_MM) * PT_PER_MM
  const bodyTop = pageHeightPt - (layout.marginMm + PAPER_HEADER_MM) * PT_PER_MM
  for (const page of layout.pages ?? []) {
    for (const fragment of page.fragments) {
      const bottom = fragment.yPt
      const top = bottom + fragment.range.rows * 2.6 * PT_PER_MM
      assert.ok(bottom >= bodyBottom - 0.01)
      assert.ok(top <= bodyTop + 0.01)
    }
  }
}

// 18-20. Project input validation rejects unknown palettes and coercible bad cell values,
// while a normal compressed project still round-trips.
{
  const layout = { placements: [{ board: 'mini26' as const, col: 0, row: 0 }], gapMm: 0 }
  const geometry = deriveLayoutGeometry(layout)
  const project = createProject({
    name: '括号(与反斜杠\\\\)',
    layout,
    paletteId: 'mard-221',
    grid: grid(geometry.cols, geometry.rows, geometry.placeable),
  })
  const serialized = serializeProject(project)
  const roundTrip = validateProject(JSON.parse(serialized))
  assert.ok(roundTrip.project)
  assert.equal(roundTrip.project?.name, project.name)

  const unknownPalette = JSON.parse(serialized) as Record<string, unknown>
  unknownPalette.paletteId = 'not-a-real-palette'
  assert.equal(validateProject(unknownPalette).project, null)

  const badCells = JSON.parse(serialized) as { grid: { cols: number; rows: number; cells: unknown[] } }
  badCells.grid = {
    cols: geometry.cols,
    rows: geometry.rows,
    cells: Array.from({ length: geometry.cols * geometry.rows }, (_, i) => (i === 1 ? null : EMPTY)),
  }
  for (const value of [null, '1', -1, 1.5, 0x10000, NaN, Infinity, 221]) {
    badCells.grid.cells[1] = value
    assert.equal(validateProject(badCells).project, null)
  }
  const withConversion = { ...project, conversion: { ...DEFAULT_SETTINGS, strategyId: 'auto' as const, dither: 0.35 } }
  assert.deepEqual(validateProject(JSON.parse(serializeProject(withConversion))).project?.conversion, withConversion.conversion)
  const badGap = { ...project, layout: { ...layout, gapMm: -1 } }
  assert.equal(validateProject(badGap).project?.layout.gapMm, 0)
  const hostile = JSON.parse(serialized) as Record<string, unknown>
  hostile.view = { zoom: 1e99, panX: 1e99, panY: -1e99, showCodes: true }
  hostile.conversion = { ...DEFAULT_SETTINGS, dither: 1e99 }
  const recovered = validateProject(hostile)
  assert.equal(recovered.project?.view.zoom, 64)
  assert.equal(recovered.project?.view.panX, 10_000_000)
  assert.equal(recovered.project?.conversion?.dither, 1)
  assert.equal(validateProject({ ...project, layout: { placements: Array.from({ length: 8_001 }, () => ({ board: 'mini26', col: 0, row: 0 })), gapMm: 0 } }).project, null)

  // A tiny zlib stream that inflates far past the declared grid must be rejected,
  // and must not inflate past declared size + 1 byte while checking (decompression bomb guard).
  const bomb = JSON.parse(serialized) as { grid: { data: string } }
  bomb.grid.data = Buffer.from(zlibSync(new Uint8Array(8_000_000), { level: 9 })).toString('base64')
  assert.equal(validateProject(bomb).project, null)
}

// 20. Malformed free-layout entries return a structured validation error instead of throwing.
assert.deepEqual(
  validateLayout({ placements: [null as never], gapMm: 0 }),
  { kind: 'unknown-board', board: 'undefined' },
)

// 21. Image placement keeps the scaled image inside the intended translated region.
{
  const red = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }
  const shifted = downscalePositioned(red, 5, 5, 'contain', 0.5, 0.5, 0, 'mean')
  assert.deepEqual(Array.from(shifted.data.slice((2 * 5 + 4) * 3, (2 * 5 + 4) * 3 + 3)), [255, 0, 0])
  assert.deepEqual(Array.from(shifted.data.slice(0, 3)), [255, 255, 255])
}

// Compact runtime data must keep every color index and RGB/Lab value identical to the source.
const source = JSON.parse(readFileSync(new URL('../../src/data/palettes.json', import.meta.url), 'utf8'))
assert.equal(PALETTES.length, source.palettes.length)
for (const palette of PALETTES) {
  const original = source.palettes.find((item: { id: string }) => item.id === palette.id)
  const comparable = ({ code, name, hex, rgb, lab }: typeof palette.colors[number]) => ({ code, name, hex, rgb, lab })
  assert.deepEqual(palette.colors.map(comparable), original.colors.map(comparable))
}

console.log('Grid, layout, project validation, conversion settings, PDF escaping and palette checks passed.')
