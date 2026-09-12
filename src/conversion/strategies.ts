import type { BilateralOptions } from './preprocess'
import type { DownscaleMode } from './downscale'

export type StrategyId = 'general' | 'cartoon' | 'portrait' | 'pixelart' | 'lineart'

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
 */
export function resolveDither(strategyId: StrategyId, dither: number | null): number {
  if (dither !== null && dither !== undefined) return dither
  return (STRATEGIES[strategyId] ?? STRATEGIES.general).dither
}

export const STRATEGY_LIST: ConversionStrategy[] = [
  STRATEGIES.general,
  STRATEGIES.cartoon,
  STRATEGIES.portrait,
  STRATEGIES.pixelart,
  STRATEGIES.lineart,
]
