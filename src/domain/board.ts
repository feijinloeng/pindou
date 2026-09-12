export type PitchMm = 2.6 | 5
export type BoardTypeId = 'mini26' | 'mini52' | 'mini78' | 'mini104' | 'midi29'

function fill(r: number, c: number, type: BoardTypeId): BoardArray {
  return {
    rows: Array.from({ length: r }, () => Array.from({ length: c }, () => type)),
    gapMm: 0,
  }
}

/** 常用板阵。编辑器开箱就用这些，省得先填矩阵 */
export const BOARD_PRESETS: Array<{ id: string; label: string; array: BoardArray }> = [
  { id: '52-1', label: '1 块 52（52×52）', array: fill(1, 1, 'mini52') },
  { id: '52-3x3', label: '3×3 个 52（156×156）', array: fill(3, 3, 'mini52') },
  { id: '52-1x6', label: '1×6 个 52 带鱼屏（312×52）', array: fill(1, 6, 'mini52') },
  { id: '104-2', label: '104 两块并排（208×104）', array: fill(1, 2, 'mini104') },
  { id: '104-2x2', label: '2×2 个 104（208×208）', array: fill(2, 2, 'mini104') },
  {
    id: 'mixed-band',
    label: '混搭：一条 104 带 + 一条 52 带（208×156）',
    array: {
      rows: [
        ['mini104', 'mini104'],
        ['mini52', 'mini52', 'mini52', 'mini52'],
      ],
      gapMm: 0,
    },
  },
  {
    id: 'stress-26-86',
    label: '压测：86×86 个 26 板（2236×2236 = 500 万格）',
    array: fill(86, 86, 'mini26'),
  },
  {
    id: 'stress-26-44',
    label: '压测：44×44 个 26 板（1144×1144 = 131 万格）',
    array: fill(44, 44, 'mini26'),
  },
]

export interface BoardProfile {
  id: BoardTypeId
  /** 钉数（正方形板） */
  pegs: number
  pitchMm: PitchMm
  /** 厂家标注的外框尺寸；仅用于展示，不参与任何计算 */
  outerMm: number
  label: string
}

export const BOARD_PROFILES: Record<BoardTypeId, BoardProfile> = {
  mini26: { id: 'mini26', pegs: 26, pitchMm: 2.6, outerMm: 75.0, label: '2.6mm · 26×26' },
  mini52: { id: 'mini52', pegs: 52, pitchMm: 2.6, outerMm: 144.0, label: '2.6mm · 52×52' },
  mini78: { id: 'mini78', pegs: 78, pitchMm: 2.6, outerMm: 210.0, label: '2.6mm · 78×78' },
  mini104: { id: 'mini104', pegs: 104, pitchMm: 2.6, outerMm: 280.0, label: '2.6mm · 104×104' },
  midi29: { id: 'midi29', pegs: 29, pitchMm: 5, outerMm: 145.0, label: '5mm · 29×29' },
}

/** 画布上限：约 2236²，5.8m × 5.8m @2.6mm */
export const MAX_CELLS = 5_000_000
/** 超过这个数提示用户"建议改用 5mm 豆" */
export const WARN_CELLS = 1_500_000

/**
 * 板阵 = 一个二维板矩阵，不是自由列表。
 * 行与行、列与列的总钉数必须一致，才能保证针区是干净的矩形、板缝是笔直的。
 * 矩阵里不允许 null —— v1 不支持 L 形等不规则板阵。
 */
export interface BoardArray {
  /** rows[r][c] = 板型 id */
  rows: BoardTypeId[][]
  /** 板与板之间的实际间隙（mm）。实测为零时保持 0。 */
  gapMm: number
}

export interface BoardRect {
  row: number
  col: number
  board: BoardTypeId
  c0: number
  r0: number
  cw: number
  rh: number
}

export interface BoardGeometry {
  /** 豆格列数 */
  cols: number
  /** 豆格行数 */
  rows: number
  pitchMm: number
  /** 贯穿整幅的垂直板缝列号（自由摆放时可能为空，看 boards 才准） */
  seamCols: number[]
  /** 贯穿整幅的水平板缝行号 */
  seamRows: number[]
  /** 每块板在豆格坐标里的矩形，用于"按板导出"和画板框 */
  boards: BoardRect[]
  /**
   * 哪些格子底下有板（1 = 有，0 = 空档）。
   * 自由拼板时外接矩形里会有空档，那些格子不属于作品：
   * 不许画、不许转换、渲染时按"没有板"画。
   */
  placeable: Uint8Array
}

/**
 * 自由拼板：一块板放在豆格坐标的哪个位置。
 * 不要求行列对齐 —— 想拼成 L 形、阶梯形都行，外接矩形里的空档会被标记成不可用。
 */
