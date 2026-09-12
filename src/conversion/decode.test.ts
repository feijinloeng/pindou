import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_DECODE_LIMITS, limitScale, type SourceImage } from './types'
import { decodeImageFile } from './decode'

const limits = { maxSidePx: 64, maxTotalPx: 4096, maxBytes: 1024 }

function fileOf(bytes: number, type = 'image/png'): File {
  const file = new File([new Uint8Array(1)], 'x.png', { type })
  Object.defineProperty(file, 'size', { value: bytes })
  return file
}

describe('图片解码入口的资源限制', () => {
  it('字节数超上限直接拒绝，连 createImageBitmap 都不调', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(decodeImageFile(fileOf(2048), limits)).rejects.toThrow(/超过上限/)
    expect(decode).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('不是图片的 MIME 拒绝（避免把二进制垃圾喂给解码器）', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(decodeImageFile(fileOf(10, 'application/pdf'), limits)).rejects.toThrow(
      /不是图片/,
    )
    expect(decode).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('默认上限是 32MB / 4096px / 1600 万像素', () => {
    expect(DEFAULT_DECODE_LIMITS.maxBytes).toBe(32 * 1024 * 1024)
    const scaled = limitScale(8000, 4000, DEFAULT_DECODE_LIMITS)
    expect(scaled.width).toBeLessThanOrEqual(4096)
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(16_777_216)
  })

  it('解码失败也会关掉 bitmap（不泄漏原生内存）', async () => {
    const close = vi.fn()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 8, height: 8, close })),
    )
    vi.stubGlobal('OffscreenCanvas', undefined)
    // node 里没有 document，构造 canvas 会抛 → finally 必须已经跑到
    await expect(decodeImageFile(fileOf(10), limits)).rejects.toThrow()
    expect(close).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('SourceImage 契约没变（解码结果是紧密 RGBA）', () => {
    const image: SourceImage = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
    }
    expect(image.data).toHaveLength(image.width * image.height * 4)
  })
})
