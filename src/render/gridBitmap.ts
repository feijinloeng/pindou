import { EMPTY, type CellGrid } from '../domain/grid'
import { type Palette, hexToRgb } from '../domain/palette'
import { BOARD_BG } from './drawPattern'
import type { Viewport } from './canvasViewport'

/**
 * 缩得很小时，逐格 fillRect 会变成瓶颈：131 万格铺满屏幕 = 131 万次填充。
 * 所以烘焙一张 1px/格 的位图，放大后一次 drawImage 画完。
 * 只在可见格数超过阈值时走这条路，放大编辑时仍然逐格画（要色号要精度）。
 */
export const BITMAP_THRESHOLD = 40_000

/** 纯函数：把整张图打包成 RGBA 缓冲，供 ImageData 使用 */
export function packGridRgba(grid: CellGrid, palette: Palette, out: Uint8ClampedArray): void {
  const rgba = new Uint8Array(palette.colors.length * 4)
  for (let i = 0; i < palette.colors.length; i++) {
    const [r, g, b] = hexToRgb(palette.colors[i].hex)
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }
  const bg = hexToRgb(BOARD_BG)
  let p = 0
  for (const v of grid.cells) {
    if (v === EMPTY || v * 4 + 3 >= rgba.length) {
      out[p++] = bg[0]
      out[p++] = bg[1]
      out[p++] = bg[2]
      out[p++] = 255
    } else {
      const o = v * 4
      out[p++] = rgba[o]
      out[p++] = rgba[o + 1]
      out[p++] = rgba[o + 2]
      out[p++] = 255
    }
  }
}

export class GridBitmap {
  private canvas: HTMLCanvasElement | null = null
  private stamp = ''

  /** grid / 色板 / 版本任一变了就重烘焙 */
  ensure(grid: CellGrid, palette: Palette, version: number): HTMLCanvasElement | null {
    const key = `${grid.cols}x${grid.rows}:${palette.id}:${version}`
    if (this.canvas && this.stamp === key) return this.canvas
    if (typeof document === 'undefined') return null

    const canvas = this.canvas ?? document.createElement('canvas')
    if (canvas.width !== grid.cols || canvas.height !== grid.rows) {
      canvas.width = grid.cols
      canvas.height = grid.rows
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const image = ctx.createImageData(grid.cols, grid.rows)
    packGridRgba(grid, palette, image.data)
    ctx.putImageData(image, 0, 0)
    this.canvas = canvas
    this.stamp = key
    return canvas
  }

  /** 一次 drawImage 画完整屏；返回是否画了 */
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, width: number, height: number): boolean {
    const canvas = this.canvas
    if (!canvas) return false
    const z = vp.zoom
    const sx = Math.max(0, -vp.panX / z)
    const sy = Math.max(0, -vp.panY / z)
    const sw = Math.min(canvas.width - sx, width / z)
    const sh = Math.min(canvas.height - sy, height / z)
    if (sw <= 0 || sh <= 0) return false

    const prev = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      canvas,
      sx,
      sy,
      sw,
      sh,
      vp.panX + sx * z,
      vp.panY + sy * z,
      sw * z,
      sh * z,
    )
    ctx.imageSmoothingEnabled = prev
    return true
  }
}
