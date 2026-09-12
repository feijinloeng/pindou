import type { BilateralOptions } from './preprocess'
import type { DownscaleMode } from './downscale'

export type StrategyId = 'general' | 'cartoon' | 'portrait' | 'pixelart' | 'lineart'

/** 用户在界面上选的内容类型：auto = 按内容分析结果自己挑 */
export type StrategyChoice = 'auto' | StrategyId

/** 内容分析 → 策略。分析结果现在真的驱动参数，不再只是一个显示用的结论 */
export const KIND_TO_STRATEGY: Record<'lineart' | 'pixelart' | 'document' | 'photo', StrategyId> =
  {
    lineart: 'lineart',
    pixelart: 'pixelart',
    // 文档 = 白底黑字，按线稿那套（不平滑、不去杂）处理线条最干净
    document: 'lineart',
    photo: 'general',
  }

/** 把“自动/手动”解析成真正干活的策略 */
export function resolveStrategy(
  choice: StrategyChoice,
  kind?: 'lineart' | 'pixelart' | 'document' | 'photo',
): ConversionStrategy {
  if (choice !== 'auto') return STRATEGIES[choice] ?? STRATEGIES.general
  return STRATEGIES[kind ? KIND_TO_STRATEGY[kind] : 'general']
}

export interface ConversionStrategy {
  id: StrategyId
  label: string
  description: string
  downscale: DownscaleMode
  bilateral: BilateralOptions | null
  /** 0 = 不抖动 */
  dither: number
  neutralBias: 'off' | 'normal' | 'strong'
  majorityPasses: number
  majorityThreshold: number
  /** 去杂面积阈值，0 = 不合并 */
  cleanupArea: number
  defaultMaxColors: number
}

/**
 * 四档策略表（第 8.3 节）。参数取自 a31521424 的思路，重新表的。
 * 像素画档必须关掉一切平滑和去杂：输入已经是离散像素，任何滤波都是破坏。
 */
export const STRATEGIES: Record<StrategyId, ConversionStrategy> = {
  general: {
    id: 'general',
    label: '通用',
    description: '照片和插画都行的中间档',
    downscale: 'mean',
    bilateral: { radius: 1, sigmaSpatial: 1.4, sigmaRange: 0.045, varianceThreshold: 0.003, strength: 0.45 },
    dither: 0.55,
    neutralBias: 'normal',
    majorityPasses: 1,
    majorityThreshold: 5,
    cleanupArea: 1,
    defaultMaxColors: 24,
  },
  cartoon: {
    id: 'cartoon',
    label: '卡通',
    description: '大色块、边界干净，适合动漫和图标',
    downscale: 'dominant',
    bilateral: { radius: 1, sigmaSpatial: 1.4, sigmaRange: 0.045, varianceThreshold: 0.003, strength: 0.45 },
    dither: 0,
    neutralBias: 'strong',
    majorityPasses: 2,
    majorityThreshold: 4,
    cleanupArea: 3,
    defaultMaxColors: 16,
  },
  portrait: {
    id: 'portrait',
    label: '人像',
    description: '脸部和皮肤过渡要平，少抖动',
    downscale: 'mean',
    bilateral: { radius: 1, sigmaSpatial: 1.4, sigmaRange: 0.045, varianceThreshold: 0.003, strength: 0.45 },
    dither: 0.35,
    neutralBias: 'normal',
    majorityPasses: 1,
    majorityThreshold: 5,
    cleanupArea: 2,
    defaultMaxColors: 32,
  },
  pixelart: {
    id: 'pixelart',
    label: '像素画',
    description: '一点都不动，原样落到豆格上',
    downscale: 'dominant',
    bilateral: null,
    dither: 0,
    neutralBias: 'off',
    majorityPasses: 0,
    majorityThreshold: 9,
    cleanupArea: 0,
    defaultMaxColors: 0, // 0 = 不限制
  },
  lineart: {
    id: 'lineart',
    label: '线稿',
    description: '黑白线条为主，保住细线不被吃掉',
    downscale: 'dominant',
    bilateral: null,
    dither: 0,
    neutralBias: 'off',
    majorityPasses: 0,
    majorityThreshold: 9,
    cleanupArea: 0,
    defaultMaxColors: 0,
  },
}

/**
 * 抖动强度：null = 跟随内容类型的默认值，0 = 明确关掉，>0 = 用这个值。
 * UI 必须显示【实际生效】的值，否则会出现「复选框没勾、实际却在抖动」。
 * 注意：auto 策略在转换前算不出默认值，所以只能报一个中立的兜底值 ——
 * 真正生效的值以转换结果里的 strategyUsed 为准。
 */
export function resolveDither(strategyId: StrategyChoice, dither: number | null): number {
  if (dither !== null && dither !== undefined) return dither
  return resolveStrategy(strategyId).dither
}

export const STRATEGY_LIST: ConversionStrategy[] = [
  STRATEGIES.general,
  STRATEGIES.cartoon,
  STRATEGIES.portrait,
  STRATEGIES.pixelart,
  STRATEGIES.lineart,
]

/** 界面下拉里的“自动”项（不属于 STRATEGIES：它自己没有参数） */
export const AUTO_OPTION = {
  id: 'auto' as const,
  label: '自动',
  description: '按图片内容自动挑档位',
}
