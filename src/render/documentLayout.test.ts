import { describe, expect, it } from 'vitest'

import { createGrid } from '../domain/grid'
import { getPalette } from '../data/palettes'
import { DEMO_PALETTE } from '../domain/palette'
import {
  MAX_PAGE_PT,
  OVERLAP_CELLS,
  countPages,
  paperCapacity,
  paperLayout,
  paginate,
  planAnnotations,
  screenLayout,
  sheetAt,
} from './documentLayout'
import { PT_PER_MM } from '../domain/geometry'

function solidGrid(cols: number, rows: number, color = 0) {
  const grid = createGrid(cols, rows, color)
  return grid
}

/** 独立算一遍边界环，用来交叉验证标注引擎（不依赖被测代码） */
function ringOf(cells: Uint16Array, cols: number, rows: number, target: number) {
  const ring: number[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (cells[i] !== target) continue
      const touches =
        (x > 0 && cells[i - 1] !== target) ||
        (x + 1 < cols && cells[i + 1] !== target) ||
        (y > 0 && cells[i - cols] !== target) ||
        (y + 1 < rows && cells[i + cols] !== target)
      if (touches) ring.push(i)
    }
  }
  return ring
}

describe('A4 排版数学', () => {
  it('每页容量与第 7.1 节的实测数字一致', () => {
    expect(paperCapacity(2.6)).toEqual({ cols: 76, rows: 110 })
    expect(paperCapacity(5)).toEqual({ cols: 40, rows: 57 })
  })

  it('页数速查表（第 7.2 节）逐条对上', () => {
    const cap = paperCapacity(2.6)
    const caseOf = (cols: number, rows: number) =>
      countPages(cols, cap.cols, OVERLAP_CELLS) * countPages(rows, cap.rows, OVERLAP_CELLS)

    expect(caseOf(52, 52)).toBe(1)
    expect(caseOf(78, 78)).toBe(2)
    expect(caseOf(104, 104)).toBe(2)
    expect(caseOf(208, 104)).toBe(3)
    expect(caseOf(208, 208)).toBe(6)
    expect(caseOf(156, 156)).toBe(6)
    expect(caseOf(156, 52)).toBe(3)
    expect(caseOf(312, 52)).toBe(5)
    expect(caseOf(1153, 1153)).toBe(176)
    expect(caseOf(2236, 2236)).toBe(651)
  })

  it('有效推进量 = 每页容量 − 重叠带', () => {
    expect(sheetAt(0, 1153, 76, 3).start).toBe(0)
    expect(sheetAt(1, 1153, 76, 3).start).toBe(73)
    expect(sheetAt(2, 1153, 76, 3).start).toBe(146)
  })

  it('相邻两页共享最后 / 最前 3 列（重叠带对位）', () => {
    for (let k = 0; k < 15; k++) {
      const current = sheetAt(k, 1153, 76, 3)
      const next = sheetAt(k + 1, 1153, 76, 3)
      expect(next.start + 0).toBe(current.start + 73)
      // 两页覆盖区的交集就是 3 列
      const overlap = current.start + current.count - next.start
      expect(overlap).toBe(3)
    }
  })

  it('最后一页只取剩下的格数', () => {
    const last = sheetAt(15, 1153, 76, 3)
    expect(last.start + last.count).toBe(1153)
    expect(last.count).toBeLessThanOrEqual(76)
  })

  it('paginate 覆盖全图且不越界', () => {
    const sheets = paginate(156, 156, 76, 110, 3)
    expect(sheets).toHaveLength(6)
    for (const sheet of sheets) {
      expect(sheet.col0).toBeGreaterThanOrEqual(0)
      expect(sheet.row0).toBeGreaterThanOrEqual(0)
      expect(sheet.col0 + sheet.cols).toBeLessThanOrEqual(156)
      expect(sheet.row0 + sheet.rows).toBeLessThanOrEqual(156)
    }
    // 列方向三页连起来必须盖住 0..155
    const colEnds = sheets.map((s) => s.col0 + s.cols)
    expect(Math.max(...colEnds)).toBe(156)
  })
})

