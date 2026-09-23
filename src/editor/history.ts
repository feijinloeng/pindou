import { type CellGrid, inBounds } from '../domain/grid'

/**
 * 增量撤销：只记被改动的格，不存全量快照。
 * 500 万格的全量快照是 10 MB/次，50 步就是 500 MB —— 这就是不能快照的原因。
 */
/**
 * 换色板 / 排除色号会改「网格以外的状态」：只回放格子的话，
 * 撤销后网格值回去了、色板还是新的，同一堆索引会被另一套色解释 —— 看着就完全不对。
 * 所以这类补丁顺带把元数据快照一起存。
 */
export interface HistoryMeta {
  paletteId: string
  allowedCodes: string[] | null
  colorIndex: number
}

export interface CellPatch {
  label: string
  indexes: Uint32Array
  before: Uint16Array
  after: Uint16Array
  /** 撤销时要恢复的元数据 */
  metaBefore?: HistoryMeta
  /** 重做时要恢复的元数据 */
  metaAfter?: HistoryMeta
}

const HISTORY_DEPTH = 50
/** 单次操作上限：超过就不计入撤销历史，只留改动（第 13.4 节） */
const MAX_PATCH_CELLS = 2_000_000
/** Keep undo and redo data under 64 MiB even when every step changes many cells. */
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024

const INITIAL_CAPACITY = 1024

/**
 * 记录器同时负责写格子和记账：写哪一格，就顺手把"改动前"记下来。
 * 反复写同一格会记多条，撤销时按逆序回放，所以仍然能还原。
 */
export class PatchRecorder {
  private idx = new Uint32Array(INITIAL_CAPACITY)
  private bef = new Uint16Array(INITIAL_CAPACITY)
  private aft = new Uint16Array(INITIAL_CAPACITY)
  private n = 0
  /** 这次操作太大，没进撤销栈 */
  overflowed = false

  private readonly grid: CellGrid
  readonly label: string
  private readonly limit: number

  constructor(grid: CellGrid, label: string, limit = MAX_PATCH_CELLS) {
    this.grid = grid
    this.label = label
    this.limit = limit
  }

  /** 写一格。返回是否真的改了（越界或同值返回 false）。 */
  set(col: number, row: number, value: number): boolean {
    if (!inBounds(this.grid, col, row)) return false
    const cells = this.grid.cells
    const i = row * this.grid.cols + col
    const prev = cells[i]
    if (prev === value) return false
    cells[i] = value
    if (this.overflowed) return true

    if (this.n >= this.limit) {
      this.overflowed = true
      this.idx = new Uint32Array(0)
      this.bef = new Uint16Array(0)
      this.aft = new Uint16Array(0)
      this.n = 0
      return true
    }
    if (this.n === this.idx.length) this.grow()
    this.idx[this.n] = i
    this.bef[this.n] = prev
    this.aft[this.n] = value
    this.n++
    return true
  }

  get size(): number {
    return this.overflowed ? 0 : this.n
  }

  private grow(): void {
    const next = Math.min(this.idx.length * 2, this.limit)
    const idx = new Uint32Array(next)
    const bef = new Uint16Array(next)
    const aft = new Uint16Array(next)
    idx.set(this.idx)
    bef.set(this.bef)
    aft.set(this.aft)
    this.idx = idx
    this.bef = bef
    this.aft = aft
  }

  /** 没有改动（或已超限）时返回 null */
  patch(): CellPatch | null {
    if (this.overflowed || this.n === 0) return null
    return {
      label: this.label,
      indexes: this.idx.slice(0, this.n),
      before: this.bef.slice(0, this.n),
      after: this.aft.slice(0, this.n),
    }
  }
}

/** 撤销按逆序回放（同一格写过多次时顺序很关键），重做按正序 */
function applyPatch(grid: CellGrid, patch: CellPatch, direction: 'undo' | 'redo'): void {
  const values = direction === 'undo' ? patch.before : patch.after
  const cells = grid.cells
  if (direction === 'undo') {
    for (let i = patch.indexes.length - 1; i >= 0; i--) cells[patch.indexes[i]] = values[i]
  } else {
    for (let i = 0; i < patch.indexes.length; i++) cells[patch.indexes[i]] = values[i]
  }
}

export class History {
  private undoStack: CellPatch[] = []
  private redoStack: CellPatch[] = []
  private storedBytes = 0
  readonly depth: number
  readonly maxBytes: number

  constructor(depth = HISTORY_DEPTH, maxBytes = MAX_HISTORY_BYTES) {
    this.depth = depth
    this.maxBytes = maxBytes
  }

  push(patch: CellPatch): void {
    for (const item of this.redoStack) this.storedBytes -= patchBytes(item)
    this.redoStack.length = 0
    this.undoStack.push(patch)
    this.storedBytes += patchBytes(patch)
    while (this.undoStack.length > this.depth || this.storedBytes > this.maxBytes) {
      const oldest = this.undoStack.shift()
      if (!oldest) break
      this.storedBytes -= patchBytes(oldest)
    }
  }

  undo(grid: CellGrid): CellPatch | null {
    const patch = this.undoStack.pop()
    if (!patch) return null
    applyPatch(grid, patch, 'undo')
    this.redoStack.push(patch)
    return patch
  }

  redo(grid: CellGrid): CellPatch | null {
    const patch = this.redoStack.pop()
    if (!patch) return null
    applyPatch(grid, patch, 'redo')
    this.undoStack.push(patch)
    return patch
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.storedBytes = 0
  }

  get bytes(): number {
    return this.storedBytes
  }
}

function patchBytes(patch: CellPatch): number {
  return patch.indexes.byteLength + patch.before.byteLength + patch.after.byteLength
}
