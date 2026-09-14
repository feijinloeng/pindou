import raw from './palettes.json'

import type { Palette } from '../domain/palette'
import type { Rgb } from '../conversion/colorDistance'

/**
 * 构建产物（`scripts/data/build-palettes.ts` 生成）的读取与索引。
 * 运行时不发任何网络请求 —— 离线可用（第 1 节决策 22）。
 */
export interface PaletteFile {
  schema: string
  schemaVersion: number
  note: string
  attribution: Array<{ repo: string; license: string; used: string }>
  disclaimer: string
  trademarks: string
  palettes: Palette[]
}

export const PALETTE_FILE = raw as unknown as PaletteFile
const PALETTE_PRIORITY = ['mard-221', 'mard-291']
export const PALETTES: Palette[] = PALETTE_FILE.palettes
  .map((palette, index) => ({ palette, index }))
  .sort((a, b) => {
    const aPriority = PALETTE_PRIORITY.indexOf(a.palette.id)
    const bPriority = PALETTE_PRIORITY.indexOf(b.palette.id)
    const aIsPriority = aPriority >= 0
    const bIsPriority = bPriority >= 0

    if (aIsPriority || bIsPriority) {
      if (!aIsPriority) return 1
      if (!bIsPriority) return -1
      return aPriority - bPriority
    }

    return b.palette.colors.length - a.palette.colors.length || a.index - b.index
  })
  .map(({ palette }) => palette)
export const DISCLAIMER = PALETTE_FILE.disclaimer
export const TRADEMARKS = PALETTE_FILE.trademarks
export const ATTRIBUTION = PALETTE_FILE.attribution

export const DEFAULT_PALETTE_ID = 'mard-221'

/** 找不到就返回 null。导入工程时必须能区分“没有这套色板”和“就用第一套” */
export function findPalette(id: unknown): Palette | null {
  if (typeof id !== 'string') return null
  return PALETTES.find((p) => p.id === id) ?? null
}

/** 界面用的取色板：找不到就当默认色板（调用方已经拿不到更好的了） */
export function getPalette(id: string): Palette {
  return findPalette(id) ?? PALETTES[0]
}

export function paletteRgb(palette: Palette): Rgb[] {
  return palette.colors.map((c) => c.rgb as Rgb)
}

/**
 * 可用色遮罩：allowedCodes = null 表示全部可用。
 * 顺序和 palette.colors 一致，直接喂给匹配器。
 */
export function allowedMask(palette: Palette, allowedCodes: string[] | null): boolean[] | undefined {
  if (!allowedCodes) return undefined
  const allowed = new Set(allowedCodes)
  return palette.colors.map((c) => allowed.has(c.code))
}

/** 这个色板默认选哪个色（找个中间调的中性色，比纯黑好用） */
export function defaultColorIndex(palette: Palette): number {
  const index = palette.colors.findIndex((c) => c.code === 'H01')
  if (index >= 0) return index
  const dark = palette.colors.reduce(
    (best, c, i) => (c.lab[0] < palette.colors[best].lab[0] ? i : best),
    0,
  )
  return dark
}
