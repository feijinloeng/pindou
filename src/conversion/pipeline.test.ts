import { describe, expect, it } from 'vitest'

import { analyzeSource } from './analyze'
import { BG_THRESHOLD, findSubjectBox, removeBackground, sampleCornerColor, shouldCrop } from './background'
import { mergeSmallComponents, majorityFilter } from './cleanup'
import { DEMO_PALETTE_RGB } from './testPalette'
import { checkerImage, dotImage, solidImage, toRgbBuffer } from './testImages'
import { convert, DEFAULT_SETTINGS, type ConversionSettings } from './convert'
import { ciede2000, rgbToLab, type Rgb } from './colorDistance'
import { downscale, downscaleAverage, downscaleDominant, fitToAspect } from './downscale'
import { limitColors } from './limitColors'
import { createMatcher, matchWithDither } from './match'

const WHITE = [255, 255, 255] as const
const BLACK = [0, 0, 0] as const
const RED = [255, 0, 0] as const

describe('内容分析', () => {
  it('白底黑线的图判为线稿', () => {
    const img = solidImage(64, 64, WHITE)
    for (let y = 8; y < 56; y += 8) {
      for (let x = 8; x < 56; x++) {
        const i = (y * 64 + x) * 4
        img.data[i] = 0
        img.data[i + 1] = 0
        img.data[i + 2] = 0
      }
    }
    const a = analyzeSource(img)
    expect(a.neutralRatio).toBeGreaterThan(0.98)
    expect(a.likelyLineArt || a.kind === 'lineart').toBe(true)
  })

  it('纯色块图判为像素画', () => {
    // 块要够大：8px 块的邻居平坦度是 0.89，达不到判据里的 0.9
    const img = checkerImage(64, 64, RED, WHITE, 16)
    const a = analyzeSource(img)
    expect(a.quantizedColorCount).toBeLessThanOrEqual(64)
    expect(a.kind).toBe('pixelart')
  })

  it('渐变图判为照片', () => {
    const img = solidImage(64, 64, WHITE)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4
        const v = Math.round((x / 63) * 255)
        img.data[i] = v
        img.data[i + 1] = 200 - Math.round((y / 63) * 100)
        img.data[i + 2] = 255 - v
      }
    }
    const a = analyzeSource(img)
    expect(a.kind).toBe('photo')
  })
})

describe('降采样', () => {
  it('纯中灰降采样后还是中灰（容差 ±2）', () => {
    const img = solidImage(128, 128, [128, 128, 128])
    const out = downscaleAverage(img, 16, 16)
    expect(out.data[0]).toBeGreaterThanOrEqual(126)
    expect(out.data[0]).toBeLessThanOrEqual(130)
    expect(out.data[0]).toBe(out.data[1])
    expect(out.data[1]).toBe(out.data[2])
  })

  it('均值必须在 linear 空间做：黑白各半得到 188，不是 128', () => {
    const img = checkerImage(64, 64, BLACK, WHITE, 1)
    const out = downscaleAverage(img, 8, 8)
    // linear 均值 0.5 → sRGB 188；在 sRGB 上直接平均会得到 128
    expect(out.data[0]).toBeGreaterThanOrEqual(186)
    expect(out.data[0]).toBeLessThanOrEqual(190)
    expect(out.data[0]).not.toBe(128)
  })

  it('主导色档：黑白棋盘不会出现中间灰', () => {
    const img = checkerImage(64, 64, BLACK, WHITE, 1)
    const out = downscaleDominant(img, 8, 8)
    for (let i = 0; i < out.width * out.height; i++) {
      const v = out.data[i * 3]
      expect(v === 0 || v === 255).toBe(true)
    }
  })

  it('主导色取的是桶内真实像素均值，不是量化值', () => {
    const img = solidImage(32, 32, [130, 130, 130])
    const out = downscaleDominant(img, 4, 4)
    expect(out.data[0]).toBe(130)
  })

  it('downscale 分发到两档', () => {
    const img = checkerImage(32, 32, BLACK, WHITE, 1)
    expect(downscale(img, 4, 4, 'mean').data[0]).toBeGreaterThan(100)
    expect([0, 255]).toContain(downscale(img, 4, 4, 'dominant').data[0])
  })

  it('fitToAspect cover 裁到目标比例且不变形', () => {
    const img = solidImage(200, 100, RED)
    const fitted = fitToAspect(img, 50, 50, 'cover')
    expect(fitted.width).toBe(100)
    expect(fitted.height).toBe(100)
  })

  it('fitToAspect stretch 原样返回', () => {
    const img = solidImage(200, 100, RED)
    expect(fitToAspect(img, 50, 50, 'stretch')).toBe(img)
  })
})

