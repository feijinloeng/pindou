import { ciede2000, type PaletteLabEntry } from './colorDistance'

export interface LimitResult {
  /** 保留的色板索引，按用量降序 */
  keep: number[]
  /** 任意索引 → 保留的最近索引 */
  remap: Map<number, number>
  /** 被删掉的索引 */
  dropped: number[]
}

export interface LimitOptions {
  /** 目标色数的硬上限（1 起）；<= 0 表示不限制 */
  maxColors: number
  /**
   * 优先保住的索引（例如描边黑、高光白）。
   * 注意：上限不够时它们也会被裁 —— 上限优先，保不住就按用量留大的。
   */
  mustKeep?: number[]
}

/**
 * 限色 + 关键色保护。
 * 三步（第 8.2 节 ⑥）：
 *  1. 挑关键色：全色卡最暗 / 最亮，加上用量加权饱和度最高的
 *  2. 按用量降序补到 N 个
 *  3. 超了优先删"灰泥"（中间调灰），而不是删低用量色
 * 最后按最近色把被删的并到保留色上 —— 确定性，没有随机。
 * maxColors 是硬上限：关键色再多也不会超，"目标色数" 这个滑块说了算。
 */
export function limitColors(
  usage: Uint32Array,
  entries: PaletteLabEntry[],
  options: LimitOptions,
): LimitResult {
  const used: number[] = []
  for (let i = 0; i < usage.length; i++) if (usage[i] > 0) used.push(i)

  if (options.maxColors <= 0 || used.length <= options.maxColors) {
    return {
      keep: [...used].sort((a, b) => usage[b] - usage[a]),
      remap: identityMap(used),
      dropped: [],
    }
  }

  const keep = new Set<number>()

  // 1. 关键色
  for (const i of options.mustKeep ?? []) keep.add(i)
  // 只在"用到的色"里挑最暗/最亮：没用上的色不占名额，效果一样
  const darkest = pickExtreme(entries, used, (e) => e.lab[0], 'min')
  const lightest = pickExtreme(entries, used, (e) => e.lab[0], 'max')
  if (darkest !== -1) keep.add(darkest)
  if (lightest !== -1) keep.add(lightest)

  let bestSat = -1
  let bestSatScore = -1
  for (const i of used) {
    const [, a, b] = entries[i].lab
    const sat = Math.hypot(a, b)
    if (sat < 28) continue
    const score = sat * 10 + usage[i]
    if (score > bestSatScore) {
      bestSatScore = score
      bestSat = i
    }
  }
  if (bestSat >= 0) keep.add(bestSat)

  // 2. 按用量降序补满
  const byUsage = [...used].sort((a, b) => usage[b] - usage[a] || a - b)
  for (const i of byUsage) {
    if (keep.size >= options.maxColors) break
    keep.add(i)
  }

  // 3. 还超了（关键色太多）→ 优先删灰泥，其次删用量最低的
  while (keep.size > options.maxColors) {
    const candidates = [...keep].filter((i) => !(options.mustKeep ?? []).includes(i))
    if (candidates.length === 0) break
    const mud = candidates.filter((i) => isGrayMud(entries[i]))
    const pool = mud.length ? mud : candidates
    let victim = pool[0]
    for (const i of pool) if (usage[i] < usage[victim]) victim = i
    keep.delete(victim)
  }

  // 3b. 连关键色自己都超过上限（maxColors=1 却要保黑白）→ 按用量裁到上限，上限是硬约束
  if (keep.size > options.maxColors) {
    const ordered = [...keep].sort((a, b) => usage[b] - usage[a] || a - b)
    keep.clear()
    for (const i of ordered.slice(0, options.maxColors)) keep.add(i)
  }

  const keepList = [...keep].sort((a, b) => usage[b] - usage[a] || a - b)
  const dropped = used.filter((i) => !keep.has(i))
  const remap = nearestRemap(entries, dropped, keepList)
  for (const i of keepList) remap.set(i, i)
  return { keep: keepList, remap, dropped }
}

/** 中间调灰：饱和度低、亮度不上不下的那种"灰泥" */
export function isGrayMud(entry: PaletteLabEntry): boolean {
  const [l, a, b] = entry.lab
  const sat = Math.hypot(a, b)
  return sat < 30 && l > 50 && l < 220
}

function pickExtreme(
  entries: PaletteLabEntry[],
  from: number[],
  value: (e: PaletteLabEntry) => number,
  dir: 'min' | 'max',
): number {
  let best = -1
  let bestValue = dir === 'min' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  for (const i of from) {
    const v = value(entries[i])
    if (dir === 'min' ? v < bestValue : v > bestValue) {
      bestValue = v
      best = i
    }
  }
  return best
}

function identityMap(indexes: number[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const i of indexes) map.set(i, i)
  return map
}

/** 被删的色 → 最近保留色（用 CIEDE2000，没有随机） */
export function nearestRemap(
  entries: PaletteLabEntry[],
  dropped: number[],
  keep: number[],
): Map<number, number> {
  const map = new Map<number, number>()
  for (const i of dropped) {
    let best = keep[0]
    let bestDelta = Number.POSITIVE_INFINITY
    for (const k of keep) {
      const delta = ciede2000(entries[i].lab, entries[k].lab)
      if (delta < bestDelta) {
        bestDelta = delta
        best = k
      }
    }
    map.set(i, best)
  }
  return map
}
