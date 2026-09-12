import { DEFAULT_DECODE_LIMITS, limitScale, type DecodeLimits, type SourceImage } from './types'

/**
 * 在主线程解码图片并缩到上限内，然后把像素交给 Worker。
 * 缩放在这里做是因为 decode 出来的原图可能几百 MB，进 Worker 之前就得压掉。
 */
export async function decodeImageFile(
  file: File | Blob,
  limits: DecodeLimits = DEFAULT_DECODE_LIMITS,
): Promise<SourceImage> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = limitScale(bitmap.width, bitmap.height, limits)
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('拿不到 2D 上下文，解码失败')
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  if (typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close()
  return { width, height, data: imageData.data }
}
