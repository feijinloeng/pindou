#!/usr/bin/env node
/**
 * lostCells 的自检：换板阵前的"会丢多少格"算错就等于悄悄丢内容。
 * `npm run check` 直接跑（Node 24 跑 TS，不装任何测试框架）。
 */
import assert from 'node:assert/strict'

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
import { paperLayout, planAnnotations } from '../../src/render/documentLayout.ts'
import { exportFilename } from '../../src/render/download.ts'

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

// 16. Even a thin logical edge page with no colored beads is printable content (grid/red guides),
// so the two final strips must still be packed instead of remaining as two mostly blank A4 pages.
{
  const blank = paperLayout(grid(150, 150), 2.6, { overlap: 3 })
  assert.equal(blank.sheets.length, 6)
  const lastPage = blank.pages?.at(-1)
  assert.ok(lastPage)
  assert.equal(lastPage.fragments.length, 2)
  assert.deepEqual(
    lastPage.fragments.map((fragment) => fragment.sourceIndex),
    [4, 5],
  )
  assert.ok(lastPage.fragments.every((fragment) => fragment.showLabel))
  assert.ok(Math.abs(lastPage.fragments[0].yPt - lastPage.fragments[1].yPt) >= 10 * PT_PER_MM)
}

console.log('网格 / 布局 / 迁移 / 导出自检通过')
