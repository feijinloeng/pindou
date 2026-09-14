import { EMPTY } from '../domain/grid'
import type { Rgb } from './colorDistance'
import type { SourceImage } from './types'

export const BG_THRESHOLD = 26

/** 边界采样里与中位色一致的占比低于这个值，就当“没有可靠背景” */
export const MIN_BG_CONFIDENCE = 0.6

/**
 * 背景采样结果。
 * confidence = 采样像素中有多少落在中位色附近。低置信度意味着四边不是同一种底色
 * （渐变、花纹、主体压到边上），这时自动裁切很可能把主体裁掉。
 */
export interface BackgroundSample {
  rgb: Rgb
  confidence: number
}

/**
 * 从四条边（不只是四个角）各取一条窄带，求 RGB 中位数作为背景色。
 *
 * 比只看四角稳得多：主体压在角落里时四角中位数会被主体带偏，
 * 而一整条边线上背景仍然占多数，中位数还是背景色。
 */
export function sampleBackground(image: SourceImage, bandRatio = 0.02): BackgroundSample {
  const { width, height, data } = image
  const bw = Math.max(1, Math.round(width * bandRatio))
  const bh = Math.max(1, Math.round(height * bandRatio))
  const samples: number[][] = [[], [], []]
  const collect = (x: number, y: number) => {
    const i = (y * width + x) * 4
    samples[0].push(data[i])
    samples[1].push(data[i + 1])
    samples[2].push(data[i + 2])
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < width; x++) {
      collect(x, y)
      collect(x, height - 1 - y)
    }
  }
  for (let x = 0; x < bw; x++) {
    for (let y = bh; y < height - bh; y++) {
      collect(x, y)
      collect(width - 1 - x, y)
    }
  }
  const rgb: Rgb = [median(samples[0]), median(samples[1]), median(samples[2])]

  // 一致度用平方距离比，不开根号：只是拿来做阈值判断
  const tolerance = (BG_THRESHOLD * 1.6) ** 2
  let agree = 0
  const total = samples[0].length
  for (let i = 0; i < total; i++) {
    const dr = samples[0][i] - rgb[0]
    const dg = samples[1][i] - rgb[1]
    const db = samples[2][i] - rgb[2]
    if (dr * dr + dg * dg + db * db <= tolerance) agree++
  }
  return { rgb, confidence: total === 0 ? 0 : agree / total }
}

function median(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[values.length >> 1]
}

/** RGB 欧氏距离（阈值 26 就是拿这个量的） */
function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export interface SubjectBox {
  x0: number
  y0: number
  x1: number
  y1: number
  /** 主体占整图的比例 */
  fillRatio: number
}

/** 用背景色差异找主体的外接矩形 */
export function findSubjectBox(
  image: SourceImage,
  bg: Rgb,
  threshold = BG_THRESHOLD,
  paddingRatio = 0.05,
): SubjectBox | null {
  const { width, height, data } = image
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  let ink = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (rgbDistance([data[i], data[i + 1], data[i + 2]], bg) <= threshold) continue
      ink++
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  const span = Math.max(x1 - x0 + 1, y1 - y0 + 1)
  const pad = Math.max(2, Math.round(span * paddingRatio))
  const cx0 = Math.max(0, x0 - pad)
  const cy0 = Math.max(0, y0 - pad)
  const cx1 = Math.min(width - 1, x1 + pad)
  const cy1 = Math.min(height - 1, y1 + pad)
  return {
    x0: cx0,
    y0: cy0,
    x1: cx1,
    y1: cy1,
    fillRatio: ink / (width * height),
  }
}

/**
 * 只有"裁掉的部分够多"才真裁。
 *
 * 路线图还要求"保留墨量 ≥ 99.5%"这一条，这里不需要：外接框是按"非背景像素"算出来的，
 * 框里按定义装着全部墨。真正会误裁的是背景色判错（主体里有和角落同色的区域），
 * 那一类不是靠这条比例阈值挡的，而是靠用户能在 UI 里关掉自动裁切。
 */
export function shouldCrop(
  box: SubjectBox,
  width: number,
  height: number,
  minCropRatio = 0.06,
): boolean {
  const kept = (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)
  if (kept < 64) return false
  const cropRatio = 1 - kept / (width * height)
  return cropRatio > minCropRatio
}

/** 从所有边界格出发洪水填充，把与背景色接近的格标记为空 */
export function removeBackground(
  cells: Uint16Array,
  cols: number,
  rows: number,
  paletteColors: Rgb[],
  bg: Rgb,
  threshold = BG_THRESHOLD,
): number {
  const isBackground = (i: number) => {
    const v = cells[i]
    if (v === EMPTY) return true
    const rgb = paletteColors[v]
    return rgb ? rgbDistance(rgb, bg) <= threshold : false
  }

  const stack: number[] = []
  const seen = new Uint8Array(cols * rows)
  for (let x = 0; x < cols; x++) {
    for (const y of [0, rows - 1]) {
      const i = y * cols + x
      if (!seen[i] && isBackground(i)) {
        seen[i] = 1
        stack.push(i)
      }
    }
  }
  for (let y = 0; y < rows; y++) {
    for (const x of [0, cols - 1]) {
      const i = y * cols + x
      if (!seen[i] && isBackground(i)) {
        seen[i] = 1
        stack.push(i)
      }
    }
  }

  let removed = 0
  while (stack.length) {
    const i = stack.pop()!
    if (cells[i] !== EMPTY) {
      cells[i] = EMPTY
      removed++
    }
    const x = i % cols
    const y = (i - x) / cols
    if (x > 0 && !seen[i - 1] && isBackground(i - 1)) {
      seen[i - 1] = 1
      stack.push(i - 1)
    }
    if (x + 1 < cols && !seen[i + 1] && isBackground(i + 1)) {
      seen[i + 1] = 1
      stack.push(i + 1)
    }
    if (y > 0 && !seen[i - cols] && isBackground(i - cols)) {
      seen[i - cols] = 1
      stack.push(i - cols)
    }
    if (y + 1 < rows && !seen[i + cols] && isBackground(i + cols)) {
      seen[i + cols] = 1
      stack.push(i + cols)
    }
  }
  return removed
}
