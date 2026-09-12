import { EMPTY, type CellGrid } from '../domain/grid'
import { type Palette, labelTextColor } from '../domain/palette'
import { CODE_ZOOM, GRID_ZOOM, type Viewport, visibleRange } from './canvasViewport'
import { BITMAP_THRESHOLD, type GridBitmap } from './gridBitmap'
import type { Selection } from '../editor/selection'

export { BOARD_BG, CURSOR_COLOR, HOLE_BG, SEAM_COLOR, SELECTION_COLOR, STAGE_BG } from './colors'
import { BOARD_BG, CURSOR_COLOR, HOLE_BG, SEAM_COLOR, SELECTION_COLOR, STAGE_BG } from './colors'

export interface DrawPatternOptions {
  grid: CellGrid
  palette: Palette
  vp: Viewport
  /** CSS 像素尺寸 */
  width: number
  height: number
  showCodes: boolean
  /** 每次改动 +1，位图缓存靠它判断要不要重新烘焙 */
  version: number
  selection?: Selection
  /** 进行中的笔画：index → 色板索引，覆盖 grid 里的值 */
  pending?: Map<number, number> | null
  /** 每块板在豆格坐标里的矩形。自由拼板时板缝不是整条贯穿的线，只能按块画 */
  boards?: Array<{ c0: number; r0: number; cw: number; rh: number }>
  /** 板没盖到的格子（自由拼板的外接框空档），画成"没有板"的样子 */
  placeable?: Uint8Array | null
  bitmap?: GridBitmap | null
  /**
   * 跟做模式：只高亮某一个色号，其余变淡（不是隐藏）。
   * completed 里标 1 的格子是已经拼完的，也画淡。
   */
  focus?: { colorIndex: number | null; completed?: Uint8Array | null } | null
}

/**
 * 只画可见的一屏：先按 visibleRange 裁，再遍历。
 * 500 万格时一屏只画 ~2 万格；缩到整图铺满时改走位图缓存（见 gridBitmap.ts）。
 */
export function drawPattern(ctx: CanvasRenderingContext2D, o: DrawPatternOptions): void {
  const { grid, palette, vp, width, height } = o
  const z = vp.zoom

  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0)
  ctx.fillStyle = STAGE_BG
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = BOARD_BG
  ctx.fillRect(vp.panX, vp.panY, grid.cols * z, grid.rows * z)

  const { c0, c1, r0, r1 } = visibleRange(vp, grid.cols, grid.rows, width, height)
  const pending = o.pending ?? null
  const visibleCells = Math.max(0, (c1 - c0) * (r1 - r0))

  let drawn = false
  if (o.bitmap && visibleCells > BITMAP_THRESHOLD) {
    o.bitmap.ensure(grid, palette, o.version)
    drawn = o.bitmap.draw(ctx, vp, width, height)
  }
  if (drawn) {
    if (pending?.size) drawPending(ctx, o, pending)
  } else {
    drawCells(ctx, o, c0, c1, r0, r1, pending)
  }

  if (z >= GRID_ZOOM) drawLines(ctx, o, c0, c1, r0, r1)
  if (z >= CODE_ZOOM && o.showCodes) drawCodes(ctx, o, c0, c1, r0, r1, pending)
  if (o.placeable) drawHoles(ctx, o, c0, c1, r0, r1)
  if (o.boards?.length) drawBoardFrames(ctx, o)
  if (o.selection?.length) drawSelection(ctx, o, o.selection)
}

/** 单格填充（覆盖层画进行中的笔画用它） */
export function fillCellRect(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  col: number,
  row: number,
  hex: string,
): void {
  const z = vp.zoom
  const x = Math.round(vp.panX + col * z)
  const x2 = Math.round(vp.panX + (col + 1) * z)
  const y = Math.round(vp.panY + row * z)
  const y2 = Math.round(vp.panY + (row + 1) * z)
  ctx.fillStyle = hex
  ctx.fillRect(x, y, x2 - x, y2 - y)
}

/** 光标格高亮框 */
export function drawCursorBox(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  col: number,
  row: number,
): void {
  const z = vp.zoom
  ctx.strokeStyle = CURSOR_COLOR
  ctx.lineWidth = 1
  ctx.strokeRect(
    Math.round(vp.panX + col * z) + 0.5,
    Math.round(vp.panY + row * z) + 0.5,
    Math.round(z),
    Math.round(z),
  )
}

