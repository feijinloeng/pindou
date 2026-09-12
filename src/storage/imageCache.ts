import { DEFAULT_DECODE_LIMITS, limitScale } from '../conversion/types'

/** 源图压缩后存（抄 langyo 的思路）：直接存 base64 原图会撑爆配额（第 14.1 节） */
export const CACHE_MAX_SIDE = 256
export const CACHE_QUALITY = 0.7

export interface CachedSource {
  blob: Blob
  width: number
  height: number
}

/**
 * ≤256px 就原样存，否则等比缩到最长边 256px 再转 JPEG quality 0.7。
 * 缩略图用不着高清，工程文件也不需要 —— 需要重转的时候用户手上有原图。
 */
export async function compressForCache(file: File | Blob): Promise<CachedSource> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = limitScale(bitmap.width, bitmap.height, {
    ...DEFAULT_DECODE_LIMITS,
    maxSidePx: CACHE_MAX_SIDE,
    maxTotalPx: CACHE_MAX_SIDE * CACHE_MAX_SIDE * 4,
  })
  if (width === bitmap.width && height === bitmap.height && file.type === 'image/jpeg') {
    const blob = file instanceof Blob ? file : new Blob([file])
    bitmap.close?.()
    return { blob, width, height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('拿不到 2D 上下文，源图压缩失败')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', CACHE_QUALITY),
  )
  if (!blob) throw new Error('源图压缩失败')
  return { blob, width, height }
}