export interface BoardPlacement {
  board: BoardTypeId
  /** 左上角所在豆格列 */
  col: number
  /** 左上角所在豆格行 */
  row: number
}

export interface BoardLayout {
  placements: BoardPlacement[]
  /** 板与板之间的实际间隙（mm）。实测为零时保持 0。 */
  gapMm: number
}

export type BoardLayoutError =
  | { kind: 'empty' }
  | { kind: 'mixed-pitch'; pitches: number[] }
  | { kind: 'overlap'; first: BoardPlacement; second: BoardPlacement }
  | { kind: 'too-large'; cols: number; rows: number; max: number }

/** 矩阵板阵 → 自由摆放列表（老工程和预设走这条路） */
export function placementsFromArray(array: BoardArray): BoardPlacement[] {
  const bandRows = bandHeights(array.rows)
  const out: BoardPlacement[] = []
  for (let r = 0, r0 = 0; r < array.rows.length; r++) {
    for (let c = 0, c0 = 0; c < array.rows[r].length; c++) {
      out.push({ board: array.rows[r][c], col: c0, row: r0 })
      c0 += BOARD_PROFILES[array.rows[r][c]].pegs
    }
    r0 += bandRows[r]
  }
  return out
}

export function describeLayoutError(err: BoardLayoutError): string {
  switch (err.kind) {
    case 'empty':
      return '还没放板子：先在左边点一个型号，拖到中间的台面上'
    case 'mixed-pitch':
      return `不能混用不同针距的板：${err.pitches.map((p) => `${p}mm`).join(' / ')}`
    case 'overlap':
      return '这两块板叠在一起了，挪开一点'
    case 'too-large':
      return `拼出来是 ${err.cols} × ${err.rows} = ${(err.cols * err.rows).toLocaleString()} 格，超过上限 ${err.max.toLocaleString()} 格`
  }
}

/**
 * 自由摆放的校验：不空 / 同针距 / 不重叠 / 不超上限。
 * 重叠检查顺便把 placeable 遮罩建出来，所以和推导几何合并成一次扫描。
 */
export function deriveLayoutGeometry(layout: BoardLayout): BoardGeometry {
  const placements = layout.placements
  if (placements.length === 0) throw new Error(describeLayoutError({ kind: 'empty' }))

  const pitches = [...new Set(placements.map((p) => BOARD_PROFILES[p.board].pitchMm))]
  if (pitches.length > 1) {
    throw new Error(describeLayoutError({ kind: 'mixed-pitch', pitches }))
  }

  let cols = 0
  let rows = 0
  for (const p of placements) {
    const pegs = BOARD_PROFILES[p.board].pegs
    cols = Math.max(cols, p.col + pegs)
    rows = Math.max(rows, p.row + pegs)
    if (p.col < 0 || p.row < 0) throw new Error('板的位置不能是负数')
  }

  const size = checkCanvasCells(cols, rows)
  if (size) throw new Error(describeLayoutError({ kind: 'too-large', cols, rows, max: MAX_CELLS }))

  const placeable = new Uint8Array(cols * rows)
  /** 每格属于第几块板，用来查重叠和算板缝 */
  const owner = new Int32Array(cols * rows).fill(-1)
  const boards: BoardRect[] = []
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]
    const pegs = BOARD_PROFILES[p.board].pegs
    for (let y = p.row; y < p.row + pegs; y++) {
      const base = y * cols
      for (let x = p.col; x < p.col + pegs; x++) {
        const taken = owner[base + x]
        if (taken >= 0) {
          throw new Error(
            describeLayoutError({ kind: 'overlap', first: placements[taken], second: p }),
          )
        }
        owner[base + x] = i
        placeable[base + x] = 1
      }
    }
    boards.push({ row: 0, col: i, board: p.board, c0: p.col, r0: p.row, cw: pegs, rh: pegs })
  }

  // 贯穿整幅的板缝：某一个 x 在【每一行】上都是板与板的分界。
  // 只按"既是某块板的左边又是另一块的右边"判断会多报 —— 下面那半张里的板缝
  // 在上半张并不存在（[[104,104],[52,52,52,52]] 就是这种情况）。
  const verticalCuts = new Set<number>()
  for (let x = 1; x < cols; x++) verticalCuts.add(x)
  for (let y = 0; y < rows; y++) {
    const base = y * cols
    for (let x = 1; x < cols; x++) {
      if (!verticalCuts.has(x)) continue
      if (owner[base + x] === owner[base + x - 1]) verticalCuts.delete(x)
    }
  }
  const horizontalCuts = new Set<number>()
  for (let y = 1; y < rows; y++) horizontalCuts.add(y)
  for (let y = 1; y < rows; y++) {
    const base = y * cols
    for (let x = 0; x < cols; x++) {
      if (!horizontalCuts.has(y)) continue
      if (owner[base + x] === owner[base - cols + x]) horizontalCuts.delete(y)
    }
  }

  return {
    cols,
    rows,
    pitchMm: pitches[0],
    seamCols: [...verticalCuts].sort((a, b) => a - b),
    seamRows: [...horizontalCuts].sort((a, b) => a - b),
    boards,
    placeable,
  }
}

