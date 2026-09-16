import { linearToRgb, srgbToLinear } from './colorDistance.ts'
import type { SourceImage } from './types'

export type DownscaleMode = 'mean' | 'dominant'

interface DownscaleResult {
  width: number
  height: number
  /** RGB，长度 = width × height × 3 */
  data: Uint8ClampedArray
}

/**
 * 线性 RGB 均值降采样。
 * ⚠️ 必须在 linear 空间做：直接在 sRGB 上平均会让整体变暗（本领域最常见的隐形 bug）。
 */
function downscaleAverage(
  src: SourceImage,
  outW: number,
  outH: number,
): DownscaleResult {
  const out = new Uint8ClampedArray(outW * outH * 3)
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * src.height) / outH)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * src.height) / outH))
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * src.width) / outW)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * src.width) / outW))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1 && y < src.height; y++) {
        for (let x = x0; x < x1 && x < src.width; x++) {
          const i = (y * src.width + x) * 4
          // 逐通道查表式换算，别在这里分配数组（热路径）
          r += srgbToLinear(src.data[i])
          g += srgbToLinear(src.data[i + 1])
          b += srgbToLinear(src.data[i + 2])
          n++
        }
      }
      if (n === 0) n = 1
      const rgb = linearToRgb([r / n, g / n, b / n])
      const o = (oy * outW + ox) * 3
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
    }
  }
  return { width: outW, height: outH, data: out }
}

/**
 * 主导色降采样：6bit 量化计数，取最高频桶，返回值用该桶内真实像素的均值。
 * 纯黑白棋盘格不会出现中间灰 —— 这正是它和均值档的区别。
 */
function downscaleDominant(
  src: SourceImage,
  outW: number,
  outH: number,
): DownscaleResult {
  const out = new Uint8ClampedArray(outW * outH * 3)
  const counts = new Uint32Array(262144) // 6bit × 3
  const sums = new Float64Array(262144 * 3)
  const touched: number[] = []

  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor((oy * src.height) / outH)
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * src.height) / outH))
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * src.width) / outW)
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * src.width) / outW))
      touched.length = 0
      let bestKey = -1
      let bestCount = 0
      for (let y = y0; y < y1 && y < src.height; y++) {
        for (let x = x0; x < x1 && x < src.width; x++) {
          const i = (y * src.width + x) * 4
          const r = src.data[i]
          const g = src.data[i + 1]
          const b = src.data[i + 2]
          const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
          if (counts[key] === 0) touched.push(key)
          counts[key]++
          sums[key * 3] += r
          sums[key * 3 + 1] += g
          sums[key * 3 + 2] += b
          if (counts[key] > bestCount) {
            bestCount = counts[key]
            bestKey = key
          }
        }
      }
      const o = (oy * outW + ox) * 3
      if (bestKey >= 0) {
        out[o] = Math.round(sums[bestKey * 3] / bestCount)
        out[o + 1] = Math.round(sums[bestKey * 3 + 1] / bestCount)
        out[o + 2] = Math.round(sums[bestKey * 3 + 2] / bestCount)
      }
      for (const key of touched) {
        counts[key] = 0
        sums[key * 3] = 0
        sums[key * 3 + 1] = 0
        sums[key * 3 + 2] = 0
      }
    }
  }
  return { width: outW, height: outH, data: out }
}

export function downscale(
  src: SourceImage,
  outW: number,
  outH: number,
  mode: DownscaleMode = 'mean',
): DownscaleResult {
  return mode === 'dominant'
    ? downscaleDominant(src, outW, outH)
    : downscaleAverage(src, outW, outH)
}

/**
 * 把图片按统一比例放进目标格子，并允许缩放和移动。
 * 输出格子外仍是白色，开启去背景后会被转换成空格而不是白豆。
 */
