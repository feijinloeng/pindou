#!/usr/bin/env node
/**
 * 生成端到端测试用的固定图片（不装任何依赖，Node 自带 zlib）。
 *
 * 为什么要固定图片：e2e 断言的是"转换出多少色、裁到哪里"，
 * 每次换一张图，断言的数字就全变了，回归就没法当门禁用。
 *
 * 图片内容：左边彩条 + 中间黑线条区域 + 白色背景，
 * 一次覆盖色块、线稿、纯背景三种内容分析路径。
 *
 * 用法：node scripts/make-test-image.mjs [输出路径]
 *       默认写到 samples/e2e/test-image.png
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const WIDTH = 640
const HEIGHT = 480
const OUT = process.argv[2] ?? join(process.cwd(), 'samples/e2e/test-image.png')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const BARS = [
  [230, 40, 40],
  [240, 140, 40],
  [240, 210, 60],
  [70, 170, 80],
  [60, 130, 210],
  [130, 80, 190],
]

/** 逐行写像素：行首是 PNG 的 filter 字节（0 = 不过滤） */
const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT)
let p = 0
for (let y = 0; y < HEIGHT; y++) {
  raw[p++] = 0
  for (let x = 0; x < WIDTH; x++) {
    let rgb = [255, 255, 255]
    if (x < 160) {
      // 彩条：色块图，判像素画/卡通
      rgb = BARS[Math.min(BARS.length - 1, Math.floor(y / (HEIGHT / BARS.length)))]
    } else if (x >= 240 && x < 520 && y >= 60 && y < 420) {
      // 横线区域：黑线条，判线稿
      rgb = Math.floor((y - 60) / 12) % 2 === 0 ? [10, 10, 10] : [255, 255, 255]
    } else if (x >= 160 && x < 240) {
      // 渐变：给内容分析一个"照片"味道的过渡带
      const v = Math.round(((x - 160) / 79) * 255)
      rgb = [v, 120, 255 - v]
    }
    raw[p++] = rgb[0]
    raw[p++] = rgb[1]
    raw[p++] = rgb[2]
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(WIDTH, 0)
ihdr.writeUInt32BE(HEIGHT, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // color type: truecolor
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`${OUT}  ${WIDTH}×${HEIGHT}  ${(png.length / 1024).toFixed(1)}KB`)
