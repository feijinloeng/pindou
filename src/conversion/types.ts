/**
 * 解码后的源图像：紧密排列的 RGBA，方便在 Worker 之间用 Transferable 传。
 */
export interface SourceImage {
  width: number
  height: number
  /** 长度 = width × height × 4 */
  data: Uint8ClampedArray
}

export interface DecodeLimits {
  maxSidePx: number
  maxTotalPx: number
  maxBytes: number
}

export const DEFAULT_DECODE_LIMITS: DecodeLimits = {
  maxSidePx: 4096,
  maxTotalPx: 16_777_216,
  maxBytes: 32 * 1024 * 1024,
}

/** 超过上限时等比缩小，不报错（"先限制再处理"） */
export function limitScale(width: number, height: number, limits = DEFAULT_DECODE_LIMITS) {
  const scale = Math.min(
    1,
    limits.maxSidePx / Math.max(width, height),
    Math.sqrt(limits.maxTotalPx / (width * height)),
  )
  return {
    scale,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
