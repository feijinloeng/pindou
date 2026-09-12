import { describe, expect, it } from 'vitest'

import {
  BOARD_PROFILES,
  MAX_CELLS,
  WARN_CELLS,
  checkCanvasCells,
  deriveGeometry,
  deriveLayoutGeometry,
  layoutSizeMm,
  placementsFromArray,
  placementsSizeMm,
  validateBoardArray,
  validateLayout,
  type BoardArray,
  type BoardTypeId,
} from './board'

/** 造一个 r × c 的同型板矩阵 */
function grid(r: number, c: number, type: BoardTypeId): BoardArray {
  return {
    rows: Array.from({ length: r }, () => Array.from({ length: c }, () => type)),
    gapMm: 0,
  }
}

describe('板型表', () => {
  it('五种板型的钉数与针距', () => {
    expect(BOARD_PROFILES.mini26.pegs).toBe(26)
    expect(BOARD_PROFILES.mini52.pegs).toBe(52)
    expect(BOARD_PROFILES.mini78.pegs).toBe(78)
    expect(BOARD_PROFILES.mini104.pegs).toBe(104)
    expect(BOARD_PROFILES.midi29.pegs).toBe(29)
    expect(BOARD_PROFILES.midi29.pitchMm).toBe(5)
    expect(BOARD_PROFILES.mini104.pitchMm).toBe(2.6)
  })

  it('104 = 2 × 52，78 = 52 + 26（物理互通关系）', () => {
    expect(BOARD_PROFILES.mini104.pegs).toBe(2 * BOARD_PROFILES.mini52.pegs)
    expect(BOARD_PROFILES.mini78.pegs).toBe(
      BOARD_PROFILES.mini52.pegs + BOARD_PROFILES.mini26.pegs,
    )
  })
})

describe('deriveGeometry', () => {
  it('3×3 个 mini52 → 156 × 156，板缝在 52 / 104', () => {
    const g = deriveGeometry(grid(3, 3, 'mini52'))
    expect(g.cols).toBe(156)
    expect(g.rows).toBe(156)
    expect(g.seamCols).toEqual([52, 104])
    expect(g.seamRows).toEqual([52, 104])
    expect(g.boards).toHaveLength(9)
  })

  it('1×6 个 mini52 → 312 × 52，无水平板缝', () => {
    const g = deriveGeometry(grid(1, 6, 'mini52'))
    expect(g.cols).toBe(312)
    expect(g.rows).toBe(52)
    expect(g.seamRows).toEqual([])
    expect(g.seamCols).toEqual([52, 104, 156, 208, 260])
    expect(g.boards).toHaveLength(6)
  })

  it('mini104 两块并排 → 208 × 104，板缝在 104', () => {
    const g = deriveGeometry(grid(1, 2, 'mini104'))
    expect(g.cols).toBe(208)
    expect(g.rows).toBe(104)
    expect(g.seamCols).toEqual([104])
    expect(g.seamRows).toEqual([])
    expect(g.boards).toHaveLength(2)
  })

  it('不同带高可以混搭：一条 104 带 + 一条 52 带', () => {
    // 104 × 2 = 208 宽；4 块 52 = 208 宽。两条带各自等高，所以豆格刚好铺满
    const g = deriveGeometry({
      rows: [
        ['mini104', 'mini104'],
        ['mini52', 'mini52', 'mini52', 'mini52'],
      ],
      gapMm: 0,
    })
    expect(g.cols).toBe(208)
    expect(g.rows).toBe(156)
    expect(g.seamCols).toEqual([104])
    expect(g.seamRows).toEqual([104])
    expect(g.boards).toHaveLength(6)
    // 每块板的豆格矩形之和 = 整张画布，没有空洞
    const area = g.boards.reduce((n, b) => n + b.cw * b.rh, 0)
    expect(area).toBe(g.cols * g.rows)
  })

  it('板缝在 0 和 cols/rows 上不出现', () => {
    const g = deriveGeometry(grid(1, 1, 'mini52'))
    expect(g.seamCols).toEqual([])
    expect(g.seamRows).toEqual([])
  })
})

