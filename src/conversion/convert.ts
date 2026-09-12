import { EMPTY } from '../domain/grid'
import { analyzeSource, type SourceAnalysis } from './analyze'
import {
  findSubjectBox,
  MIN_BG_CONFIDENCE,
  removeBackground,
  sampleBackground,
  shouldCrop,
  BG_THRESHOLD,
} from './background'
import { mergeSmallComponents, majorityFilter } from './cleanup'
import type { PaletteLabEntry, Rgb } from './colorDistance'
import { cropRect, downscale, fitToAspect, type FitMode } from './downscale'
import { limitColors, nearestRemap } from './limitColors'
import { createMatcher, matchWithDither } from './match'
import { bilateralFilter, luminanceOf, neutralBias } from './preprocess'
import { resolveDither, resolveStrategy, type StrategyChoice, type StrategyId } from './strategies'
import type { SourceImage } from './types'

export interface ConversionSettings {
  /** auto = 按内容分析自动选；其它值是手动指定 */
  strategyId: StrategyChoice
  /** 目标色数，0 = 不限制 */
  maxColors: number
  /** null = 用策略默认 */
  dither: number | null
  cropToSubject: boolean
  removeBackground: boolean
  clearExisting: boolean
  fit: FitMode
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  strategyId: 'auto',
  maxColors: 24,
  dither: null,
  cropToSubject: true,
  removeBackground: false,
  clearExisting: true,
  fit: 'cover',
}

export interface ConvertInput {
  image: SourceImage
  /** 色板 RGB（顺序 = 色板索引） */
  paletteColors: Rgb[]
  /** 可用色遮罩（false = 被用户排除） */
  allowed?: boolean[]
  cols: number
  rows: number
  settings: ConversionSettings
  /** 已有的画布内容，clearExisting=false 时当作底图 */
  existing?: Uint16Array
  onProgress?: (stage: string, ratio: number) => void
}

export interface ConvertResult {
  cells: Uint16Array
  analysis: SourceAnalysis
  /** 真正干活的那个策略（strategyId=auto 时由分析结果决定） */
  strategyUsed: StrategyId
  /** 真正生效的抖动强度 */
  ditherUsed: number
  /** 采样到的背景色置信度；低 = 背景判断不可靠 */
  backgroundConfidence: number
  /** 因为背景色不可靠而跳过了自动裁切 */
  cropSkipped: boolean
  /** 真正用到的色板索引 */
  usedIndexes: number[]
  /** 被限色调掉的索引（UI 提示用） */
  droppedIndexes: number[]
  /** 背景色（去背景用的那个） */
  backgroundRgb: Rgb | null
  /** 主体外接框是否生效 */
  cropped: boolean
}

export const STAGE_LABELS = [
  '分析内容',
  '裁到主体',
  '降采样',
  '预处理',
  '色差匹配',
  '限制色数',
  '去杂',
  '去背景',
] as const

/**
 * 转换主链路：解码后的图像 → CellGrid。
 * 纯函数 + 无随机（adr/0004）：同样的输入必须产出逐格完全相同的输出。
 */
