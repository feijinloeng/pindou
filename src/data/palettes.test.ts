import { describe, expect, it } from 'vitest'

import { ciede2000, rgbToLab } from '../conversion/colorDistance'
import { allowedMask, getPalette, PALETTES } from './palettes'

/**
 * 这些断言跑在构建产物上，不需要网络。
 * 目标：色卡一改就能立刻发现"色号数不对 / Lab 算错 / 排序乱了"。
 */
describe('色卡数据', () => {
  it('10 套色卡，色号数量与上游一致', () => {
    const counts = Object.fromEntries(PALETTES.map((p) => [p.id, p.colors.length]))
    expect(counts['mard-221']).toBe(221)
    expect(counts['mard-291']).toBe(291)
    expect(counts['coco-291']).toBe(291)
    expect(counts['manman-278']).toBe(278)
    expect(counts['panpan-289']).toBe(289)
    expect(counts['mixiaowo-290']).toBe(290)
    expect(counts.perler).toBeGreaterThan(50)
    expect(counts.hama).toBeGreaterThan(50)
    expect(counts['artkal-s']).toBeGreaterThan(100)
    expect(counts['artkal-mini']).toBeGreaterThan(100)
    expect(PALETTES).toHaveLength(10)
  })

  it('每套色卡里色号不重复，且都有 hex / rgb / lab', () => {
    for (const palette of PALETTES) {
      const codes = new Set(palette.colors.map((c) => c.code))
      expect(codes.size).toBe(palette.colors.length)
      for (const color of palette.colors) {
        expect(color.hex).toMatch(/^#[0-9A-F]{6}$/)
        expect(color.rgb).toHaveLength(3)
        expect(color.lab).toHaveLength(3)
        expect(color.lab[0]).toBeGreaterThanOrEqual(0)
        expect(color.lab[0]).toBeLessThanOrEqual(100)
      }
    }
  })

  it('预计算的 Lab 和现场算的一致（容差 1e-3）', () => {
    const palette = getPalette('mard-291')
    for (const color of palette.colors.slice(0, 40)) {
      const fresh = rgbToLab(color.rgb as [number, number, number])
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(fresh[i] - color.lab[i])).toBeLessThan(1e-3)
      }
    }
  })

  it('色号按色相排序：相邻两项的色相差不会跨过色环', () => {
    const palette = getPalette('coco-291')
    const hues = palette.colors.map((c) => {
      const [, a, b] = c.lab
      const chroma = Math.hypot(a, b)
      if (chroma < 10) return -1
      const hue = (Math.atan2(b, a) * 180) / Math.PI
      return Math.round(((hue + 360) % 360) / 5)
    })
    expect(hues[0]).toBe(-1) // 无彩色排在最前
    let lastNeutral = -1
    let lastHue = -1
    for (const bracket of hues) {
      if (bracket === -1) {
        lastNeutral++
        continue
      }
      expect(bracket).toBeGreaterThanOrEqual(lastHue)
      lastHue = bracket
    }
    expect(lastNeutral).toBeGreaterThan(0)
  })

  it('同色相内按明度升序', () => {
    const palette = getPalette('hama')
    const byBracket = new Map<number, number[]>()
    for (const c of palette.colors) {
      const [lightness, a, b] = c.lab
      if (Math.hypot(a, b) < 10) continue
      const hue = (Math.atan2(b, a) * 180) / Math.PI
      const bracket = Math.round(((hue + 360) % 360) / 5)
      const list = byBracket.get(bracket) ?? []
      list.push(lightness)
      byBracket.set(bracket, list)
    }
    for (const list of byBracket.values()) {
      for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1])
    }
  })

  it('每套色卡的 Lab 都能互相比较（不是空壳数据）', () => {
    const black = getPalette('mard-291').colors.reduce((best, c) => (c.lab[0] < best.lab[0] ? c : best))
    const white = getPalette('mard-291').colors.reduce((best, c) => (c.lab[0] > best.lab[0] ? c : best))
    expect(black.lab[0]).toBeLessThan(30)
    expect(white.lab[0]).toBeGreaterThan(90)
    expect(ciede2000(black.lab, white.lab)).toBeGreaterThan(50)
  })

  it('可用色遮罩按色号排除，顺序和色板一致', () => {
    const palette = getPalette('mard-221')
    const mask = allowedMask(palette, ['A1', 'A2'])!
    expect(mask).toHaveLength(palette.colors.length)
    expect(mask.filter(Boolean)).toHaveLength(2)
    expect(allowedMask(palette, null)).toBeUndefined()
  })

  it('每套色卡都带许可证与免责声明', () => {
    for (const palette of PALETTES) {
      expect(palette.source?.license).toBeTruthy()
      expect(palette.source?.repo).toMatch(/^[\w.-]+\/[\w.-]+$/)
    }
  })

  it('2.6mm 的色卡配 2.6 针距，5mm 的配 5', () => {
    for (const palette of PALETTES) {
      expect([2.6, 5]).toContain(palette.pitchMm)
      expect(palette.beadMm).toBe(palette.pitchMm)
    }
    expect(getPalette('perler').pitchMm).toBe(5)
    expect(getPalette('mard-291').pitchMm).toBe(2.6)
  })
})
