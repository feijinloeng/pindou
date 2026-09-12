import type { CellGrid } from '../domain/grid'
import { EMPTY, isPlaceable } from '../domain/grid'
import type { Palette } from '../domain/palette'
import { BOARD_BG } from './colors'

/**
 * 作品库的缩略图：直接从 grid 生成，不需要重算图案（第 14.2 节）。
 * 缩略图不画圆豆（太慢），就是纯色方块。
 */
export function renderThumbnailDataUrl(
  grid: CellGrid,
  palette: Palette,
  maxPx = 160,
): string | null {
  if (typeof document === 'undefined') return null
  const scale = Math.min(maxPx / grid.cols, maxPx / grid.rows, 8)
  const width = Math.max(1, Math.round(grid.cols * scale))
  const height = Math.max(1, Math.round(grid.rows * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = BOARD_BG
  ctx.fillRect(0, 0, width, height)

  const cell = Math.max(1, Math.ceil(scale))
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const value = grid.cells[y * grid.cols + x]
      if (value === EMPTY || !isPlaceable(grid, y * grid.cols + x)) continue
      const color = palette.colors[value]
      if (!color) continue
      ctx.fillStyle = color.hex
      ctx.fillRect(
        Math.floor(x * scale),
        Math.floor(y * scale),
        Math.min(cell, width - Math.floor(x * scale)),
        Math.min(cell, height - Math.floor(y * scale)),
      )
    }
  }
  return canvas.toDataURL('image/webp', 0.8)
}
