import { DEFAULT_DECODE_LIMITS, limitScale, type DecodeLimits, type SourceImage } from './types'

/**
 * 在主线程解码图片并缩到上限内，然后把像素交给 Worker。
 * 缩放在这里做是因为 decode 出来的原图可能几百 MB，进 Worker 之前就得压掉。
 *
 * 透明像素统一合成到白底上：不这么办浏览器会把透明区域读成黑色 RGB，
 * 于是"透明背景"变成一圈脏黑，背景采样、内容分析和色差匹配全被带偏。
 */
export async function decodeImageFile(
  file: File | Blob,
  limits: DecodeLimits = DEFAULT_DECODE_LIMITS,
): Promise<SourceImage> {
  const bytes = file.size
  if (typeof bytes === 'number' && bytes > limits.maxBytes) {
    throw new Error(
      `图片 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过上限 ${Math.round(
        limits.maxBytes / 1024 / 1024,
      )}MB。先压缩或裁小一点再导入`,
    )
  }
  const type = file.type
  if (type && !type.startsWith('image/')) {
    throw new Error(`这个文件不是图片（${type}）`)
  }

  const bitmap = await createImageBitmap(file)
  try {
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
    // 先铺白底再画图：透明像素按"纸是白的"合成
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    return { width, height, data: imageData.data }
  } finally {
    // 失败也不能漏掉 close：bitmap 占的是原生内存，不是 GC 管的
    if (typeof (bitmap as ImageBitmap).close === 'function') (bitmap as ImageBitmap).close()
  }
}