describe('validateBoardArray', () => {
  it('合法板阵返回 null', () => {
    expect(validateBoardArray(grid(3, 3, 'mini52'))).toBeNull()
    expect(validateBoardArray(grid(2, 2, 'mini104'))).toBeNull()
    expect(
      validateBoardArray({
        rows: [
          ['mini104', 'mini104'],
          ['mini52', 'mini52', 'mini52', 'mini52'],
        ],
        gapMm: 0,
      }),
    ).toBeNull()
  })

  it('行钉数不一致时拒绝：[[52,52],[52,26]]', () => {
    expect(
      validateBoardArray({
        rows: [
          ['mini52', 'mini52'],
          ['mini52', 'mini26'],
        ],
        gapMm: 0,
      })?.kind,
    ).toBe('row-mismatch')
  })

  it('同一行混不同钉数的板时拒绝：[[52,26],[52,26]] 行和都是 78，但右上角留空洞', () => {
    expect(
      validateBoardArray({
        rows: [
          ['mini52', 'mini26'],
          ['mini52', 'mini26'],
        ],
        gapMm: 0,
      })?.kind,
    ).toBe('row-height-mismatch')
  })

  it('[[78,26]] 同理拒绝：78 与 26 不能在同一行里相邻收口', () => {
    expect(validateBoardArray({ rows: [['mini78', 'mini26']], gapMm: 0 })?.kind).toBe(
      'row-height-mismatch',
    )
  })

  it('楼梯形被拒绝：[[104,26],[26,104]] 行和列和都相等，但豆格铺不满', () => {
    expect(
      validateBoardArray({
        rows: [
          ['mini104', 'mini26'],
          ['mini26', 'mini104'],
        ],
        gapMm: 0,
      })?.kind,
    ).toBe('row-height-mismatch')
  })

  it('列和一致与铺满，是前三条规则的推论（防以后改坏）', () => {
    const cases: BoardArray[] = [
      grid(3, 3, 'mini52'),
      grid(1, 6, 'mini52'),
      grid(2, 2, 'mini104'),
      {
        rows: [
          ['mini104', 'mini104'],
          ['mini52', 'mini52', 'mini52', 'mini52'],
        ],
        gapMm: 0,
      },
    ]
    for (const a of cases) {
      const g = deriveGeometry(a)
      const colSums = a.rows[0].map((_, c) =>
        a.rows.reduce((n, line) => n + BOARD_PROFILES[line[c]].pegs, 0),
      )
      expect(new Set(colSums).size).toBe(1) // 每列钉数和相等
      expect(colSums[0]).toBe(g.rows)
      // 每块板的矩形面积之和 = 整张画布：没重叠也没空洞
      expect(g.boards.reduce((n, b) => n + b.cw * b.rh, 0)).toBe(g.cols * g.rows)
    }
  })

  it('针距混合时拒绝：mini52 + midi29', () => {
    expect(validateBoardArray({ rows: [['mini52'], ['midi29']], gapMm: 0 })?.kind).toBe(
      'mixed-pitch',
    )
  })

  it('空板阵被拒绝', () => {
    expect(validateBoardArray({ rows: [], gapMm: 0 })?.kind).toBe('empty')
    expect(validateBoardArray({ rows: [[]], gapMm: 0 })?.kind).toBe('empty')
  })

  it('deriveGeometry 对非法板阵抛错', () => {
    expect(() => deriveGeometry({ rows: [['mini52'], ['midi29']], gapMm: 0 })).toThrow()
    expect(() =>
      deriveGeometry({
        rows: [
          ['mini52', 'mini26'],
          ['mini52', 'mini26'],
        ],
        gapMm: 0,
      }),
    ).toThrow()
  })
})

describe('画布上限', () => {
  it('3m × 3m @2.6mm（1153 × 1153 = 1,329,409）通过', () => {
    expect(1153 * 1153).toBe(1_329_409)
    expect(checkCanvasCells(1153, 1153)).toBeNull()
  })

  it('上限边界：2236² 通过，2237² 报错', () => {
    expect(2236 * 2236).toBe(4_999_696)
    expect(checkCanvasCells(2236, 2236)).toBeNull()
    expect(checkCanvasCells(2237, 2237)?.kind).toBe('too-large')
  })

  it('0 / 负数 / 小数 / NaN 都算尺寸非法，不只看上限', () => {
    expect(checkCanvasCells(0, 10)?.kind).toBe('bad-size')
    expect(checkCanvasCells(10, 0)?.kind).toBe('bad-size')
    expect(checkCanvasCells(-3, 4)?.kind).toBe('bad-size')
    expect(checkCanvasCells(4.5, 4)?.kind).toBe('bad-size')
    expect(checkCanvasCells(Number.NaN, 4)?.kind).toBe('bad-size')
    expect(checkCanvasCells(Number.POSITIVE_INFINITY, 4)?.kind).toBe('bad-size')
  })

  it('上限常量：5,000,000 格，1,500,000 格开始警告', () => {
    expect(MAX_CELLS).toBe(5_000_000)
    expect(WARN_CELLS).toBe(1_500_000)
  })

  it('超大板阵在 validateBoardArray 里就被拦住', () => {
    // 86 × 86 块 26 板 = 2236 × 2236（临界通过），87 块 = 2262 就超了
    expect(validateBoardArray(grid(86, 86, 'mini26'))).toBeNull()
    expect(validateBoardArray(grid(87, 87, 'mini26'))?.kind).toBe('too-large')
  })
})

