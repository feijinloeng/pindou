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

import { rgbToLab } from '../conversion/colorDistance'

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

function bead(code: string, name: string, hex: string): BeadColor {
  const rgb = hexToRgb(hex)
  return {
    code,
    name,
    hex,
    rgb,
    lab: rgbToLab(rgb).map((v) => Math.round(v * 10000) / 10000) as [number, number, number],
    symbol: null,
  }
}

/**
 * ⚠️ 临时色板，只在色板数据生成前给编辑器和渲染用。
 * M4 之后这里只留类型定义，颜色全走 `src/data/palettes.json`。
 * 色号借用 Hama 的 'H' 前缀，数值是屏幕参考色，不是厂家数据。
 */
export const DEMO_PALETTE: Palette = {
  id: 'demo-16',
  brand: 'DEMO',
  displayName: '临时色板（16 色）',
  pitchMm: 2.6,
  beadMm: 2.6,
  colors: [
    bead('H01', '黑', '#1A1A1A'),
    bead('H02', '白', '#FFFFFF'),
    bead('H03', '浅灰', '#C8C8C8'),
    bead('H04', '深灰', '#6E6E6E'),
    bead('H05', '红', '#D22B2B'),
    bead('H06', '粉', '#F2A6C0'),
    bead('H07', '橙', '#F08A24'),
    bead('H08', '黄', '#F5D33A'),
    bead('H09', '黄绿', '#A8C93A'),
    bead('H10', '草绿', '#4E9A3D'),
    bead('H11', '深绿', '#1F5F3A'),
    bead('H12', '青', '#2FB6A8'),
    bead('H13', '浅蓝', '#7FC4E8'),
    bead('H14', '蓝', '#2A5EA8'),
    bead('H15', '深蓝', '#1B2A55'),
    bead('H16', '紫', '#7B3FA0'),
  ],
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
