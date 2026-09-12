import { describe, expect, it } from 'vitest'

import { MM_PER_PT, PT_PER_MM, cellToMm, spanMm } from './geometry'

describe('针距与毫米换算', () => {
  it('spanMm(52, 2.6) = 135.2，不是 132.6（不是首末钉中心距）', () => {
    expect(spanMm(52, 2.6)).toBeCloseTo(135.2, 10)
    expect(spanMm(52, 2.6)).not.toBeCloseTo(132.6, 1)
  })

  it('板型全表针区宽度与第 6 节硬数据一致', () => {
    expect(spanMm(26, 2.6)).toBeCloseTo(67.6, 10)
    expect(spanMm(52, 2.6)).toBeCloseTo(135.2, 10)
    expect(spanMm(78, 2.6)).toBeCloseTo(202.8, 10)
    expect(spanMm(104, 2.6)).toBeCloseTo(270.4, 10)
    expect(spanMm(29, 5)).toBeCloseTo(145.0, 10)
  })

  it('cellToMm 的 y 向下为正', () => {
    const p = cellToMm(3, 4, 2.6)
    expect(p.x).toBeCloseTo(7.8, 10)
    expect(p.y).toBeCloseTo(10.4, 10)
  })

  it('PT 与 mm 互为倒数', () => {
    expect(PT_PER_MM).toBeCloseTo(2.8346456692913384, 12)
    expect(PT_PER_MM * MM_PER_PT).toBeCloseTo(1, 12)
  })
})
