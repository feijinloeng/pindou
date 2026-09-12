import { describe, expect, it } from 'vitest'

import { ciede2000, rgbToLab, type Rgb } from './colorDistance'
import { createMatcher, PRE_FILTER } from './match'
import { getPalette, paletteRgb } from '../data/palettes'

/**
 * Oklab 粗筛 top-8 是一个近似：如果真正的 CIEDE2000 最近色没进 top-8，
 * 结果就会偏。这里用全量精算做差分对照，把误差率量出来（P2-15）。
 *
 * 采样用固定步长，不用随机 —— 转换链路必须是确定性的（ADR 0004）。
 */
const STEP = 24

function sampleColors(): Rgb[] {
  const out: Rgb[] = []
  for (let r = 0; r <= 255; r += STEP) {
    for (let g = 0; g <= 255; g += STEP) {
      for (let b = 0; b <= 255; b += STEP) out.push([r, g, b])
    }
  }
  return out
}

/** 全量 CIEDE2000：没有任何粗筛，作为“正确答案” */
function exactMatch(colors: Rgb[], labs: ReturnType<typeof rgbToLab>[], target: Rgb): number {
  const targetLab = rgbToLab(target)
  let best = 0
  let bestDelta = Number.POSITIVE_INFINITY
  for (let i = 0; i < colors.length; i++) {
    const delta = ciede2000(targetLab, labs[i])
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  }
  return best
}

describe(`最近色近似（PRE_FILTER=${PRE_FILTER}）`, () => {
  it('与全量 CIEDE2000 的差异率在可接受范围内', () => {
    const colors = paletteRgb(getPalette('mard-291'))
    const labs = colors.map((c) => rgbToLab(c))
    const matcher = createMatcher(colors)
    const samples = sampleColors()

    let mismatch = 0
    let worst = 0
    let worstColor: Rgb = [0, 0, 0]
    for (const rgb of samples) {
      const approx = matcher.match(rgb)
      const exact = exactMatch(colors, labs, rgb)
      if (approx === exact) continue
      mismatch++
      // 差异有多大：换错了但两个色几乎一样，就不算真错
      const delta = ciede2000(labs[approx], labs[exact])
      if (delta > worst) {
        worst = delta
        worstColor = rgb
      }
    }

    const rate = mismatch / samples.length
    // 实测（mard-291，步长 24 的 1331 个采样色）：PRE_FILTER=8 时 rate=2.03%、
    // worstDE=29.05；改成 24 后两者都是 0。阈值留一点余量，改坏了会被拦住。
    expect(samples.length).toBeGreaterThan(1000)
    expect(rate).toBeLessThan(0.002)
    expect(worst).toBeLessThan(3)
    void worstColor
  })
})