export type BoardArrayError =
  | { kind: 'empty' }
  | { kind: 'mixed-pitch'; pitches: number[] }
  | { kind: 'row-mismatch'; row: number; expected: number; got: number }
  | { kind: 'row-height-mismatch'; row: number; col: number }
  | { kind: 'too-large'; cols: number; rows: number; max: number }

/** 格数上限检查。1153² 通过，2237² 报错。 */
export function checkCanvasCells(cols: number, rows: number): BoardArrayError | null {
  if (cols * rows > MAX_CELLS) return { kind: 'too-large', cols, rows, max: MAX_CELLS }
  return null
}

/**
 * 合法性校验，四条：同针距 / 每行钉数和相等 / 同一行的板等高 / 格数上限。
 *
 * 第一条给出 cols，第二、三条一起保证豆格矩形恰好铺满：行和相等保证每行横向铺满，
 * 等高保证各带竖直方向无缝。少了等高这一条，[[104,26],[26,104]] 这种"楼梯形"
 * 会通过其余检查，但豆格矩形根本盖不满整张画布，针区中间会留下空洞。
 * 前三条过了之后，第 3.1 节说的"每列钉数和相等"自动成立（每列 = Σ 各带高）。
 */
export function validateBoardArray(array: BoardArray): BoardArrayError | null {
  const { rows } = array
  if (rows.length === 0 || rows[0].length === 0) return { kind: 'empty' }

  // 1. 同针距
  const pitches = [...new Set(rows.flat().map((id) => BOARD_PROFILES[id].pitchMm))]
  if (pitches.length > 1) return { kind: 'mixed-pitch', pitches }

  // 2. 每行钉数和相等 → cols
  const rowSums = rows.map((line) => line.reduce((n, id) => n + BOARD_PROFILES[id].pegs, 0))
  const cols = rowSums[0]
  const badRow = rowSums.findIndex((n) => n !== cols)
  if (badRow >= 0) {
    return { kind: 'row-mismatch', row: badRow, expected: cols, got: rowSums[badRow] }
  }

  // 3. 同一行的板等高，否则那一带的右端会留空洞
  for (let r = 0; r < rows.length; r++) {
    const bad = rows[r].findIndex(
      (id) => BOARD_PROFILES[id].pegs !== BOARD_PROFILES[rows[r][0]].pegs,
    )
    if (bad >= 0) return { kind: 'row-height-mismatch', row: r, col: bad }
  }

  // 4. 格数上限
  return checkCanvasCells(cols, bandHeights(rows).reduce((a, b) => a + b, 0))
}

/** 每带高度（同一行等高，所以取该行第一块） */
function bandHeights(rows: BoardTypeId[][]): number[] {
  return rows.map((line) => BOARD_PROFILES[line[0]].pegs)
}

export function describeBoardArrayError(err: BoardArrayError): string {
  switch (err.kind) {
    case 'empty':
      return '板阵是空的'
    case 'mixed-pitch':
      return `不能混用不同针距的板：${err.pitches.join('mm / ')}mm`
    case 'row-mismatch':
      return `第 ${err.row + 1} 行的钉数是 ${err.got}，其它行是 ${err.expected}。整行钉数必须相等。`
    case 'row-height-mismatch':
      return `第 ${err.row + 1} 行里混了不同钉数的板（第 ${err.col + 1} 块），同一行的板必须等高。`
    case 'too-large':
      return `板阵是 ${err.cols} × ${err.rows} = ${(err.cols * err.rows).toLocaleString()} 格，超过上限 ${err.max.toLocaleString()} 格`
  }
}


/** 推导豆格尺寸、板缝位置、每块板的豆格矩形。板阵非法时抛错。 */
export function deriveGeometry(array: BoardArray): BoardGeometry {
  const err = validateBoardArray(array)
  if (err) throw new Error(describeBoardArrayError(err))
  return deriveLayoutGeometry({ placements: placementsFromArray(array), gapMm: array.gapMm })
}

/** 板阵的物理尺寸（mm），用于界面上显示"拼出来多大" */
export function layoutSizeMm(geom: BoardGeometry): { w: number; h: number } {
  return { w: geom.cols * geom.pitchMm, h: geom.rows * geom.pitchMm }
}