describe('色差匹配', () => {
  it('精确色直接命中', () => {
    const matcher = createMatcher(DEMO_PALETTE_RGB)
    for (let i = 0; i < DEMO_PALETTE_RGB.length; i++) {
      expect(matcher.match(DEMO_PALETTE_RGB[i])).toBe(i)
    }
  })

  it('近似色命中最近的色板项', () => {
    const matcher = createMatcher(DEMO_PALETTE_RGB)
    const redIndex = DEMO_PALETTE_RGB.findIndex((rgb) => rgb[0] === 210 && rgb[1] === 43)
    const near = matcher.match([250, 4, 4])
    expect(near).toBe(redIndex)
    expect(DEMO_PALETTE_RGB[near]).toEqual([210, 43, 43])
  })

  it('被排除的色永远不会被选中', () => {
    const allowed = DEMO_PALETTE_RGB.map(() => true)
    allowed[0] = false // 排掉黑
    const matcher = createMatcher(DEMO_PALETTE_RGB, allowed)
    expect(matcher.match([0, 0, 0])).not.toBe(0)
    expect(matcher.match([2, 2, 2])).not.toBe(0)
  })

  it('抖动是确定性的：跑两次逐格相同', () => {
    const img = checkerImage(64, 64, BLACK, WHITE, 3)
    const matcher = createMatcher(DEMO_PALETTE_RGB)
    const buffer = toRgbBuffer(img)
    const a = matchWithDither(buffer, 64, 64, matcher, 0.55)
    const b = matchWithDither(buffer, 64, 64, matcher, 0.55)
    expect(a).toEqual(b)
  })

  it('strength=0 就是纯最近色', () => {
    const img = checkerImage(16, 16, BLACK, WHITE, 1)
    const matcher = createMatcher(DEMO_PALETTE_RGB)
    const buffer = toRgbBuffer(img)
    const out = matchWithDither(buffer, 16, 16, matcher, 0)
    const expected = new Set<number>()
    for (let i = 0; i < 16 * 16; i++) {
      expected.add(matcher.match([buffer[i * 3], buffer[i * 3 + 1], buffer[i * 3 + 2]]))
    }
    expect(new Set(out)).toEqual(expected)
  })
})

describe('限色与关键色保护', () => {
  const entries = DEMO_PALETTE_RGB.map((rgb) => ({ rgb, lab: rgbToLab(rgb), oklab: rgbToLab(rgb) }))

  it('强制 8 色时黑色描边还在', () => {
    const usage = new Uint32Array(DEMO_PALETTE_RGB.length)
    usage[0] = 50 // 黑（描边，用量很小）
    for (let i = 2; i < 14; i++) usage[i] = 10_000 // 一堆中间调色
    const result = limitColors(usage, entries, { maxColors: 8 })
    expect(result.keep).toContain(0)
    expect(result.keep.length).toBeLessThanOrEqual(8)
  })

  it('超限时优先删灰泥而不是删低用量色', () => {
    const usage = new Uint32Array(DEMO_PALETTE_RGB.length)
    const grayIndex = DEMO_PALETTE_RGB.findIndex(
      (rgb) => Math.max(...rgb) - Math.min(...rgb) < 10 && rgb[0] > 50 && rgb[0] < 220,
    )
    expect(grayIndex).toBeGreaterThanOrEqual(0)
    usage[grayIndex] = 500 // 灰泥用量不低
    usage[1] = 20 // 低用量的高饱和色
    for (const i of [4, 5, 6, 7, 8, 9]) usage[i] = 1000
    const result = limitColors(usage, entries, { maxColors: 4 })
    expect(result.keep).not.toContain(grayIndex)
  })

  it('被删的色重映射到最近保留色', () => {
    const usage = new Uint32Array(DEMO_PALETTE_RGB.length)
    usage[3] = 100
    usage[6] = 100
    usage[0] = 100
    const result = limitColors(usage, entries, { maxColors: 2 })
    for (const [from, to] of result.remap) {
      if (!result.dropped.includes(from)) continue
      expect(ciede2000(entries[from].lab, entries[to].lab)).toBeLessThanOrEqual(
        Math.min(...result.keep.map((k) => ciede2000(entries[from].lab, entries[k].lab))) + 1e-9,
      )
    }
  })

  it('用量没超上限时一个都不删', () => {
    const usage = new Uint32Array(DEMO_PALETTE_RGB.length)
    usage[0] = 10
    usage[5] = 10
    const result = limitColors(usage, entries, { maxColors: 24 })
    expect(result.dropped).toEqual([])
    expect(result.keep).toHaveLength(2)
  })
})

