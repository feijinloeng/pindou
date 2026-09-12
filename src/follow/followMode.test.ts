import { describe, expect, it } from 'vitest'

import { createGrid } from '../domain/grid'
import { findRegionAt, findRegions, isColorComplete, progressOf, recommendRegion } from './followMode'

/** 三个分开的蓝块：小的在左上、最大的在中间、靠边的在右下 */
function threeBlobs() {
  const grid = createGrid(30, 30)
  const paint = (x0: number, y0: number, w: number, h: number, color = 5) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) grid.cells[y * 30 + x] = color
    }
  }
  paint(1, 1, 2, 2) // 区域 0：4 格
  paint(10, 10, 6, 6) // 区域 1：36 格（最大）
  paint(26, 26, 4, 4) // 区域 2：16 格，贴着右下角
  return grid
}

describe('连通域', () => {
  it('按扫描顺序编号，同图两次一致', () => {
    const a = findRegions(threeBlobs(), 5)
    const b = findRegions(threeBlobs(), 5)
    expect(a).toHaveLength(3)
    expect(a.map((r) => r.id)).toEqual([0, 1, 2])
    expect(a.map((r) => r.size)).toEqual([4, 36, 16])
    expect(a.map((r) => [...r.cells])).toEqual(b.map((r) => [...r.cells]))
  })

  it('外接框、中心、是否贴边都对', () => {
    const regions = findRegions(threeBlobs(), 5)
    expect(regions[1].bbox).toEqual({ c0: 10, r0: 10, c1: 15, r1: 15 })
    expect(regions[1].center).toEqual({ col: 12.5, row: 12.5 })
    expect(regions[0].touchesEdge).toBe(false)
    expect(regions[2].touchesEdge).toBe(true)
  })

  it('没有这个色号时返回空数组', () => {
    expect(findRegions(threeBlobs(), 9)).toEqual([])
  })

  it('点定位到区域', () => {
    const regions = findRegions(threeBlobs(), 5)
    expect(findRegionAt(regions, 12 * 30 + 12)?.id).toBe(1)
    expect(findRegionAt(regions, 27 * 30 + 27)?.id).toBe(2)
    expect(findRegionAt(regions, 0)).toBeNull()
  })
})

describe('推荐策略', () => {
  const regions = findRegions(threeBlobs(), 5)

  it('largest 选最大的', () => {
    expect(recommendRegion(regions, new Set(), 'largest', null)?.id).toBe(1)
  })

  it('nearest 选离上次落点最近的', () => {
    expect(recommendRegion(regions, new Set(), 'nearest', { col: 2, row: 2 })?.id).toBe(0)
    expect(recommendRegion(regions, new Set(), 'nearest', { col: 20, row: 20 })?.id).toBe(1)
    expect(recommendRegion(regions, new Set(), 'nearest', { col: 40, row: 40 })?.id).toBe(2)
  })

  it('nearest 没有落点信息时退化成 largest', () => {
    expect(recommendRegion(regions, new Set(), 'nearest', null)?.id).toBe(1)
  })

  it('edge-first 优先贴边的区域', () => {
    const picked = recommendRegion(regions, new Set(), 'edge-first', null)
    expect(picked?.touchesEdge).toBe(true)
  })

  it('已完成的会被跳过', () => {
    expect(recommendRegion(regions, new Set([1]), 'largest', null)?.id).toBe(2)
    expect(recommendRegion(regions, new Set([0, 1, 2]), 'largest', null)).toBeNull()
  })
})

describe('进度', () => {
  const regions = findRegions(threeBlobs(), 5)

  it('按格数算，不是按区域数', () => {
    const progress = progressOf(regions, new Set([0]))
    expect(progress.total).toBe(56)
    expect(progress.done).toBe(4)
    expect(progress.regionsLeft).toBe(2)
    expect(progress.ratio).toBeCloseTo(4 / 56, 6)
  })

  it('全完成就是 100%', () => {
    const progress = progressOf(regions, new Set([0, 1, 2]))
    expect(progress.ratio).toBe(1)
    expect(progress.regionsLeft).toBe(0)
    expect(isColorComplete(regions, new Set([0, 1, 2]))).toBe(true)
    expect(isColorComplete(regions, new Set([0, 1]))).toBe(false)
  })

  it('没有区域时不算完成', () => {
    expect(isColorComplete([], new Set())).toBe(false)
  })
})
