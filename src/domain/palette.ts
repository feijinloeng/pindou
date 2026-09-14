export interface BeadColor {
  code: string
  name: string
  hex: string
  rgb: [number, number, number]
  /** 构建时预计算的 CIELAB（D65）。运行时不再算 */
  lab: [number, number, number]
  /** v1 不用，预留（第 1 节决策 10） */
  symbol: string | null
}

export interface Palette {
  id: string
  brand: string
  displayName: string
  pitchMm: 2.6 | 5
  beadMm: number
  colors: BeadColor[]
  source?: { repo: string; license: string; retrievedAt: string }
}

/** Known Chinese palette names used in exported document titles. */
const PALETTE_ZH_NAMES: Record<string, string> = {
  MARD: '曼德',
}

/** English palette brand followed by its known Chinese name when available. */
export function paletteDisplayLabel(palette: Pick<Palette, 'brand' | 'displayName'>): string {
  const zhName = PALETTE_ZH_NAMES[palette.brand]
  if (!zhName) return palette.displayName
  if (!palette.displayName.startsWith(palette.brand)) return `${palette.brand}（${zhName}）`
  const suffix = palette.displayName.slice(palette.brand.length).replace(/^\s+/, '')
  return suffix ? `${palette.brand}（${zhName}） ${suffix}` : `${palette.brand}（${zhName}）`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * 标注用的亮度（ITU-R BT.601 的加权，0-1）。
 * ⚠️ 这不是 WCAG 相对亮度，也不是色差用的 Lab —— 只用来决定格子上印黑字还是白字。
 */
export function labelLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/** 浅底黑字、深底白字（第 7.8 节 ⑤，阈值 0.55） */
export function labelTextColor(hex: string): 'black' | 'white' {
  return labelLuminance(hex) > 0.55 ? 'black' : 'white'
}

export function colorAt(palette: Palette, index: number): BeadColor | null {
  return palette.colors[index] ?? null
}

/**
 * 把颜色按系数调暗（预览图里豆孔的颜色就是 shadeHex(hex, 0.68)）。
 * 只乘不减，保色相不变。
 */
export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex)
  const shade = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * factor)))
      .toString(16)
      .padStart(2, '0')
  return `#${shade(r)}${shade(g)}${shade(b)}`.toUpperCase()
}
