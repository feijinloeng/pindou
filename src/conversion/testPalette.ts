import { DEMO_PALETTE } from '../domain/palette'
import type { Rgb } from './colorDistance'

/** 只有测试用的 16 色小色板（真色板在 M4 的 palettes.json 里） */
export const DEMO_PALETTE_RGB: Rgb[] = DEMO_PALETTE.colors.map(
  (c) => [c.rgb[0], c.rgb[1], c.rgb[2]] as Rgb,
)
