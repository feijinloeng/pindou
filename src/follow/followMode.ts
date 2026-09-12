import { EMPTY, type CellGrid } from '../domain/grid'

/**
 * 跟做模式的连通域。区域编号由**扫描顺序**决定，所以同一张图两次跑结果一样 ——
 * 进度能存下来、下次打开还认得。
 */
export interface Region {
  /** 扫描顺序给出的编号，从 0 开始，确定性 */
  id: number
  colorIndex: number
  /** 该区域的格子索引（升序） */
  cells: Uint32Array
  size: number
  bbox: { c0: number; r0: number; c1: number; r1: number }
  touchesEdge: boolean
  center: { col: number; row: number }
}

export type RecommendStrategy = 'nearest' | 'largest' | 'edge-first'

export interface AllRegions {
  /** byColor[色板索引] = 该色号的连通域；编号从 0 开始，顺序 = 扫描顺序 */
  byColor: Region[][]
  /** 总区域数 */
  count: number
}

/**
 * 一次扫描，把所有色号的连通域一起找出来。
 *
 * 为什么不是每个色号来一次：291 色 × 130 万格 = 3.8 亿次访问，页面直接卡死。
 * 一次扫描是 130 万次。**同色号内部的编号顺序和逐个扫完全一致**，
 * 所以已经存下来的跟做进度（记的是编号）不会失效。
 */
export function findAllRegions(grid: CellGrid): AllRegions {
  const { cols, rows, cells } = grid
  const visited = new Uint8Array(cols * rows)
  const byColor: Region[][] = []
  const component: number[] = []
  const stack: number[] = []
  let count = 0

  for (let start = 0; start < cells.length; start++) {
    const colorIndex = cells[start]
    if (visited[start] || colorIndex === EMPTY) continue
    component.length = 0
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    let minX = cols
    let minY = rows
    let maxX = 0
    let maxY = 0
    let touchesEdge = false

    while (stack.length) {
      const i = stack.pop()!
      component.push(i)
      const x = i % cols
      const y = (i - x) / cols
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesEdge = true
      if (x > 0 && !visited[i - 1] && cells[i - 1] === colorIndex) {
        visited[i - 1] = 1
        stack.push(i - 1)
      }
      if (x + 1 < cols && !visited[i + 1] && cells[i + 1] === colorIndex) {
        visited[i + 1] = 1
        stack.push(i + 1)
      }
      if (y > 0 && !visited[i - cols] && cells[i - cols] === colorIndex) {
        visited[i - cols] = 1
        stack.push(i - cols)
      }
      if (y + 1 < rows && !visited[i + cols] && cells[i + cols] === colorIndex) {
        visited[i + cols] = 1
        stack.push(i + cols)
      }
    }

    component.sort((a, b) => a - b)
    const list = (byColor[colorIndex] ??= [])
    list.push({
      id: list.length,
      colorIndex,
      cells: Uint32Array.from(component),
      size: component.length,
      bbox: { c0: minX, r0: minY, c1: maxX, r1: maxY },
      touchesEdge,
      center: { col: (minX + maxX) / 2, row: (minY + maxY) / 2 },
    })
    count++
  }
  return { byColor, count }
}

/** 只要一个色号时用这个（内部是一次全扫，单色号场景够用） */
export function findRegions(grid: CellGrid, colorIndex: number): Region[] {
  return findAllRegions(grid).byColor[colorIndex] ?? []
}

/** 点在哪一格，就落到哪个区域上 */
export function findRegionAt(regions: Region[], index: number): Region | null {
  for (const region of regions) {
    // cells 是升序的，二分就够；区域一般很小，直接扫也快
    let low = 0
    let high = region.cells.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const value = region.cells[mid]
      if (value === index) return region
      if (value < index) low = mid + 1
      else high = mid - 1
    }
  }
  return null
}

/**
 * 推荐下一个区域。三种策略（第 12 节）：
 *  nearest    离上次落点最近的
 *  largest    最大的
 *  edge-first 含边缘格子的优先
 */
export function recommendRegion(
  regions: Region[],
  completed: Set<number>,
  strategy: RecommendStrategy,
  lastPoint: { col: number; row: number } | null,
): Region | null {
  const remaining = regions.filter((r) => !completed.has(r.id))
  if (remaining.length === 0) return null

  if (strategy === 'largest') {
    return remaining.reduce((best, r) =>
      r.size > best.size || (r.size === best.size && r.id < best.id) ? r : best,
    )
  }
  if (strategy === 'edge-first') {
    const edge = remaining.filter((r) => r.touchesEdge)
    const pool = edge.length ? edge : remaining
    return pool.reduce((best, r) =>
      r.size > best.size || (r.size === best.size && r.id < best.id) ? r : best,
    )
  }
  if (!lastPoint) {
    return remaining.reduce((best, r) =>
      r.size > best.size || (r.size === best.size && r.id < best.id) ? r : best,
    )
  }
  return remaining.reduce((best, r) => {
    const d = distanceTo(r, lastPoint)
    const bestD = distanceTo(best, lastPoint)
    if (d < bestD || (d === bestD && r.id < best.id)) return r
    return best
  })
}

function distanceTo(region: Region, point: { col: number; row: number }): number {
  // 点到外接框的距离：在外接框里就是 0
  const dx = Math.max(region.bbox.c0 - point.col, 0, point.col - region.bbox.c1)
  const dy = Math.max(region.bbox.r0 - point.row, 0, point.row - region.bbox.r1)
  return Math.hypot(dx, dy)
}

export interface FollowProgress {
  /** 这个色号一共多少格 */
  total: number
  /** 已完成多少格 */
  done: number
  /** 还剩多少个区域 */
  regionsLeft: number
  regionsTotal: number
  ratio: number
}

export function progressOf(regions: Region[], completed: Set<number>): FollowProgress {
  let total = 0
  let done = 0
  for (const region of regions) {
    total += region.size
    if (completed.has(region.id)) done += region.size
  }
  const regionsDone = regions.filter((r) => completed.has(r.id)).length
  return {
    total,
    done,
    regionsLeft: regions.length - regionsDone,
    regionsTotal: regions.length,
    ratio: total === 0 ? 1 : done / total,
  }
}

/** 这个色号是不是整色都拼完了 */
export function isColorComplete(regions: Region[], completed: Set<number>): boolean {
  return regions.length > 0 && regions.every((r) => completed.has(r.id))
}

export { EMPTY }
