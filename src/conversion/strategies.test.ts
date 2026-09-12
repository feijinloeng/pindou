import { describe, expect, it } from 'vitest'

import { resolveDither, STRATEGY_LIST, STRATEGIES } from './strategies'

describe('抖动取值', () => {
  it('null = 跟随内容类型默认值', () => {
    expect(resolveDither('general', null)).toBe(STRATEGIES.general.dither)
    expect(resolveDither('cartoon', null)).toBe(0)
    expect(resolveDither('portrait', null)).toBe(0.35)
  })

  it('0 = 明确关掉，不会退回默认值（?? 不能把 0 当成空）', () => {
    expect(resolveDither('portrait', 0)).toBe(0)
    expect(resolveDither('general', 0)).toBe(0)
  })

  it('>0 = 用这个值，覆盖默认', () => {
    expect(resolveDither('cartoon', 0.8)).toBe(0.8)
  })

  it('未知内容类型不崩，退回通用档', () => {
    expect(resolveDither('nope' as never, null)).toBe(STRATEGIES.general.dither)
    expect(STRATEGY_LIST.length).toBeGreaterThanOrEqual(4)
  })
})