function cellValue(o: DrawPatternOptions, i: number, pending: Map<number, number> | null): number {
  return pending ? (pending.get(i) ?? o.grid.cells[i]) : o.grid.cells[i]
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  o: DrawPatternOptions,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  pending: Map<number, number> | null,
): void {
  const { grid, palette } = o
  const hexes = palette.colors.map((c) => c.hex)
  const focus = o.focus ?? null
  let lastFill = ''
  let alpha = 1
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const v = cellValue(o, r * grid.cols + c, pending)
      if (v === EMPTY) continue
      // 跟做模式：非焦点色和已完成的格子都画淡
      const nextAlpha = !focus
        ? 1
        : focus.colorIndex !== null && v !== focus.colorIndex
          ? 0.12
          : focus.completed?.[r * grid.cols + c]
            ? 0.25
            : 1
      if (nextAlpha !== alpha) {
        ctx.globalAlpha = nextAlpha
        alpha = nextAlpha
      }
      const hex = hexes[v] ?? '#888888'
      if (hex !== lastFill) {
        ctx.fillStyle = hex
        lastFill = hex
      }
      const x = Math.round(o.vp.panX + c * o.vp.zoom)
      const x2 = Math.round(o.vp.panX + (c + 1) * o.vp.zoom)
      const y = Math.round(o.vp.panY + r * o.vp.zoom)
      const y2 = Math.round(o.vp.panY + (r + 1) * o.vp.zoom)
      ctx.fillRect(x, y, x2 - x, y2 - y)
    }
  }
  if (alpha !== 1) ctx.globalAlpha = 1
}

/** 位图路径下，进行中的笔画只有几个格子，单独补画 */
function drawPending(
  ctx: CanvasRenderingContext2D,
  o: DrawPatternOptions,
  pending: Map<number, number>,
): void {
  const { grid, palette } = o
  for (const [i, v] of pending) {
    const col = i % grid.cols
    const row = (i - col) / grid.cols
    fillCellRect(ctx, o.vp, col, row, palette.colors[v]?.hex ?? BOARD_BG)
  }
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  o: DrawPatternOptions,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
): void {
  const { vp, grid } = o
  const z = vp.zoom
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 1 / vp.dpr
  ctx.beginPath()
  for (let c = Math.max(0, c0); c <= Math.min(grid.cols, c1); c++) {
    const x = Math.round(vp.panX + c * z) + 0.5
    ctx.moveTo(x, Math.max(vp.panY, 0))
    ctx.lineTo(x, Math.min(vp.panY + grid.rows * z, o.height))
  }
  for (let r = Math.max(0, r0); r <= Math.min(grid.rows, r1); r++) {
    const y = Math.round(vp.panY + r * z) + 0.5
    ctx.moveTo(Math.max(vp.panX, 0), y)
    ctx.lineTo(Math.min(vp.panX + grid.cols * z, o.width), y)
  }
  ctx.stroke()
}

function drawCodes(
  ctx: CanvasRenderingContext2D,
  o: DrawPatternOptions,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  pending: Map<number, number> | null,
): void {
  const { grid, palette, vp } = o
  const z = vp.zoom
  const size = Math.min(z * 0.6, 30)
  if (size < 7) return
  ctx.font = `${size}px ui-monospace, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(1, size * 0.12)
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const color = palette.colors[cellValue(o, r * grid.cols + c, pending)]
      if (!color) continue
      const x = vp.panX + (c + 0.5) * z
      const y = vp.panY + (r + 0.5) * z
      const light = labelTextColor(color.hex) === 'black'
      // 中间调加一圈反色描边，否则黑白都不够清楚（第 7.8 节 ⑤）
      ctx.strokeStyle = light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)'
      ctx.strokeText(color.code, x, y)
      ctx.fillStyle = light ? '#000000' : '#FFFFFF'
      ctx.fillText(color.code, x, y)
    }
  }
}

/** 每块板画一圈边框：板可以错开摆，所以不能只画贯穿线 */
function drawBoardFrames(ctx: CanvasRenderingContext2D, o: DrawPatternOptions): void {
  const { vp } = o
  const z = vp.zoom
  ctx.strokeStyle = SEAM_COLOR
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  for (const b of o.boards ?? []) {
    const x = Math.round(vp.panX + b.c0 * z) + 0.5
    const y = Math.round(vp.panY + b.r0 * z) + 0.5
    ctx.rect(x, y, Math.round(b.cw * z), Math.round(b.rh * z))
  }
  ctx.stroke()
}

/** 空档：外接矩形里没有板的格子，画暗并打叉，明确"这儿不能放豆子" */
function drawHoles(
  ctx: CanvasRenderingContext2D,
  o: DrawPatternOptions,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
): void {
  const mask = o.placeable
  if (!mask) return
  const { vp, grid } = o
  const z = vp.zoom
  ctx.fillStyle = HOLE_BG
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (mask[r * grid.cols + c]) continue
      ctx.fillRect(Math.round(vp.panX + c * z), Math.round(vp.panY + r * z), Math.ceil(z), Math.ceil(z))
    }
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, o: DrawPatternOptions, sel: Selection): void {
  const { vp } = o
  const z = vp.zoom
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 3])
  for (const rect of sel) {
    ctx.strokeRect(
      Math.round(vp.panX + rect.c0 * z) + 0.5,
      Math.round(vp.panY + rect.r0 * z) + 0.5,
      Math.round((rect.c1 - rect.c0 + 1) * z),
      Math.round((rect.r1 - rect.r0 + 1) * z),
    )
  }
  ctx.setLineDash([])
}
