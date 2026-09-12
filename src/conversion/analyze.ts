import type { SourceImage } from './types'

/**
 * 内容分析：从统计量判断这是线稿 / 像素画 / 文档 / 照片，决定后面用哪一档参数。
 * 指标沿用 zwhy149 `analyzeSourceComplexity` 的思路（自己重写，没抄代码）。
 */
export interface SourceAnalysis {
  /** 中性色占比（chroma ≤ 20） */
  neutralRatio: number
  /** 高亮占比（lum ≥ 235 且 chroma ≤ 24） */
  brightRatio: number
  darkRatio: number
  saturatedRatio: number
  /** 相邻亮度差 > 20 的比例 */
  edgeDensity: number
  /** 量化后的颜色数（每通道 4bit） */
  quantizedColorCount: number
  /** 近白像素占比 */
  nearWhiteRatio: number
  /** 强墨（很暗的像素）占比 */
  strongInkRatio: number
  /** 有彩（chroma > 20）占比 */
  chromaticRatio: number
  /** 量化色直方图里的前若干桶占比之和（平坦度用） */
  flatPairRatio: number
  likelyLineArt: boolean
  likelyPixelArt: boolean
  likelyDocument: boolean
  /** 分析后的建议内容类型 */
  kind: 'lineart' | 'pixelart' | 'document' | 'photo'
}

export function analyzeSource(image: SourceImage): SourceAnalysis {
  const { width, height, data } = image
  const n = width * height
  let neutral = 0
  let bright = 0
  let dark = 0
  let saturated = 0
  let nearWhite = 0
  let strongInk = 0
  let chromatic = 0

  const histogram = new Uint32Array(4096) // 12bit 量化
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const lum = 0.299 * r + 0.587 * g + 0.114 * b

    if (chroma <= 20) neutral++
    if (lum >= 235 && chroma <= 24) bright++
    if (lum < 60) dark++
    if (chroma > 60) saturated++
    if (lum > 245 && chroma <= 12) nearWhite++
    if (lum < 80 && chroma <= 40) strongInk++
    if (chroma > 20) chromatic++
    histogram[((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)]++
  }

  let quantizedColorCount = 0
  for (const count of histogram) if (count > 0) quantizedColorCount++

  // 边缘密度：只在横向和纵向各看一个邻居，够用且快一倍
  let edges = 0
  let pairs = 0
  const lumAt = (i: number) =>
    0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const l = lumAt(i)
      if (x + 1 < width) {
        pairs++
        if (Math.abs(l - lumAt(i + 1)) > 20) edges++
      }
      if (y + 1 < height) {
        pairs++
        if (Math.abs(l - lumAt(i + width)) > 20) edges++
      }
    }
  }
  const edgeDensity = pairs === 0 ? 0 : edges / pairs

  // 平坦度：看有多少格的邻居和自己落到同一个 12bit 桶里
  let flatPairs = 0
  let flatTotal = 0
  const bucket = (i: number) =>
    ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const b = bucket(i)
      if (x + 1 < width) {
        flatTotal++
        if (bucket(i + 1) === b) flatPairs++
      }
      if (y + 1 < height) {
        flatTotal++
        if (bucket(i + width) === b) flatPairs++
      }
    }
  }
  const flatPairRatio = flatTotal === 0 ? 0 : flatPairs / flatTotal

  const neutralRatio = neutral / n
  const brightRatio = bright / n
  const darkRatio = dark / n
  const saturatedRatio = saturated / n
  const nearWhiteRatio = nearWhite / n
  const strongInkRatio = strongInk / n
  const chromaticRatio = chromatic / n

  const likelyLineArt =
    neutralRatio >= 0.985 &&
    brightRatio >= 0.62 &&
    strongInkRatio >= 0.006 &&
    strongInkRatio <= 0.38 &&
    chromaticRatio <= 0.012

  const likelyPixelArt = quantizedColorCount <= 64 && edgeDensity > 0.02 && flatPairRatio > 0.9

  const likelyDocument = nearWhiteRatio > 0.5 && edgeDensity > 0.04 && flatPairRatio > 0.1

  const kind = likelyLineArt
    ? 'lineart'
    : likelyPixelArt
      ? 'pixelart'
      : likelyDocument
        ? 'document'
        : 'photo'

  return {
    neutralRatio,
    brightRatio,
    darkRatio,
    saturatedRatio,
    edgeDensity,
    quantizedColorCount,
    nearWhiteRatio,
    strongInkRatio,
    chromaticRatio,
    flatPairRatio,
    likelyLineArt,
    likelyPixelArt,
    likelyDocument,
    kind,
  }
}
