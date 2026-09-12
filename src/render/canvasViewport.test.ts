import { describe, expect, it } from 'vitest'

import {
  CODE_ZOOM,
  clampZoom,
  fitViewport,
  screenToCell,
  snapZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  visibleRange,
  zoomAt,
  zoomFromWheel,
  type Viewport,
} from './canvasViewport'

function vp(zoom: number, panX = 0, panY = 0): Viewport {
  return { zoom, panX, panY, dpr: 1 }
}

describe('visibleRange 视口裁剪', () => {
  it('左上角对齐时只算看得到的那几格', () => {
    expect(visibleRange(vp(10), 1000, 1000, 100, 100)).toEqual({
      c0: 0,
      c1: 10,
      r0: 0,
      r1: 10,
    })
  })

  it('平移后起点按下取整、终点按上取整（半个格子也算可见）', () => {
    const r = visibleRange(vp(10, -25, -25), 1000, 1000, 100, 100)
    expect(r).toEqual({ c0: 2, c1: 13, r0: 2, r1: 13 })
  })

  it('小图 + 拉远：范围被画布尺寸夹住', () => {
    expect(visibleRange(vp(0.5), 3, 3, 1000, 1000)).toEqual({
      c0: 0,
      c1: 3,
      r0: 0,
      r1: 3,
    })
  })

  it('拖到右边界外也被夹住，不越界', () => {
    const r = visibleRange(vp(10, -9900, -9900), 1000, 1000, 100, 100)
    expect(r.c1).toBe(1000)
    expect(r.r1).toBe(1000)
  })

  it('133 万格只画一屏的格数（性能门禁的前提）', () => {
    const cols = 1144
    const rows = 1144
    const v = vp(20)
    const r = visibleRange(v, cols, rows, 1440, 900)
    const visible = (r.c1 - r.c0) * (r.r1 - r.r0)
    expect(visible).toBeLessThanOrEqual(72 * 45)
    expect(visible).toBeLessThan(cols * rows / 400)
  })

  it('完全移出画面时范围为空，不是负数', () => {
    const r = visibleRange(vp(10, 5000, 5000), 1000, 1000, 100, 100)
    expect(r.c0).toBeGreaterThanOrEqual(r.c1)
  })
})

describe('缩放与平移', () => {
  it('zoomAt 让光标下的豆格保持不动', () => {
    const before = vp(10, 20, 30)
    const point = { x: 220, y: 330 }
    const cellBefore = screenToCell(before, point.x, point.y)
    const after = zoomAt(before, 20, point.x, point.y)
    expect(screenToCell(after, point.x, point.y)).toEqual(cellBefore)
  })

  it('缩放被上下限夹住', () => {
    expect(clampZoom(1000)).toBe(64)
    expect(clampZoom(0.0001)).toBe(0.15)
  })

  it('100% 吸附只在附近生效', () => {
    expect(snapZoom(0.98)).toBe(1)
    expect(snapZoom(1.04)).toBe(1)
    expect(snapZoom(0.8)).toBe(0.8)
  })

  it('fitViewport 让整张 133 万格的图铺满并居中', () => {
    const v = fitViewport(1144, 1144, 1440, 900)
    expect(v.zoom).toBeCloseTo((900 - 48) / 1144, 10)
    expect(v.panX).toBeCloseTo((1440 - 1144 * v.zoom) / 2, 10)
    expect(v.panY).toBeCloseTo((900 - 1144 * v.zoom) / 2, 10)
  })

  it('fitViewport 对 24,336 格（3×3 个 52 板）也是铺满的', () => {
    const v = fitViewport(156, 156, 1200, 800)
    expect(v.zoom).toBeCloseTo((800 - 48) / 156, 10)
  })

  it('屏幕坐标 → 豆格：点到格子外返回负数，由调用方判越界', () => {
    expect(screenToCell(vp(10, -5, -5), 0, 0)).toEqual({ col: 0, row: 0 })
    expect(screenToCell(vp(10, 0, 0), -1, -1)).toEqual({ col: -1, row: -1 })
  })

  it('CODE_ZOOM 是 14（第 13.1 节）', () => {
    expect(CODE_ZOOM).toBe(14)
  })
})

describe('滚轮缩放', () => {
  const base = { zoom: 4, panX: 10, panY: 20, dpr: 2 }

  it('向上滚放大、向下滚缩小', () => {
    const zin = zoomFromWheel(base, -100, false, 0, 0)
    const zout = zoomFromWheel(base, 100, false, 0, 0)
    expect(zin.zoom).toBeGreaterThan(base.zoom)
    expect(zout.zoom).toBeLessThan(base.zoom)
  })

  it('捏合（ctrlKey）比滚轮灵敏得多', () => {
    const wheel = zoomFromWheel(base, -10, false, 0, 0)
    const pinch = zoomFromWheel(base, -10, true, 0, 0)
    // 灵敏度是"变化量"的比，不是结果的比（指数关系，比值会被压扁）
    expect(pinch.zoom - base.zoom).toBeGreaterThan((wheel.zoom - base.zoom) * 5)
  })

  it('缩放锚在光标那一点：光标下的豆格不动', () => {
    const before = screenToCell(base, 300, 400)
    const after = screenToCell(zoomFromWheel(base, -200, false, 300, 400), 300, 400)
    expect(after).toEqual(before)
  })

  it('缩到底也不会越过上下限', () => {
    expect(zoomFromWheel(base, 100000, false, 0, 0).zoom).toBe(MIN_ZOOM)
    expect(zoomFromWheel(base, -100000, false, 0, 0).zoom).toBe(MAX_ZOOM)
  })
})
