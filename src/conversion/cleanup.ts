import { EMPTY } from '../domain/grid'

export interface CleanupOptions {
  cols: number
  rows: number
  /** 每个色板索引的亮度（0-255），算对比度用 */
  luminance: Float32Array
  /** 面积 ≤ 这个值的连通块才考虑合并 */
  minComponentSize: number
  /** 亮度差 ≥ 这个值的孤块必须保留（眼睛、表情、点缀） */
  contrastThreshold: number
  /** 关键色索引，永不被删 */
  keyColors?: number[]
  /** 多数滤波：9 格里至少这么多格同色才替换 */
  minMajority: number
  /** 多数滤波跑几轮 */
  passes: number
}

/**
 * 3×3 多数滤波：每格看 8 邻域 + 自身，出现次数最多的颜色替换本格。
 * EMPTY 不参与替换（否则背景会把图案边缘啃掉）。
 */
export function majorityFilter(
  cells: Uint16Array,
  cols: number,
  rows: number,
  passes: number,
  minMajority: number,
): number {
  let changed = 0
  for (let pass = 0; pass < passes; pass++) {
    const src = cells.slice()
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const self = src[y * cols + x]
        if (self === EMPTY) continue
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= rows) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= cols) continue
            const v = src[ny * cols + nx]
            if (v === EMPTY) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let bestColor = self
        let bestCount = 0
        for (const [color, count] of counts) {
          if (count > bestCount || (count === bestCount && color < bestColor)) {
            bestColor = color
            bestCount = count
          }
        }
        if (bestColor !== self && bestCount >= minMajority) {
          cells[y * cols + x] = bestColor
          changed++
        }
      }
    }
  }
  return changed
}

/**
 * 小连通域合并：面积 ≤ minComponentSize 的块并进邻接最多的颜色。
 * 但高对比孤块（亮度差 ≥ contrastThreshold）和关键色一律保留 —— 那是眼睛和点缀，不是噪点。
 */
export function mergeSmallComponents(cells: Uint16Array, options: CleanupOptions): number {
  const { cols, rows, minComponentSize, contrastThreshold, luminance } = options
  const keyColors = new Set(options.keyColors ?? [])
  const visited = new Uint8Array(cols * rows)
  const stack: number[] = []
  const component: number[] = []
  let merged = 0

  for (let start = 0; start < cells.length; start++) {
    if (visited[start] || cells[start] === EMPTY) continue
    const color = cells[start]
    stack.length = 0
    component.length = 0
    stack.push(start)
    visited[start] = 1

    // 4 邻域洪泛，显式栈
    while (stack.length) {
      const i = stack.pop()!
      component.push(i)
      const x = i % cols
      const y = (i - x) / cols
      if (x > 0 && !visited[i - 1] && cells[i - 1] === color) {
        visited[i - 1] = 1
        stack.push(i - 1)
      }
      if (x + 1 < cols && !visited[i + 1] && cells[i + 1] === color) {
        visited[i + 1] = 1
        stack.push(i + 1)
      }
      if (y > 0 && !visited[i - cols] && cells[i - cols] === color) {
        visited[i - cols] = 1
        stack.push(i - cols)
      }
      if (y + 1 < rows && !visited[i + cols] && cells[i + cols] === color) {
        visited[i + cols] = 1
        stack.push(i + cols)
      }
    }

    if (component.length > minComponentSize || keyColors.has(color)) continue

    // 邻接颜色统计 + 最大亮度差
    const neighbors = new Map<number, number>()
    let maxContrast = 0
    const selfLum = luminance[color] ?? 0
    for (const i of component) {
      const x = i % cols
      const y = (i - x) / cols
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const v = cells[ny * cols + nx]
        if (v === color) continue
        if (v !== EMPTY) {
          neighbors.set(v, (neighbors.get(v) ?? 0) + 1)
          maxContrast = Math.max(maxContrast, Math.abs((luminance[v] ?? 0) - selfLum))
        }
      }
    }

    if (maxContrast >= contrastThreshold) continue // 高对比孤块，留着
    if (neighbors.size === 0) continue

    let target = -1
    let targetCount = 0
    for (const [v, count] of neighbors) {
      if (count > targetCount || (count === targetCount && v < target)) {
        target = v
        targetCount = count
      }
    }
    if (target === -1) continue
    for (const i of component) cells[i] = target
    merged += component.length
  }
  return merged
}

const NEIGHBORS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