describe('外部输入的畸形数据（工程文件是信任边界）', () => {
  it('不认识的板型给结构化错误，不是 TypeError', () => {
    const bad = { rows: [['mini52', 'not-a-board']], gapMm: 0 } as unknown as BoardArray
    expect(validateBoardArray(bad)?.kind).toBe('unknown-board')
    expect(() => deriveGeometry(bad)).toThrow('不认识这个板型')
  })

  it('参差数组 / 空行不再在查表时抛底层异常', () => {
    const ragged = { rows: [['mini52'], []], gapMm: 0 } as BoardArray
    expect(validateBoardArray(ragged)?.kind).toBe('ragged')
    const notArray = { rows: [['mini52'], null], gapMm: 0 } as unknown as BoardArray
    expect(validateBoardArray(notArray)?.kind).toBe('ragged')
  })

  it('validateLayout：未知板型 / 负坐标 / 小数坐标都报结构化错误', () => {
    expect(
      validateLayout({ placements: [{ board: 'nope' as BoardTypeId, col: 0, row: 0 }], gapMm: 0 })
        ?.kind,
    ).toBe('unknown-board')
    expect(
      validateLayout({ placements: [{ board: 'mini52', col: -1, row: 0 }], gapMm: 0 })?.kind,
    ).toBe('bad-placement')
    expect(
      validateLayout({ placements: [{ board: 'mini52', col: 1.5, row: 0 }], gapMm: 0 })?.kind,
    ).toBe('bad-placement')
    expect(validateLayout({ placements: [], gapMm: 0 })?.kind).toBe('empty')
    expect(
      validateLayout({
        placements: [
          { board: 'mini52', col: 0, row: 0 },
          { board: 'midi29', col: 52, row: 0 },
        ],
        gapMm: 0,
      })?.kind,
    ).toBe('mixed-pitch')
  })

  it('deriveLayoutGeometry 对小数尺寸的板阵不再算出半个格子', () => {
    expect(() =>
      deriveLayoutGeometry({ placements: [{ board: 'mini52', col: 0.5, row: 0 }], gapMm: 0 }),
    ).toThrow('整数格坐标')
  })
})

describe('gapMm 进入物理尺寸（第 11 节：1:1 打印要准）', () => {
  const side = (gap: number) => ({
    placements: [
      { board: 'mini52' as const, col: 0, row: 0 },
      { board: 'mini52' as const, col: 52, row: 0 },
    ],
    gapMm: gap,
  })

  it('gap=0 时就是豆格数 × 针距', () => {
    const geom = deriveLayoutGeometry(side(0))
    expect(geom.gapMm).toBe(0)
    expect(layoutSizeMm(geom).w).toBeCloseTo(104 * 2.6, 6)
  })

  it('gap=1 时两块板之间多出 1mm', () => {
    const geom = deriveLayoutGeometry(side(1))
    expect(geom.gapMm).toBe(1)
    // 104 个针距 + 1 条板缝
    expect(layoutSizeMm(geom).w).toBeCloseTo(104 * 2.6 + 1, 6)
    expect(layoutSizeMm(geom).h).toBeCloseTo(52 * 2.6, 6)
  })

  it('摆放列表版（作品库卡片用）算出同样的尺寸', () => {
    expect(placementsSizeMm(side(1).placements, 1).w).toBeCloseTo(104 * 2.6 + 1, 6)
    expect(placementsSizeMm(placementsFromArray(grid(1, 1, 'mini52')), 0).w).toBeCloseTo(135.2, 6)
  })

  it('板号是稳定序号，不是假的行列坐标', () => {
    const geom = deriveLayoutGeometry({
      placements: [
        { board: 'mini52', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    })
    expect(geom.boards.map((b) => b.index)).toEqual([0, 1])
  })
})
