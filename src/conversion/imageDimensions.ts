/** Raster dimensions read from a small file prefix so decode can be resized before allocation. */
export interface ImageDimensions {
  width: number
  height: number
}

const MAX_HEADER_BYTES = 1024 * 1024

export function parseImageDimensions(bytes: Uint8Array, mimeType = ''): ImageDimensions | null {
  const has = (offset: number, values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value)
  const u16be = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1]
  const u16le = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8)
  const u24le = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
  const u32be = (offset: number) =>
    ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
  const u32le = (offset: number) =>
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  const valid = (width: number, height: number): ImageDimensions | null =>
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
      ? { width, height }
      : null

  if (has(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    return valid(u32be(16), u32be(20))
  }
  if (has(0, [0x47, 0x49, 0x46, 0x38]) && bytes.length >= 10) {
    return valid(u16le(6), u16le(8))
  }
  if (has(0, [0x42, 0x4d]) && bytes.length >= 26) {
    const headerSize = u32le(14)
    if (headerSize === 12) return valid(u16le(18), u16le(20))
    if (headerSize < 40 || bytes.length < 26) return null
    const width = u32le(18) | 0
    const height = u32le(22) | 0
    return valid(Math.abs(width), Math.abs(height))
  }
  if (has(0, [0x52, 0x49, 0x46, 0x46]) && has(8, [0x57, 0x45, 0x42, 0x50])) {
    if (has(12, [0x56, 0x50, 0x38, 0x58]) && bytes.length >= 30) {
      return valid(u24le(24) + 1, u24le(27) + 1)
    }
    if (has(12, [0x56, 0x50, 0x38, 0x20]) && bytes.length >= 30 && has(23, [0x9d, 0x01, 0x2a])) {
      return valid(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    }
    if (has(12, [0x56, 0x50, 0x38, 0x4c]) && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21]
      const b2 = bytes[22]
      const b3 = bytes[23]
      const b4 = bytes[24]
      return valid(
        1 + (((b2 & 0x3f) << 8) | b1),
        1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      )
    }
  }
  if (has(0, [0xff, 0xd8])) {
    let offset = 2
    let orientation = 1
    let jpegDimensions: ImageDimensions | null = null
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++
        continue
      }
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) break
      const length = u16be(offset)
      if (length < 2 || offset + length > bytes.length) break
      if (marker === 0xe1) {
        orientation = parseExifOrientation(bytes, offset + 2, offset + length) ?? orientation
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 7) return null
        jpegDimensions = valid(u16be(offset + 5), u16be(offset + 3))
      }
      offset += length
    }
    if (jpegDimensions) {
      return orientation >= 5 && orientation <= 8
        ? { width: jpegDimensions.height, height: jpegDimensions.width }
        : jpegDimensions
    }
  }

  // AVIF/HEIF image properties contain an `ispe` full box with width and height.
  for (let i = 4; i + 16 <= bytes.length; i++) {
    if (!has(i, [0x69, 0x73, 0x70, 0x65])) continue
    const width = u32be(i + 8)
    const height = u32be(i + 12)
    const dimensions = valid(width, height)
    if (dimensions && width <= 100_000 && height <= 100_000) return dimensions
  }

  if (mimeType === 'image/svg+xml' || hasAsciiPrefix(bytes, '<svg') || hasAsciiPrefix(bytes, '<?xml')) {
    const text = new TextDecoder().decode(bytes)
    const tag = text.match(/<svg\b[^>]*>/i)?.[0]
    if (tag) {
      const width = svgLength(tag.match(/\bwidth\s*=\s*["']([^"']+)/i)?.[1])
      const height = svgLength(tag.match(/\bheight\s*=\s*["']([^"']+)/i)?.[1])
      if (width && height) return valid(Math.ceil(width), Math.ceil(height))
      const viewBox = tag.match(/\bviewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/i)
      if (viewBox) return valid(Math.ceil(Number(viewBox[1])), Math.ceil(Number(viewBox[2])))
    }
  }
  return null
}

export async function readImageDimensions(file: Blob): Promise<ImageDimensions | null> {
  const prefix = new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer())
  return parseImageDimensions(prefix, file.type)
}

function svgLength(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|cm|mm|in|pt|pc)?\s*$/i)
  if (!match) return null
  const number = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const px = unit === 'cm' ? number * 96 / 2.54
    : unit === 'mm' ? number * 96 / 25.4
      : unit === 'in' ? number * 96
        : unit === 'pt' ? number * 96 / 72
          : unit === 'pc' ? number * 16
            : number
  return Number.isFinite(px) && px > 0 ? px : null
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 128)))
    .replace(/^\uFEFF/, '')
    .trimStart()
  return text.toLowerCase().startsWith(prefix)
}

function parseExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  const signature = [0x45, 0x78, 0x69, 0x66, 0, 0]
  if (!signature.every((value, index) => bytes[start + index] === value)) return null
  const tiff = start + signature.length
  const littleEndian = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
  if (!littleEndian && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return null
  const u16 = (offset: number) => littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1]
  const u32 = (offset: number) => littleEndian
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
  if (tiff + 8 > end || u16(tiff + 2) !== 42) return null
  const directory = tiff + u32(tiff + 4)
  if (directory + 2 > end) return null
  const entries = u16(directory)
  for (let i = 0; i < entries; i++) {
    const entry = directory + 2 + i * 12
    if (entry + 12 > end) return null
    if (u16(entry) !== 0x0112 || u16(entry + 2) !== 3 || u32(entry + 4) < 1) continue
    const valueOffset = u32(entry + 4) === 1 ? entry + 8 : tiff + u32(entry + 8)
    if (valueOffset + 2 > end) return null
    const value = u16(valueOffset)
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}
