import type { Rgb } from './colorDistance'
import type { SourceImage } from './types'

/** 只有测试用的造图工具，不进生产链路 */
export function solidImage(width: number, height: number, rgb: Rgb): SourceImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

export function checkerImage(
  width: number,
  height: number,
  a: Rgb,
  b: Rgb,
  cell = 1,
): SourceImage {
  const img = solidImage(width, height, a)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) continue
      const i = (y * width + x) * 4
      img.data[i] = b[0]
      img.data[i + 1] = b[1]
      img.data[i + 2] = b[2]
    }
  }
  return img
}

export function blockImage(
  width: number,
  height: number,
  colors: Rgb[],
  block = 8,
): SourceImage {
  const img = solidImage(width, height, colors[0])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (Math.floor(x / block) + Math.floor(y / block)) % colors.length
      const c = colors[idx]
      const i = (y * width + x) * 4
      img.data[i] = c[0]
      img.data[i + 1] = c[1]
      img.data[i + 2] = c[2]
    }
  }
  return img
}

/** 白底上一个黑方块（可以很小），用来测去杂与高对比保留 */
export function dotImage(
  width: number,
  height: number,
  bg: Rgb,
  dot: Rgb,
  x0: number,
  y0: number,
  w = 1,
  h = 1,
): SourceImage {
  const img = solidImage(width, height, bg)
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4
      img.data[i] = dot[0]
      img.data[i + 1] = dot[1]
      img.data[i + 2] = dot[2]
    }
  }
  return img
}

/** 匹配/抖动函数吃的是紧密排列的 RGB，源图是 RGBA，测的时候得转一下 */
export function toRgbBuffer(image: SourceImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 3)
  for (let i = 0; i < image.width * image.height; i++) {
    out[i * 3] = image.data[i * 4]
    out[i * 3 + 1] = image.data[i * 4 + 1]
    out[i * 3 + 2] = image.data[i * 4 + 2]
  }
  return out
}