describe('去杂', () => {
  it('3×3 多数滤波把孤点吃掉', () => {
    const cols = 5
    const cells = new Uint16Array(cols * cols).fill(1)
    cells[2 * cols + 2] = 2
    const changed = majorityFilter(cells, cols, cols, 1, 5)
    expect(changed).toBe(1)
    expect(cells[2 * cols + 2]).toBe(1)
  })

  it('多数滤波不动空格，背景不会啃掉图案边缘', () => {
    const cols = 3
    const cells = new Uint16Array(cols * cols).fill(0xffff)
    const idx = 1 * cols + 1
    cells[idx] = 5
    majorityFilter(cells, cols, cols, 1, 5)
    expect(cells[idx]).toBe(5)
  })

  it('高对比孤块（眼睛/点缀）必须保留', () => {
    const cols = 9
    const cells = new Uint16Array(cols * cols).fill(1)
    cells[4 * cols + 4] = 0 // 1 格黑点，落在白底上
    const luminance = new Float32Array([0, 255, 200])
    const merged = mergeSmallComponents(cells, {
      cols,
      rows: cols,
      luminance,
      minComponentSize: 2,
      contrastThreshold: 42,
      minMajority: 9,
      passes: 0,
    })
    expect(merged).toBe(0)
    expect(cells[4 * cols + 4]).toBe(0)
  })

  it('细微差色的孤点被并掉', () => {
    const cols = 9
    const cells = new Uint16Array(cols * cols).fill(1)
    cells[4 * cols + 4] = 2
    const luminance = new Float32Array([0, 200, 205]) // 亮度只差 5
    const merged = mergeSmallComponents(cells, {
      cols,
      rows: cols,
      luminance,
      minComponentSize: 2,
      contrastThreshold: 42,
      minMajority: 9,
      passes: 0,
    })
    expect(merged).toBe(1)
    expect(cells[4 * cols + 4]).toBe(1)
  })

  it('大块不会被合并（面积超过阈值）', () => {
    const cols = 9
    const cells = new Uint16Array(cols * cols).fill(1)
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) cells[y * cols + x] = 2
    const merged = mergeSmallComponents(cells, {
      cols,
      rows: cols,
      luminance: new Float32Array([0, 200, 205]),
      minComponentSize: 2,
      contrastThreshold: 42,
      minMajority: 9,
      passes: 0,
    })
    expect(merged).toBe(0)
  })
})

