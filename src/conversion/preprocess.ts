import type { Rgb } from './colorDistance'

export interface BilateralOptions {
  radius: number
  sigmaSpatial: number
  /** 0-1 的亮度差阈值（乘 255 用） */
  sigmaRange: number
  /** 只在平坦区域平滑：局部方差超过它就不动 */
  varianceThreshold: number
  strength: number
}

/**
 * 双边滤波：边缘不动，平坦区域平滑。
 *
 * 注意是在【降采样到豆格尺寸之后】做的 —— 会变成豆子的就是这张低分辨率图，
 * 而且 104×104 上跑双边是毫秒级，1000×1000 上是秒级。
 */
export function bilateralFilter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: BilateralOptions,
): Uint8ClampedArray {
  const { radius, sigmaSpatial, sigmaRange, varianceThreshold, strength } = options
  const out = new Uint8ClampedArray(data.length)
  const spatial = new Float32Array((radius * 2 + 1) ** 2)
  const sigmaRangeAbs = sigmaRange * 255
  let si = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spatial[si++] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpatial * sigmaSpatial))
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      const cr = data[i]
      const cg = data[i + 1]
      const cb = data[i + 2]

      // 局部方差：够"花"就不平滑（保边缘）
      let sum = 0
      let sum2 = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = (ny * width + nx) * 3
          const lum = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
          sum += lum
          sum2 += lum * lum
          count++
        }
      }
      const mean = sum / count
      const variance = sum2 / count - mean * mean
      if (variance > varianceThreshold * 255 * 255) {
        out[i] = cr
        out[i + 1] = cg
        out[i + 2] = cb
        continue
      }

      let wr = 0
      let wg = 0
      let wb = 0
      let wsum = 0
      si = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        for (let dx = -radius; dx <= radius; dx++, si++) {
          const nx = x + dx
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue
          const j = (ny * width + nx) * 3
          const dr = data[j] - cr
          const dg = data[j + 1] - cg
          const db = data[j + 2] - cb
          const range2 = dr * dr + dg * dg + db * db
          const w = spatial[si] * Math.exp(-range2 / (2 * sigmaRangeAbs * sigmaRangeAbs))
          wr += data[j] * w
          wg += data[j + 1] * w
          wb += data[j + 2] * w
          wsum += w
        }
      }
      if (wsum === 0) {
        out[i] = cr
        out[i + 1] = cg
        out[i + 2] = cb
        continue
      }
      out[i] = Math.round(cr + ((wr / wsum - cr) * strength))
      out[i + 1] = Math.round(cg + ((wg / wsum - cg) * strength))
      out[i + 2] = Math.round(cb + ((wb / wsum - cb) * strength))
    }
  }
  return out
}

/**
 * 中性偏置：防"白变灰、黑变深灰"。
 * 近白且几乎无色相的像素直接归白，近黑归黑 —— 这是拼豆图上最显眼的两种脏色。
 */
export function neutralBias(data: Uint8ClampedArray, strength: 'normal' | 'strong'): void {
  const whiteCut = strength === 'strong' ? 232 : 240
  const blackCut = strength === 'strong' ? 26 : 20
  const chromaCut = strength === 'strong' ? 20 : 15
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (chroma > chromaCut) continue
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum >= whiteCut) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    } else if (lum <= blackCut) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
    }
  }
}

export function luminanceOf(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
}
