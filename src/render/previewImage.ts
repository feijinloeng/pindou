import { EMPTY, type CellGrid } from '../domain/grid'
import { type Palette, shadeHex } from '../domain/palette'

/**
 * 预览图（第 11.1 节）：给客户看"像不像"的普通位图。
 * 渲染成**圆豆 + 孔 + 底板底色**，不是方格 —— 客户得看到成品的样子。
 */
export const PREVIEW_SCALES = { standard: 8, hd: 16, print: 32 } as const
export type PreviewScale = keyof typeof PREVIEW_SCALES

export const MAX_PREVIEW_SIDE = 16384
export const MAX_PREVIEW_PIXELS = 100_000_000
export const PEGBOARD_BG = '#FAFAF8'

export interface PreviewOptions {
  grid: CellGrid
  palette: Palette
  /** 每格多少像素 */
  pxPerCell: number
  showCoords?: boolean
}

export interface PreviewPlan {
  pxPerCell: number
  width: number
  height: number
  /** 被上限压过（要告诉用户） */
  clamped: boolean
}

/** 算出最终像素尺寸；超过上限就等比降下来 */
export function planPreview(grid: CellGrid, pxPerCell: number): PreviewPlan {
  const side = Math.max(grid.cols, grid.rows)
  let scale = pxPerCell
  if (side * scale > MAX_PREVIEW_SIDE) scale = MAX_PREVIEW_SIDE / side
  if (grid.cols * grid.rows * scale * scale > MAX_PREVIEW_PIXELS) {
    scale = Math.sqrt(MAX_PREVIEW_PIXELS / (grid.cols * grid.rows))
  }
  const width = Math.max(1, Math.round(grid.cols * scale))
  const height = Math.max(1, Math.round(grid.rows * scale))
  return { pxPerCell: scale, width, height, clamped: scale < pxPerCell }
}

/**
 * 画预览图。豆是圆，孔是更暗的同色圆，空格留底板底色。
 * 逐格 arc：4000×4000 的图大约 25 万颗豆，1-2 秒能画完。
 */
export function drawPreview(ctx: CanvasRenderingContext2D, options: PreviewOptions): PreviewPlan {
  const { grid, palette } = options
  const plan = planPreview(grid, options.pxPerCell)
  const z = plan.pxPerCell
  const beadRadius = z * 0.46
  const holeRadius = z * 0.22
  const drawHoles = z >= 6

  ctx.canvas.width = plan.width
  ctx.canvas.height = plan.height
  ctx.fillStyle = PEGBOARD_BG
  ctx.fillRect(0, 0, plan.width, plan.height)

  const holeColors = palette.colors.map((c) => shadeHex(c.hex, 0.68))

  for (let y = 0; y < grid.rows; y++) {
    const cy = (y + 0.5) * z
    for (let x = 0; x < grid.cols; x++) {
      const value = grid.cells[y * grid.cols + x]
      if (value === EMPTY) continue
      const color = palette.colors[value]
      if (!color) continue
      const cx = (x + 0.5) * z
      ctx.fillStyle = color.hex
      ctx.beginPath()
      ctx.arc(cx, cy, beadRadius, 0, Math.PI * 2)
      ctx.fill()
      if (drawHoles) {
        ctx.fillStyle = holeColors[value]
        ctx.beginPath()
        ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  if (options.showCoords) {
    ctx.fillStyle = '#666666'
    ctx.font = `${Math.max(8, z * 0.8)}px ui-monospace, Menlo, monospace`
    for (let x = 0; x < grid.cols; x += 10) ctx.fillText(String(x), x * z + 2, 12)
    for (let y = 0; y < grid.rows; y += 10) ctx.fillText(String(y), 2, y * z + 12)
  }

  return plan
}