describe('去背景', () => {
  it('四角采样取到背景色', () => {
    const img = dotImage(64, 64, [240, 240, 240], RED, 30, 30, 4, 4)
    expect(sampleCornerColor(img)).toEqual([240, 240, 240])
  })

  it('只删与边界连通的背景，主体内部的同色块留着', () => {
    const rgb: Rgb[] = [
      [255, 255, 255],
      [0, 0, 0],
      [240, 240, 240],
    ]
    const cols = 5
    const cells = new Uint16Array(cols * cols).fill(0)
    cells[2 * cols + 2] = 1 // 中间一个黑点
    const removed = removeBackground(cells, cols, cols, rgb, [255, 255, 255], BG_THRESHOLD)
    expect(removed).toBe(24)
    expect(cells[2 * cols + 2]).toBe(1)
  })

  it('主体外接框 + 是否值得裁', () => {
    const img = dotImage(100, 100, WHITE, BLACK, 40, 40, 20, 20)
    const box = findSubjectBox(img, WHITE, BG_THRESHOLD)
    expect(box).not.toBeNull()
    expect(box!.x0).toBeLessThanOrEqual(40)
    expect(box!.x1).toBeGreaterThanOrEqual(59)
    expect(shouldCrop(box!, 100, 100)).toBe(true)
  })

  it('主体已经铺满时不裁', () => {
    const img = solidImage(100, 100, BLACK)
    const box = findSubjectBox(img, WHITE, BG_THRESHOLD)
    expect(shouldCrop(box!, 100, 100)).toBe(false)
  })
})

describe('整条链路', () => {
  const size = { cols: 52, rows: 52 }
  const settings = (over: Partial<ConversionSettings> = {}): ConversionSettings => ({
    ...DEFAULT_SETTINGS,
    ...over,
  })

  it('确定性：同一输入跑两次逐格完全相同', () => {
    const img = checkerImage(300, 200, BLACK, RED, 7)
    const a = convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: size.cols,
      rows: size.rows,
      settings: settings(),
    })
    const b = convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: size.cols,
      rows: size.rows,
      settings: settings(),
    })
    expect(a.cells).toEqual(b.cells)
  })

  it('像素画档：纯色块输入只产出该色，不做任何平滑', () => {
    const img = checkerImage(104, 104, RED, WHITE, 8)
    const result = convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: 26,
      rows: 26,
      settings: settings({ strategyId: 'pixelart', maxColors: 0, cropToSubject: false }),
    })
    expect(new Set(result.cells).size).toBe(2)
    expect(result.cells).toContain(4) // 红
    expect(result.cells).toContain(1) // 白
  })

  it('线稿档：粗细刚好一格的黑线不被吃掉', () => {
    // 104px / 26 格 = 每格 4px，所以 4px 的黑线正好落满一格
    const img = solidImage(104, 104, WHITE)
    for (let y = 0; y < 104; y++) {
      if ((y >> 2) % 2 === 1) continue
      for (let x = 0; x < 104; x++) {
        const i = (y * 104 + x) * 4
        img.data[i] = 0
        img.data[i + 1] = 0
        img.data[i + 2] = 0
      }
    }
    const result = convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: 26,
      rows: 26,
      settings: settings({ strategyId: 'lineart', maxColors: 0, cropToSubject: false }),
    })
    expect(result.usedIndexes).toContain(0)
  })

  it('去背景把四周留空，主体的豆还在', () => {
    const img = dotImage(104, 104, WHITE, BLACK, 40, 40, 24, 24)
    const result = convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: 26,
      rows: 26,
      settings: settings({
        strategyId: 'pixelart',
        maxColors: 0,
        cropToSubject: false,
        removeBackground: true,
      }),
    })
    expect(result.cells[0]).toBe(0xffff)
    expect([...result.cells].some((v) => v === 0)).toBe(true)
  })

  it('1000×1000 → 104×104 在 800ms 内跑完（Worker 内的时间预算）', () => {
    const img = checkerImage(1000, 1000, BLACK, WHITE, 5)
    const t0 = performance.now()
    convert({
      image: img,
      paletteColors: DEMO_PALETTE_RGB,
      cols: 104,
      rows: 104,
      settings: settings({ cropToSubject: false }),
    })
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(800)
  })

  it('进度回调按阶段报，最后一定是 1', () => {
    const seen: Array<[string, number]> = []
    convert({
      image: checkerImage(64, 64, BLACK, WHITE, 4),
      paletteColors: DEMO_PALETTE_RGB,
      cols: 26,
      rows: 26,
      settings: settings({ cropToSubject: false }),
      onProgress: (stage, ratio) => seen.push([stage, ratio]),
    })
    expect(seen.length).toBeGreaterThan(4)
    expect(seen.at(-1)?.[1]).toBe(1)
  })
})