export function convert(input: ConvertInput): ConvertResult {
  const { cols, rows, paletteColors, settings } = input
  const report = input.onProgress ?? (() => {})

  report('分析内容', 0)
  const analysis = analyzeSource(input.image)
  // 分析结果真的参与决策：strategyId=auto 时靠它选档，不再只是展示结论
  const strategy = resolveStrategy(settings.strategyId, analysis.kind)
  const ditherUsed = resolveDither(strategy.id, settings.dither)

  report('裁到主体', 0.1)
  let image = input.image
  let backgroundRgb: Rgb | null = null
  let backgroundConfidence = 0
  let cropped = false
  let cropSkipped = false
  if (settings.cropToSubject || settings.removeBackground) {
    const sample = sampleBackground(image)
    backgroundRgb = sample.rgb
    backgroundConfidence = sample.confidence
  }
  if (settings.cropToSubject && backgroundRgb) {
    // 背景不可靠时不自动裁：宁可什么都不做，也不要默默把主体切掉
    if (backgroundConfidence < MIN_BG_CONFIDENCE) {
      cropSkipped = true
    } else {
      const box = findSubjectBox(image, backgroundRgb, BG_THRESHOLD)
      if (box && shouldCrop(box, image.width, image.height)) {
        const w = box.x1 - box.x0 + 1
        const h = box.y1 - box.y0 + 1
        image = { width: w, height: h, data: cropRect(image, box.x0, box.y0, w, h) }
        cropped = true
      }
    }
  }

  report('降采样', 0.25)
  const fitted = fitToAspect(image, cols, rows, settings.fit)
  const small = downscale(fitted, cols, rows, strategy.downscale)

  report('预处理', 0.4)
  let rgbData = small.data
  if (strategy.bilateral) rgbData = bilateralFilter(rgbData, cols, rows, strategy.bilateral)
  if (strategy.neutralBias !== 'off') neutralBias(rgbData, strategy.neutralBias)

  report('色差匹配', 0.55)
  const matcher = createMatcher(paletteColors, input.allowed)
  const cells = matchWithDither(rgbData, cols, rows, matcher, ditherUsed)

  report('限制色数', 0.7)
  let droppedIndexes: number[] = []
  let remap: Map<number, number> | null = null
  if (settings.maxColors > 0) {
    const usage = new Uint32Array(paletteColors.length)
    for (const v of cells) usage[v]++
    const result = limitColors(usage, matcher.entries, {
      maxColors: settings.maxColors,
      mustKeep: pickMustKeep(usage, matcher.entries),
    })
    droppedIndexes = result.dropped
    if (result.dropped.length) {
      remap = result.remap
      for (let i = 0; i < cells.length; i++) {
        const mapped = remap.get(cells[i])
        if (mapped !== undefined) cells[i] = mapped
      }
    }
  }
  void remap

  report('去杂', 0.82)
  const luminance = new Float32Array(paletteColors.length)
  for (let i = 0; i < paletteColors.length; i++) luminance[i] = luminanceOf(paletteColors[i])
  if (strategy.majorityPasses > 0) {
    majorityFilter(cells, cols, rows, strategy.majorityPasses, strategy.majorityThreshold)
  }
  if (strategy.cleanupArea > 0) {
    mergeSmallComponents(cells, {
      cols,
      rows,
      luminance,
      minComponentSize: strategy.cleanupArea,
      contrastThreshold: 42,
      keyColors: keyColorIndexes(paletteColors, luminance),
      minMajority: 9,
      passes: 0,
    })
  }

  report('去背景', 0.92)
  if (settings.removeBackground && backgroundRgb) {
    removeBackground(cells, cols, rows, paletteColors, backgroundRgb, BG_THRESHOLD)
  }

  // 保留底图时，把空格处填回底图内容
  if (!settings.clearExisting && input.existing) {
    for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) cells[i] = input.existing[i]
  }

  const used = new Set<number>()
  for (const v of cells) if (v !== EMPTY) used.add(v)
  report('完成', 1)
  return {
    cells,
    analysis,
    strategyUsed: strategy.id,
    ditherUsed,
    backgroundConfidence,
    cropSkipped,
    usedIndexes: [...used].sort((a, b) => a - b),
    droppedIndexes,
    backgroundRgb,
    cropped,
  }
}

/** 关键色 = 用到的色里最暗和最亮的那两个，限色时必须保住（描边色就是这么留下来的） */
function pickMustKeep(usage: Uint32Array, entries: PaletteLabEntry[]): number[] {
  let dark = -1
  let light = -1
  for (let i = 0; i < usage.length; i++) {
    if (usage[i] === 0) continue
    if (dark < 0 || entries[i].lab[0] < entries[dark].lab[0]) dark = i
    if (light < 0 || entries[i].lab[0] > entries[light].lab[0]) light = i
  }
  if (dark < 0) return []
  return dark === light ? [dark] : [dark, light]
}

/** 关键色 = 全色卡最暗最亮两个，去杂时不许删 */
function keyColorIndexes(paletteColors: Rgb[], luminance: Float32Array): number[] {
  let dark = 0
  let light = 0
  for (let i = 1; i < paletteColors.length; i++) {
    if (luminance[i] < luminance[dark]) dark = i
    if (luminance[i] > luminance[light]) light = i
  }
  return dark === light ? [dark] : [dark, light]
}

/** 用真正的最近色把被删的色并回去（限色后重映射的那一步） */
export function remapCells(cells: Uint16Array, map: Map<number, number>): void {
  for (let i = 0; i < cells.length; i++) {
    const mapped = map.get(cells[i])
    if (mapped !== undefined) cells[i] = mapped
  }
}

export { nearestRemap }