export function downscalePositioned(
  src: SourceImage,
  outW: number,
  outH: number,
  fit: FitMode,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  mode: DownscaleMode = 'mean',
): DownscaleResult {
  const width = Math.max(0, Math.floor(outW))
  const height = Math.max(0, Math.floor(outH))
  const out = new Uint8ClampedArray(width * height * 3)
  out.fill(255)
  if (!width || !height || !src.width || !src.height) return { width, height, data: out }

  const safeScale = Math.max(0.1, Number.isFinite(scale) ? scale : 1)
  const safeOffsetX = Number.isFinite(offsetX) ? Math.max(-1, Math.min(1, offsetX)) : 0
  const safeOffsetY = Number.isFinite(offsetY) ? Math.max(-1, Math.min(1, offsetY)) : 0
  const baseX = fit === 'stretch' ? width / src.width : Math.min(width / src.width, height / src.height)
  const baseY = fit === 'stretch' ? height / src.height : fit === 'cover' ? Math.max(width / src.width, height / src.height) : baseX
  const sourceScaleX = baseX * safeScale
  const sourceScaleY = baseY * safeScale
  const imageWidth = src.width * sourceScaleX
  const imageHeight = src.height * sourceScaleY
  const left = (width - imageWidth) / 2 + safeOffsetX * width
  const top = (height - imageHeight) / 2 + safeOffsetY * height
  const dominant = mode === 'dominant'
  const counts = dominant ? new Uint32Array(262144) : null
  const sums = dominant ? new Float64Array(262144 * 3) : null
  const touched: number[] | null = dominant ? [] : null

  for (let oy = 0; oy < height; oy++) {
    const cy = oy + 0.5
    if (cy < top || cy >= top + imageHeight) continue
    const sy0 = Math.max(0, Math.min(src.height - 1, Math.floor((oy - top) / sourceScaleY)))
    const sy1 = Math.min(src.height, Math.max(sy0 + 1, Math.ceil((oy + 1 - top) / sourceScaleY)))
    for (let ox = 0; ox < width; ox++) {
      const cx = ox + 0.5
      if (cx < left || cx >= left + imageWidth) continue
      const sx0 = Math.max(0, Math.min(src.width - 1, Math.floor((ox - left) / sourceScaleX)))
      const sx1 = Math.min(src.width, Math.max(sx0 + 1, Math.ceil((ox + 1 - left) / sourceScaleX)))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      let bestKey = -1
      let bestCount = 0
      if (touched) touched.length = 0
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * src.width + x) * 4
          const pr = src.data[i]
          const pg = src.data[i + 1]
          const pb = src.data[i + 2]
          if (dominant && counts && sums && touched) {
            const key = ((pr >> 2) << 12) | ((pg >> 2) << 6) | (pb >> 2)
            if (counts[key] === 0) touched.push(key)
            counts[key]++
            sums[key * 3] += pr
            sums[key * 3 + 1] += pg
            sums[key * 3 + 2] += pb
            if (counts[key] > bestCount) {
              bestCount = counts[key]
              bestKey = key
            }
          } else {
            r += srgbToLinear(pr)
            g += srgbToLinear(pg)
            b += srgbToLinear(pb)
            n++
          }
        }
      }
      const o = (oy * width + ox) * 3
      if (dominant && sums && bestKey >= 0) {
        out[o] = Math.round(sums[bestKey * 3] / bestCount)
        out[o + 1] = Math.round(sums[bestKey * 3 + 1] / bestCount)
        out[o + 2] = Math.round(sums[bestKey * 3 + 2] / bestCount)
      } else if (!dominant && n > 0) {
        const rgb = linearToRgb([r / n, g / n, b / n])
        out[o] = rgb[0]
        out[o + 1] = rgb[1]
        out[o + 2] = rgb[2]
      }
      if (touched && counts && sums) {
        for (const key of touched) {
          counts[key] = 0
          sums[key * 3] = 0
          sums[key * 3 + 1] = 0
          sums[key * 3 + 2] = 0
        }
      }
    }
  }
  return { width, height, data: out }
}

/** Fit the source into the target grid with white letterboxing; never crop or stretch. */
export function downscaleContained(src: SourceImage, outW: number, outH: number): DownscaleResult {
  const width = Math.max(0, Math.floor(outW))
  const height = Math.max(0, Math.floor(outH))
  const out = new Uint8ClampedArray(width * height * 3)
  out.fill(255)
  if (!width || !height || !src.width || !src.height) return { width, height, data: out }

  const scale = Math.min(width / src.width, height / src.height)
  const imageWidth = src.width * scale
  const imageHeight = src.height * scale
  const left = (width - imageWidth) / 2
  const top = (height - imageHeight) / 2

  for (let oy = 0; oy < height; oy++) {
    const cy = oy + 0.5
    if (cy < top || cy >= top + imageHeight) continue
    const sy0 = Math.max(0, Math.floor((oy - top) / scale))
    const sy1 = Math.min(
      src.height,
      Math.max(sy0 + 1, Math.ceil((oy + 1 - top) / scale)),
    )
    for (let ox = 0; ox < width; ox++) {
      const cx = ox + 0.5
      if (cx < left || cx >= left + imageWidth) continue
      const sx0 = Math.max(0, Math.floor((ox - left) / scale))
      const sx1 = Math.min(
        src.width,
        Math.max(sx0 + 1, Math.ceil((ox + 1 - left) / scale)),
      )
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4
          r += srgbToLinear(src.data[i])
          g += srgbToLinear(src.data[i + 1])
          b += srgbToLinear(src.data[i + 2])
          n++
        }
      }
      if (!n) continue
      const rgb = linearToRgb([r / n, g / n, b / n])
      const o = (oy * width + ox) * 3
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
    }
  }
  return { width, height, data: out }
}

export type FitMode = 'cover' | 'contain' | 'stretch'

/**
 * 把源图对到画布比例：cover 裁掉溢出部分（默认，不变形），contain 留白边，stretch 直接拉伸。
 */
export function fitToAspect(
  src: SourceImage,
  targetW: number,
  targetH: number,
  mode: FitMode = 'cover',
): SourceImage {
  if (mode === 'stretch') return src
  const targetRatio = targetW / targetH
  const srcRatio = src.width / src.height
  if (mode === 'cover' ? srcRatio > targetRatio : srcRatio < targetRatio) {
    // 太宽 → 裁左右
    const keepW = Math.max(1, Math.round(src.height * targetRatio))
    const x0 = Math.floor((src.width - keepW) / 2)
    return { width: keepW, height: src.height, data: cropRect(src, x0, 0, keepW, src.height) }
  }
  const keepH = Math.max(1, Math.round(src.width / targetRatio))
  const y0 = Math.floor((src.height - keepH) / 2)
  return { width: src.width, height: keepH, data: cropRect(src, 0, y0, src.width, keepH) }
}

export function cropRect(
  src: SourceImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.max(0, y0 + y))
    const rowStart = (sy * src.width + Math.min(src.width - 1, Math.max(0, x0))) * 4
    out.set(src.data.subarray(rowStart, rowStart + w * 4), y * w * 4)
  }
  return out
}