describe('布局引擎：屏幕版 vs 纸面版', () => {
  it('屏幕版单页尺寸 = 豆数 × 针距，精确到 0.01mm', () => {
    const grid = createGrid(1153, 1153)
    const layout = screenLayout(grid, 2.6, { showCodes: true, includeBom: true })
    expect(layout.pageMm.w).toBeCloseTo(2997.8, 6)
    expect(layout.pageMm.h).toBeCloseTo(2997.8, 6)
    expect(layout.sheets).toHaveLength(1)
    expect(layout.overlap).toBe(0)
    expect(layout.drawSheetMarks).toBe(false)
    expect(layout.drawRuler).toBe(false)
  })

  it('超过 PDF 单页上限（14400pt ≈ 5080mm）才普通分页', () => {
    const grid = createGrid(2100, 2100)
    const layout = screenLayout(grid, 2.6, { showCodes: true, includeBom: true })
    expect(2100 * 2.6 * PT_PER_MM).toBeGreaterThan(MAX_PAGE_PT)
    expect(layout.sheets.length).toBeGreaterThan(1)
    expect(layout.overlap).toBe(0)
  })

  it('纸面版每页就是一张 A4，带重叠带和刻度尺', () => {
    const grid = createGrid(156, 156)
    const layout = paperLayout(grid, 2.6)
    expect(layout.pageMm).toEqual({ w: 210, h: 297 })
    expect(layout.cellsPerPage).toEqual({ cols: 76, rows: 110 })
    expect(layout.overlap).toBe(3)
    expect(layout.sheets).toHaveLength(6)
    expect(layout.drawRuler).toBe(true)
    expect(layout.drawSheetMarks).toBe(true)
  })

  it('按板导出：只排这块板的范围', () => {
    const grid = createGrid(156, 156)
    const boards = [
      { row: 0, col: 2, board: 'mini52' as const, c0: 104, r0: 0, cw: 52, rh: 52 },
    ]
    const layout = paperLayout(grid, 2.6, { boards })
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0]).toMatchObject({ col0: 104, row0: 0, cols: 52, rows: 52 })
  })
})

