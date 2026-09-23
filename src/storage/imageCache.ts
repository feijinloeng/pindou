import { DEFAULT_DECODE_LIMITS, limitScale } from '../conversion/types'
import { readImageDimensions } from '../conversion/imageDimensions'

/** 源图压缩后存（抄 langyo 的思路）：直接存 base64 原图会撑爆配额（第 14.1 节） */
export const CACHE_MAX_SIDE = 256
export const CACHE_QUALITY = 0.7

export interface CachedSource {
  blob: Blob
  width: number
  height: number
}

/** Keep small JPEGs unchanged; otherwise resize before decoding and store a 256px JPEG thumbnail. */
export async function compressForCache(file: File | Blob): Promise<CachedSource> {
  const dimensions = await readImageDimensions(file)
  if (!dimensions) throw new Error('无法确认源图尺寸')
  const target = limitScale(dimensions.width, dimensions.height, {
    ...DEFAULT_DECODE_LIMITS,
    maxSidePx: CACHE_MAX_SIDE,
    maxTotalPx: CACHE_MAX_SIDE * CACHE_MAX_SIDE * 4,
  })
  if (target.scale === 1 && file.type === 'image/jpeg') {
    return { blob: file, width: dimensions.width, height: dimensions.height }
  }
  const options: ImageBitmapOptions | undefined = target.scale < 1
    ? {
        ...(dimensions.width >= dimensions.height
          ? { resizeWidth: target.width }
          : { resizeHeight: target.height }),
        resizeQuality: 'high',
      }
    : undefined
  const bitmap = options ? await createImageBitmap(file, options) : await createImageBitmap(file)
  try {
    const { width, height } = limitScale(bitmap.width, bitmap.height, {
      ...DEFAULT_DECODE_LIMITS,
      maxSidePx: CACHE_MAX_SIDE,
      maxTotalPx: CACHE_MAX_SIDE * CACHE_MAX_SIDE * 4,
    })
    if (width !== bitmap.width || height !== bitmap.height) throw new Error('源图缩略图超出缓存尺寸')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('拿不到 2D 上下文，源图压缩失败')
    // JPEG has no alpha channel; composite transparent pixels on white to match conversion.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CACHE_QUALITY),
    )
    if (!blob) throw new Error('源图压缩失败')
    return { blob, width, height }
  } finally {
    bitmap.close?.()
  }
}
