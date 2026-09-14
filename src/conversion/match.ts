import {
  ciede2000,
  oklabDistanceSq,
  rgbToLab,
  rgbToOklab,
  type PaletteLabEntry,
  type Rgb,
} from './colorDistance'

/**
 * 预筛候选数：先用 Oklab 粗筛这么多，再逐个算 CIEDE2000。
 *
 * 8 不够：差分对照全量精算时错误率 2%，最差换错色 ΔE00≈29（看得出是另一个色）。
 * 24 在同一组采样上 0 错，而 130 万格噪声图实测只多花 ~20%（1437ms → 1735ms）——
 * 买错豆的代价比这点时间大。
 *
 * ponytail: 仍是近似。真要全量精算得先把 ciede2000 的三角函数预算出来，
 * 否则 291 色全扫会让大图转换慢到分钟级。先用 PRE_FILTER=24 顶着。
 */
const PRE_FILTER = 24

interface PaletteMatcher {
  /** 返回色板里的索引 */
  match(rgb: Rgb): number
  /** 该色板颜色的 Lab（外面统计要用） */
  entries: PaletteLabEntry[]
}

/**
 * 最近色匹配：Oklab 粗筛 top-8 → CIEDE2000 精算。
 * 色板的 Lab 在构造时算一次，不是每格算一遍。
 */
export function createMatcher(colors: Rgb[], allowed?: boolean[]): PaletteMatcher {
  const entries: PaletteLabEntry[] = colors.map((rgb) => ({
    rgb,
    lab: rgbToLab(rgb),
    oklab: rgbToOklab(rgb),
  }))
  const usable: number[] = []
  for (let i = 0; i < entries.length; i++) if (!allowed || allowed[i]) usable.push(i)
  if (usable.length === 0) throw new Error('色板里一个可用色都没有')

  const oklabs = usable.map((i) => entries[i].oklab)
  const labs = usable.map((i) => entries[i].lab)

  // 同一个 RGB 反复出现时直接命中（大色块图省掉绝大部分 CIEDE2000）。
  // 满了就整体清空：清空只影响速度，不影响结果，所以确定性不受影响。
  const CACHE_LIMIT = 1 << 18
  const cache = new Map<number, number>()

  return {
    entries,
    match(rgb: Rgb): number {
      if (usable.length === 1) return usable[0]
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      if (cache.size >= CACHE_LIMIT) cache.clear()

      const target = rgbToOklab(rgb)
      if (usable.length === 1) return usable[0]

      // top-PRE_FILTER：小数组插入排序，291 色也只扫一遍
      const bestIdx: number[] = []
      const bestDist: number[] = []
      for (let i = 0; i < oklabs.length; i++) {
        const d = oklabDistanceSq(target, oklabs[i])
        if (bestIdx.length < PRE_FILTER) {
          let k = bestIdx.length
          bestIdx.push(i)
          bestDist.push(d)
          while (k > 0 && bestDist[k - 1] > bestDist[k]) {
            const ti = bestIdx[k - 1]
            const td = bestDist[k - 1]
            bestIdx[k - 1] = bestIdx[k]
            bestDist[k - 1] = bestDist[k]
            bestIdx[k] = ti
            bestDist[k] = td
            k--
          }
        } else if (d < bestDist[PRE_FILTER - 1]) {
          bestIdx[PRE_FILTER - 1] = i
          bestDist[PRE_FILTER - 1] = d
          let k = PRE_FILTER - 1
          while (k > 0 && bestDist[k - 1] > bestDist[k]) {
            const ti = bestIdx[k - 1]
            const td = bestDist[k - 1]
            bestIdx[k - 1] = bestIdx[k]
            bestDist[k - 1] = bestDist[k]
            bestIdx[k] = ti
            bestDist[k] = td
            k--
          }
        }
      }

      const targetLab = rgbToLab(rgb)
      let best = usable[bestIdx[0]]
      let bestDelta = Number.POSITIVE_INFINITY
      for (const i of bestIdx) {
        const delta = ciede2000(targetLab, labs[i])
        if (delta < bestDelta) {
          bestDelta = delta
          best = usable[i]
        }
      }
      cache.set(key, best)
      return best
    },
  }
}

/**
 * Floyd–Steinberg 抖动，蛇形扫描。
 * strength = 0 就是纯最近色，不产生任何误差扩散。
 *
 * ⚠️ 误差扩散在 sRGB 的 0-255 值上做，不是线性光空间 —— 这是常见的工程近似：
 * 按视觉上更“对”的做法应该先 srgbToLinear 再扩散，但那样每个像素都要
 * 线性→sRGB 来回转，CPU 代价直接翻倍，而当前观感已经可接受。
 * 注释/文档一律不要再声称“线性空间”（P2-16）。
 *
 * ponytail: 需要更准的过渡时再换成线性空间的扩散，并用样图做视觉回归。
 */
export function matchWithDither(
  rgbData: Uint8ClampedArray,
  width: number,
  height: number,
  matcher: PaletteMatcher,
  strength: number,
): Uint16Array {
  const out = new Uint16Array(width * height)
  // 误差缓冲用浮点，别看 8bit
  const errR = new Float32Array(width + 2)
  const errG = new Float32Array(width + 2)
  const errB = new Float32Array(width + 2)
  const nextR = new Float32Array(width + 2)
  const nextG = new Float32Array(width + 2)
  const nextB = new Float32Array(width + 2)

  for (let y = 0; y < height; y++) {
    const leftToRight = y % 2 === 0
    nextR.fill(0)
    nextG.fill(0)
    nextB.fill(0)
    for (let step = 0; step < width; step++) {
      const x = leftToRight ? step : width - 1 - step
      const i = (y * width + x) * 3
      const r = clampByte(rgbData[i] + errR[x + 1])
      const g = clampByte(rgbData[i + 1] + errG[x + 1])
      const b = clampByte(rgbData[i + 2] + errB[x + 1])

      const index = matcher.match([r, g, b])
      out[y * width + x] = index

      if (strength <= 0) continue
      const chosen = matcher.entries[index].rgb
      const dr = (r - chosen[0]) * strength
      const dg = (g - chosen[1]) * strength
      const db = (b - chosen[2]) * strength
      const dir = leftToRight ? 1 : -1

      errR[x + 1 + dir] += (dr * 7) / 16
      errG[x + 1 + dir] += (dg * 7) / 16
      errB[x + 1 + dir] += (db * 7) / 16
      nextR[x + 1 - dir] += (dr * 3) / 16
      nextG[x + 1 - dir] += (dg * 3) / 16
      nextB[x + 1 - dir] += (db * 3) / 16
      nextR[x + 1] += (dr * 5) / 16
      nextG[x + 1] += (dg * 5) / 16
      nextB[x + 1] += (db * 5) / 16
      nextR[x + 1 + dir] += dr / 16
      nextG[x + 1 + dir] += dg / 16
      nextB[x + 1 + dir] += db / 16
    }
    errR.set(nextR)
    errG.set(nextG)
    errB.set(nextB)
  }
  return out
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}