describe('自适应标注（第 7.8 节）', () => {
  const palette = DEMO_PALETTE
  const emptyPalette = getPalette('mard-291')

  it('铺满整张画布的纯色块：边界环是 0 格，不是外圈那一圈', () => {
    const grid = solidGrid(20, 20, 0)
    const plan = planAnnotations(grid, palette, 2.6)
    expect(plan.stats.regions).toBe(1)
    expect(plan.stats.boundaryCells).toBe(0)
    expect(plan.stats.interiorCells).toBe(400)
    expect(plan.labels).toHaveLength(1)
    expect(plan.stats.textObjects).toBe(1)
  })

  it('画布中间一个 20×20 纯色方块：边界环恰好 76 格，内部 324 格', () => {
    const grid = createGrid(40, 40)
    for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) grid.cells[y * 40 + x] = 3
    const plan = planAnnotations(grid, palette, 2.6)
    expect(plan.stats.boundaryCells).toBe(76)
    expect(plan.stats.interiorCells).toBe(324)
    expect(plan.labels).toHaveLength(1)
    // 独立算一遍，确认口径一致
    expect(ringOf(grid.cells, 40, 40, 3)).toHaveLength(76)
  })

  it('1×50 的长条必须走逐格，不能出大标签（包围盒很大但内接正方形是 1）', () => {
    const grid = createGrid(60, 10)
    for (let x = 0; x < 50; x++) grid.cells[4 * 60 + x] = 2
    const plan = planAnnotations(grid, palette, 2.6)
    expect(plan.labels).toHaveLength(0)
    expect(plan.stats.textObjects).toBe(50)
  })

  it('大标签的内接正方形不碰边界环', () => {
    const grid = createGrid(60, 60)
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) grid.cells[y * 60 + x] = 5
    const plan = planAnnotations(grid, palette, 2.6)
    const label = plan.labels[0]
    expect(label).toBeDefined()
    const ring = new Set(ringOf(grid.cells, 60, 60, 5))
    for (let y = label.row; y < label.row + label.size; y++) {
      for (let x = label.col; x < label.col + label.size; x++) {
        const i = y * 60 + x
        expect(ring.has(i)).toBe(false)
        expect(grid.cells[i]).toBe(5)
      }
    }
  })

  it('大标签落位：正方形里的格子全是同一个连通域的颜色', () => {
    const grid = createGrid(80, 80)
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) grid.cells[y * 80 + x] = 7
    const plan = planAnnotations(grid, palette, 2.6)
    for (const label of plan.labels) {
      for (let y = label.row; y < label.row + label.size; y++) {
        for (let x = label.col; x < label.col + label.size; x++) {
          expect(grid.cells[y * 80 + x]).toBe(label.colorIndex)
        }
      }
    }
  })

  it('小碎块全部逐格标', () => {
    const grid = createGrid(40, 40)
    for (const [x, y] of [
      [3, 3],
      [10, 10],
      [20, 30],
    ]) {
      grid.cells[y * 40 + x] = 1
    }
    const plan = planAnnotations(grid, palette, 2.6)
    expect(plan.labels).toHaveLength(0)
    expect(plan.stats.textObjects).toBe(3)
  })

  it('大色块 + 内部小岛：大块打大标签，1 格的小岛逐格标', () => {
    const grid = createGrid(60, 60)
    for (let y = 5; y < 55; y++) for (let x = 5; x < 55; x++) grid.cells[y * 60 + x] = 8
    grid.cells[30 * 60 + 30] = 0
    const plan = planAnnotations(grid, palette, 2.6)
    expect(plan.stats.regions).toBe(2)
    expect(plan.labels).toHaveLength(1) // 只有大块够大
    expect(plan.labels[0].colorIndex).toBe(8)
    expect(plan.cellMarks[30 * 60 + 30]).toBe(1) // 小岛逐格标
    // 小岛周围那 4 格属于大块的边界环，也要逐格标
    expect(plan.cellMarks[30 * 60 + 29]).toBe(1)
  })

  it('2.6mm 格子 + 5 位色号（Artkal Mini）自动降级成编号', () => {
    const palette4 = {
      ...palette,
      colors: [{ ...palette.colors[0], code: 'MA123' }],
    }
    const grid = solidGrid(20, 20, 0)
    const plan = planAnnotations(grid, palette4, 2.6)
    expect(plan.degraded[0]).toBe(true)
    expect(plan.codeFor[0]).toBe('1')
    expect(plan.cellFontPt[0]).toBeGreaterThan(2.4)
  })

  it('5mm 格子 + 5 位色号放得下，不降级', () => {
    const palette4 = { ...palette, colors: [{ ...palette.colors[0], code: '80-15211' }] }
    const grid = solidGrid(20, 20, 0)
    const plan = planAnnotations(grid, palette4, 5)
    expect(plan.degraded[0]).toBe(false)
    expect(plan.codeFor[0]).toBe('80-15211')
  })

  it('关掉标注就不产生任何文字对象', () => {
    const grid = solidGrid(20, 20, 0)
    const plan = planAnnotations(grid, palette, 2.6, { enabled: false })
    expect(plan.labels).toEqual([])
    expect(plan.stats.textObjects).toBe(0)
  })

  it('133 万格（9×9 色块，最不利图案）文字对象数远低于全逐格', () => {
    const cols = 1144
    const grid = createGrid(cols, cols)
    for (let y = 0; y < cols; y++) {
      for (let x = 0; x < cols; x++) {
        grid.cells[y * cols + x] = (Math.floor(x / 9) + Math.floor(y / 9)) % 16
      }
    }
    const started = performance.now()
    const plan = planAnnotations(grid, palette, 2.6)
    const ms = performance.now() - started
    expect(plan.stats.textObjects).toBeLessThan(600_000)
    expect(plan.stats.textObjects).toBeGreaterThan(0)
    expect(ms).toBeLessThan(20_000)
    // 大标签确实起作用了：比全逐格少了两个数量级
    expect(plan.labels.length).toBeGreaterThan(1000)
  })

  it('同一份 grid 两次规划完全一致（两套渲染共用的回归测试）', () => {
    const grid = createGrid(40, 40)
    for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) grid.cells[y * 40 + x] = 3
    const a = planAnnotations(grid, emptyPalette, 2.6)
    const b = planAnnotations(grid, emptyPalette, 2.6)
    expect(a.stats).toEqual(b.stats)
    expect(a.labels).toEqual(b.labels)
    expect(a.cellMarks).toEqual(b.cellMarks)
  })
})
