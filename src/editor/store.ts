import { create } from 'zustand'

import {
  deriveLayoutGeometry,
  emptyBoardGeometry,
  findBoardProfile,
  type BoardGeometry,
  type BoardLayout,
  type BoardPlacement,
  type BoardTypeId,
  WARN_CELLS,
} from '../domain/board'
import { EMPTY, type CellGrid, createGrid, inBounds } from '../domain/grid'
import { type Palette } from '../domain/palette'
import { allowedMask, defaultColorIndex, getPalette, paletteRgb } from '../data/palettes'
import { createMatcher } from '../conversion/match'
import { EDITOR_FIT_PAD, fitViewport, type Viewport } from '../render/canvasViewport'
import { History, PatchRecorder, type CellPatch, type HistoryMeta } from './history'
import {
  copySelection,
  invertSelection,
  makeRect,
  mirrorRect,
  pasteClip,
  rotateRect,
  translateGrid,
  type Clip,
  type Rect,
  type Selection,
} from './selection'
import { fillSelection } from './selection'
import { floodFill, paint, pickColor, type WriteSink } from './tools'
import { DEFAULT_SETTINGS, type ConversionSettings } from '../conversion/convert'
import {
  createProject,
  normalizeGridForLayout,
  type Project,
  type ProjectView,
} from '../domain/project'
import { putProject, rememberLastProject, restoreLastProject, saveDraft, getImage, putImage, remove } from '../storage/db'
import { compressForCache } from '../storage/imageCache'
import { runConvert } from '../conversion/convertClient'
import { resolveStrategy, STRATEGIES } from '../conversion/strategies'
import { decodeImageFile } from '../conversion/decode'
import type { Rgb } from '../conversion/colorDistance'
import type { SourceImage } from '../conversion/types'
import { t } from '../i18n/zh'

export type ToolId = 'select' | 'pencil' | 'eraser' | 'picker' | 'bucket' | 'rect' | 'pan'

/** 画布旁边同一时间只开一个临时面板。transform 是纯展示面板（整图变换），不动 store 数据 */
export type PanelId = 'boards' | 'color' | 'image' | 'transform' | 'library'
/** 两个目的地：编辑 / 导出 */
export type Stage = 'edit' | 'export'

export interface EditorState {
  /** 作品名（导出文件名用它） */
  name: string
  /** 画布上的自由摆放板列表 */
  layout: BoardLayout
  projectId: string
  customer: string | null
  createdAt: string
  /** 上次保存时间（界面显示"已保存"用） */
  savedAt: string | null
  saving: boolean
  /** 上次保存失败的原文（界面显示"保存失败，点击重试"） */
  saveError: string | null
  geom: BoardGeometry
  grid: CellGrid
  /** 每次改动 +1。覆盖层（进行中的笔画）靠它重画 */
  version: number
  /** 只有落到 grid 上的改动才 +1。提交层靠它重画，拖拽时不重画 */
  commitVersion: number
  palette: Palette
  paletteId: string
  /** 允许使用的色号白名单。null = 全部可用 */
  allowedCodes: string[] | null
  colorIndex: number
  tool: ToolId
  selection: Selection
  clipboard: Clip | null
  vp: Viewport
  showCodes: boolean
  canUndo: boolean
  canRedo: boolean
  undoBytes: number
  notice: string | null
  /** 通知级别：error 不自动消失，必须手动关掉或纠正 */
  noticeKind: 'info' | 'error'
  /** 进行中的笔画：格索引 → 色板索引。只画在覆盖层，松手才提交 */
  pending: Map<number, number> | null
  /** 导入的源图（解码后、已限制尺寸） */
  sourceImage: SourceImage | null
  sourceName: string | null
  /** 源图是本地缓存的小图（刷新后恢复的），不是用户刚导入的原图 */
  sourceCached: boolean
  conversion: ConversionSettings
  converting: boolean
  progress: { stage: string; ratio: number } | null
  lastConvert: {
    ms: number
    kind: string
    used: number
    dropped: number
    cropped: boolean
    /** 实际生效的策略（选自动时由分析结果决定） */
    strategy: string
    /** 背景色不可靠，自动裁切被跳过 */
    cropSkipped: boolean
  } | null

  /** 立即应用自由摆放的板块；keepContent=false 时清空画布 */
  applyLayout(layout: BoardLayout, keepContent?: boolean): string | null
  addBoard(board: BoardTypeId, col: number, row: number): string | null
  moveBoard(index: number, col: number, row: number): string | null
  removeBoard(index: number): string | null
  /** 把当前状态打包成工程对象 */
  toProject(): Project
  /** 立刻落盘：explicit=true 表示用户自己点的保存（会打开导出这条路） */
  saveNow(explicit?: boolean): Promise<void>
  /** 打开一个工程（作品库点进来时用）。saved=false 表示这份内容还没经过一次正式保存 */
  loadProject(project: Project, saved?: boolean): void
  /** 新建一个空工程 */
  newProject(name?: string): void
  /** 刷新后把上次的草稿捡回来 */
  restoreLast(): Promise<boolean>
  setTool(tool: ToolId): void
  setColor(index: number): void
  setPalette(id: string): void
  toggleCode(code: string): void
  restoreAllCodes(): void
  setVp(vp: Viewport): void
  fitTo(width: number, height: number, dpr?: number): void
  /** 画布旁开着哪个临时面板（纯界面状态，不进工程文件） */
  panel: PanelId | null
  /** 颜色面板钉住：连续取色时不自动关 */
  colorPinned: boolean
  /** 当前目的地：编辑 / 导出 */
  stage: Stage
  /** 保存那一刻的 commitVersion。等于当前值才允许直接去导出 */
  savedCommitVersion: number | null
  openPanel(panel: PanelId | null): void
  setColorPinned(pinned: boolean): void
  openExport(): void
  closeExport(): void
  pointerDown(col: number, row: number, button: number, shift: boolean): void
  pointerMove(col: number, row: number): void
  pointerUp(): void
  setNotice(message: string | null, kind?: 'info' | 'error'): void
  undo(): void
  redo(): void
  selectAll(): void
  clearSel(): void
  invertSel(): void
  fillSel(value: number): void
  eraseSel(): void
  copySel(): void
  cutSel(): void
  pasteSel(): void
  mirror(axis: 'h' | 'v'): void
  rotate(dir: 1 | -1): void
  translate(dc: number, dr: number): void
  importImage(file: File): Promise<void>
  /** 刷新/重开工程后把缓存的源图捡回来（只是缩略图大小，不是原图） */
  restoreSourceImage(): Promise<boolean>
  clearSourceImage(): void
  setConversion(patch: Partial<ConversionSettings>): void
  runConvert(): Promise<void>
}

const history = new History()

/** 进行中的笔画状态，不进 state（不需要触发渲染） */
let recording: PatchRecorder | null = null
let lastPoint: { col: number; row: number } | null = null
let rectAnchor: { col: number; row: number } | null = null

/**
 * 保存串行化。两次写盘并发会互相覆盖：后写的可能带着更旧的快照。
 * 排队后每次任务在轮到自己时才取快照，最后一次写的一定是最新状态。
 */
let saveChain: Promise<void> = Promise.resolve()
let queuedSaves = 0

function enqueueSave(run: (explicit: boolean) => Promise<void>, explicit: boolean): Promise<void> {
  queuedSaves++
  const next = saveChain.then(
    () => run(explicit),
    () => run(explicit),
  ).finally(() => {
    queuedSaves--
  })
  saveChain = next
  return next
}

/** 转换输入的代数。任何输入变化都会让旧结果失效。 */
let conversionGeneration = 0
let conversionController: AbortController | null = null

function invalidateConversion(): number {
  conversionGeneration++
  conversionController?.abort()
  conversionController = null
  return conversionGeneration
}

function emptyBoard() {
  return {
    layout: { placements: [], gapMm: 0 } as BoardLayout,
    geom: emptyBoardGeometry(),
  }
}

const initial = emptyBoard()

type PlacementShift = { placements: BoardPlacement[]; col: number; row: number }

function shiftPlacements(placements: BoardPlacement[]): PlacementShift {
  let minCol = 0
  let minRow = 0
  for (const placement of placements) {
    minCol = Math.min(minCol, placement.col)
    minRow = Math.min(minRow, placement.row)
  }
  const col = -minCol
  const row = -minRow
  return {
    col,
    row,
    placements: col || row
      ? placements.map((placement) => ({ ...placement, col: placement.col + col, row: placement.row + row }))
      : placements,
  }
}

function preserveWorldPosition(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  shift: PlacementShift,
): void {
  const vp = get().vp
  set({ vp: { ...vp, panX: vp.panX - shift.col * vp.zoom, panY: vp.panY - shift.row * vp.zoom } })
}

function syncHistory() {
  return { canUndo: history.canUndo, canRedo: history.canRedo, undoBytes: history.memoryBytes() }
}

export const useEditor = create<EditorState>((set, get) => ({
  name: '未命名作品',
  layout: initial.layout,
  projectId: 'local-draft',
  customer: null,
  panel: null,
  colorPinned: false,
  stage: 'edit',
  savedCommitVersion: null,
  createdAt: new Date().toISOString(),
  savedAt: null,
  saving: false,
  saveError: null,
  geom: initial.geom,
  grid: createGrid(initial.geom.cols, initial.geom.rows, EMPTY, initial.geom.placeable),
  version: 0,
  commitVersion: 0,
  palette: getPalette('mard-291'),
  paletteId: 'mard-291',
  allowedCodes: null,
  colorIndex: defaultColorIndex(getPalette('mard-291')),
  tool: 'pencil',
  selection: [],
  clipboard: null,
  vp: fitViewport(initial.geom.cols, initial.geom.rows, 900, 700),
  showCodes: true,
  canUndo: false,
  canRedo: false,
  undoBytes: 0,
  notice: null,
  noticeKind: 'info' as const,
  pending: null,
  sourceImage: null,
  sourceName: null,
  sourceCached: false,
  conversion: DEFAULT_SETTINGS,
  converting: false,
  progress: null,
  lastConvert: null,

  applyLayout(layout, keepContent = true) {
    let geom: BoardGeometry
    try {
      geom = deriveLayoutGeometry(layout)
    } catch (error) {
      return error instanceof Error ? error.message : '板阵不合法'
    }
    invalidateConversion()
    const state = get()
    const previous = state.grid
    const next = createGrid(geom.cols, geom.rows, EMPTY, geom.placeable)
    // 默认保留坐标不变的内容：换板阵不该毁掉已经拼好的部分
    if (keepContent) {
      const copyCols = Math.min(previous.cols, geom.cols)
      const copyRows = Math.min(previous.rows, geom.rows)
      for (let r = 0; r < copyRows; r++) {
        for (let c = 0; c < copyCols; c++) {
          if (!inBounds(next, c, r)) continue
          const value = previous.cells[r * previous.cols + c]
          if (value !== EMPTY) next.cells[r * next.cols + c] = value
        }
      }
    }

    history.clear()
    recording = null
    lastPoint = null
    rectAnchor = null
    const cells = geom.cols * geom.rows
    set({
      layout: { placements: [...layout.placements], gapMm: layout.gapMm },
      geom,
      grid: next,
      version: state.version + 1,
      commitVersion: state.commitVersion + 1,
      selection: [],
      clipboard: null,
      pending: null,
      converting: false,
      progress: null,
      stage: 'edit',
      notice: !geom.boards.length
        ? null
        : cells > WARN_CELLS
          ? `画布 ${cells.toLocaleString()} 格，超过 150 万格，建议改用 5mm 豆`
          : `${geom.boards.length} 块板 · ${geom.cols}×${geom.rows} 格`,
      ...syncHistory(),
    })
    return null
  },

  addBoard(board, col, row) {
    const profile = findBoardProfile(board)
    if (!profile) return `不认识这个板型：${String(board)}`
    const state = get()
    if (state.layout.placements.length && state.geom.pitchMm !== profile.pitchMm) {
      return '不同针距的板不能放在同一张豆格画布上'
    }
    const requested = {
      board,
      col: Math.round(Number.isFinite(col) ? col : 0),
      row: Math.round(Number.isFinite(row) ? row : 0),
    }
    const normalized = shiftPlacements([...state.layout.placements, requested])
    const failure = get().applyLayout({
      placements: normalized.placements,
      gapMm: state.layout.gapMm,
    })
    if (!failure && (normalized.col || normalized.row)) preserveWorldPosition(set, get, normalized)
    return failure
  },

  moveBoard(index, col, row) {
    const state = get()
    const target = state.layout.placements[index]
    if (!target) return null
    const next = {
      ...target,
      col: Math.round(Number.isFinite(col) ? col : target.col),
      row: Math.round(Number.isFinite(row) ? row : target.row),
    }
    if (next.col === target.col && next.row === target.row) return null
    const normalized = shiftPlacements(
      state.layout.placements.map((placement, i) => (i === index ? next : placement)),
    )
    const failure = get().applyLayout({
      placements: normalized.placements,
      gapMm: state.layout.gapMm,
    })
    if (!failure && (normalized.col || normalized.row)) preserveWorldPosition(set, get, normalized)
    return failure
  },

  removeBoard(index) {
    const state = get()
    if (index < 0 || index >= state.layout.placements.length) return null
    return get().applyLayout({
      placements: state.layout.placements.filter((_, i) => i !== index),
      gapMm: state.layout.gapMm,
    })
  },

  openPanel(panel) {
    set({ panel })
  },

  setColorPinned(colorPinned) {
    set({ colorPinned })
  },

  openExport() {
    // 门是给别人看的，这里再挡一次：没保存的当前内容不许直接导出
    const { savedCommitVersion, commitVersion } = get()
    if (savedCommitVersion !== commitVersion) {
      set({ notice: '先保存当前内容，再导出' })
      return
    }
    set({ stage: 'export', panel: null })
  },

  closeExport() {
    // 画布位置和缩放一直留在 vp 里，回来就是原来那一眼
    set({ stage: 'edit' })
  },

  toProject() {
    const state = get()
    return {
      schemaVersion: 1,
      id: state.projectId,
      name: state.name,
      customer: state.customer,
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
      layout: state.layout,
      paletteId: state.paletteId,
      allowedCodes: state.allowedCodes,
      grid: state.grid,
      conversion: state.conversion,
      view: {
        zoom: state.vp.zoom,
        panX: state.vp.panX,
        panY: state.vp.panY,
        showCodes: state.showCodes,
      } satisfies ProjectView,
    }
  },

  /** 后台自动保存（explicit=false）只保命，不算"用户保存好了" */
  async saveNow(explicit = false) {
    if (typeof indexedDB === 'undefined') return
    set({ saving: true })
    return enqueueSave(async (isExplicit) => {
      // 快照在"轮到这一次"的时候才取：排队期间的新编辑不会被旧快照覆盖
      const state = get()
      // 这次保存覆盖的是这一刻的内容：之后任何改动都会让 commitVersion 超过它
      const commitAtSave = state.commitVersion
      try {
        const project = state.toProject()
        await putProject(project)
        await saveDraft(project)
        rememberLastProject(project.id)
        // 后面还有人排队就不算"保存完了"，否则界面会骗人
        const last = queuedSaves <= 1
        set({
          savedAt: last ? project.updatedAt : get().savedAt,
          // 只有用户自己点的那一次（或者打开已保存工程）才开门去导出。
          // 后台自动保存不能把流程往前推：它只保证内容没丢
          savedCommitVersion:
            last && isExplicit ? commitAtSave : get().savedCommitVersion,
          saving: !last,
          saveError: null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        set({ saving: false, saveError: message, notice: `保存失败：${message}`, noticeKind: 'error' })
      }
    }, explicit)
  },

  loadProject(project, saved = true) {
    // 网格遮罩、空档脏数据、尺寸不一致全交给同一个规范化函数，
    // 不在这里再写一遍（两边不一致就是 bug 温床）
    const layout: BoardLayout = {
      ...project.layout,
      placements: [...project.layout.placements],
    }
    const geom = deriveLayoutGeometry(layout)
    const normalized = normalizeGridForLayout(project.grid, geom)
    const pid = getPalette(project.paletteId).id
    const commitVersion = get().commitVersion + 1
    invalidateConversion()
    history.clear()
    recording = null
    lastPoint = null
    rectAnchor = null
    set({
      name: project.name,
      projectId: project.id,
      customer: project.customer,
      createdAt: project.createdAt,
      layout,
      geom,
      grid: normalized.grid,
      palette: getPalette(pid),
      paletteId: pid,
      allowedCodes: project.allowedCodes,
      colorIndex: defaultColorIndex(getPalette(pid)),
      conversion: DEFAULT_SETTINGS,
      clipboard: null,
      selection: [],
      pending: null,
      converting: false,
      progress: null,
      lastConvert: null,
      sourceImage: null,
      sourceName: null,
      sourceCached: false,
      savedAt: saved ? project.updatedAt : null,
      savedCommitVersion: saved ? commitVersion : null,
      saving: false,
      saveError: null,
      panel: null,
      stage: 'edit',
      notice: `已打开《${project.name}》`,
      version: get().version + 1,
      commitVersion,
      canUndo: false,
      canRedo: false,
      undoBytes: 0,
      vp: {
        zoom: project.view.zoom,
        panX: project.view.panX,
        panY: project.view.panY,
        dpr: 1,
      },
      showCodes: project.view.showCodes,
    })
  },

  async restoreLast() {
    if (typeof indexedDB === 'undefined') return false
    try {
      const project = await restoreLastProject()
      if (!project) return false
      get().loadProject(project)
      set({ notice: `已恢复上次的《${project.name}》` })
      return true
    } catch {
      return false
    }
  },

  newProject(name = '未命名作品') {
    const layout: BoardLayout = { placements: [], gapMm: 0 }
    const geom = emptyBoardGeometry()
    history.clear()
    recording = null
    const project = createProject({
      name,
      layout,
      paletteId: get().paletteId,
      grid: createGrid(geom.cols, geom.rows, EMPTY, geom.placeable),
    })
    get().loadProject(project, false)
    set({ notice: '新建空白作品', panel: null })
  },

  setTool(tool) {
    rectAnchor = null
    set({ tool, notice: null })
  },
  setColor(index) {
    const { palette, allowedCodes, colorIndex } = get()
    const safe = normalizeColorIndex(palette, allowedCodes, index)
    if (safe !== null) {
      const { panel, colorPinned } = get()
      // 默认选完色就收起颜色面板，把画布还回去；钉住了才留着连续取色
      set({ colorIndex: safe, notice: null, panel: panel === 'color' && !colorPinned ? null : panel })
      return
    }
    // 非法索引或已被排除的色号：不写进状态。
    // 上一次选的颜色还能用就保持不动，否则退到一个可用色（拒绝掉整个操作比乱跳好）
    const keep = normalizeColorIndex(palette, allowedCodes, colorIndex)
    const fallback = palette.colors.findIndex((c) => !allowedCodes || allowedCodes.includes(c.code))
    set({
      colorIndex: keep ?? (fallback >= 0 ? fallback : defaultColorIndex(palette)),
      notice: '这个色号当前不可用，已经换成别的色号',
    })
  },

  /** 换色板：旧色板里用到的每个色都重映射到新色板的最近色 */
  setPalette(id) {
    const { palette: oldPalette, grid } = get()
    const next = getPalette(id)
    if (next.id === oldPalette.id) return
    invalidateConversion()
    const before = metaSnapshot(get())
    const matcher = createMatcher(paletteRgb(next))
    const map = new Map<number, number>()
    recording = new PatchRecorder(grid, `换色板：${next.displayName}`)
    for (let i = 0; i < grid.cells.length; i++) {
      const v = grid.cells[i]
      if (v === EMPTY) continue
      let target = map.get(v)
      if (target === undefined) {
        target = matcher.match((oldPalette.colors[v] ?? next.colors[0]).rgb as never)
        map.set(v, target)
      }
      if (target === v) continue
      const col = i % grid.cols
      recording.set(col, (i - col) / grid.cols, target)
    }
    set({
      palette: next,
      paletteId: next.id,
      allowedCodes: null,
      colorIndex: defaultColorIndex(next),
      converting: false,
      progress: null,
    })
    commitRecording(set, get, `换到 ${next.displayName}`, { before, after: metaSnapshot(get()) })
  },

  /**
   * 排除 / 恢复一个色号。排除时，用它画的格子全部重映射到最近的可用色。
   * allowedCodes 是白名单：null 表示全可用，所以"被排除了"= 白名单存在且不含它。
   */
  toggleCode(code) {
    const { palette, grid, allowedCodes } = get()
    const allCodes = palette.colors.map((c) => c.code)
    const currentAllowed = allowedCodes ?? allCodes
    const isExcluded = !currentAllowed.includes(code)
    const nextAllowed = isExcluded
      ? [...currentAllowed, code]
      : currentAllowed.filter((c) => c !== code)
    if (nextAllowed.length === 0) {
      set({ notice: '不能把所有色号都排除掉' })
      return
    }
    invalidateConversion()
    const before = metaSnapshot(get())
    const normalized = nextAllowed.length === allCodes.length ? null : nextAllowed
    const mask = allCodes.map((c) => nextAllowed.includes(c))

    const victim = palette.colors.findIndex((c) => c.code === code)
    let remapped = 0
    if (!isExcluded && victim >= 0) {
      const matcher = createMatcher(paletteRgb(palette), mask)
      const target = matcher.match(palette.colors[victim].rgb as never)
      recording = new PatchRecorder(grid, `排除 ${code}`)
      for (let i = 0; i < grid.cells.length; i++) {
        if (grid.cells[i] !== victim) continue
        const col = i % grid.cols
        recording.set(col, (i - col) / grid.cols, target)
        remapped++
      }
    }
    set({ allowedCodes: normalized, converting: false, progress: null })
    if (!isExcluded) {
      commitRecording(set, get, `排除 ${code}，重映射 ${remapped} 格`, {
        before,
        after: metaSnapshot(get()),
      })
    } else {
      set({ notice: `恢复 ${code}（已重映射的格子不会自动变回来）` })
    }
  },

  restoreAllCodes() {
    invalidateConversion()
    set({ allowedCodes: null, converting: false, progress: null, notice: '恢复全部色号' })
  },
  setVp(vp) {
    set({ vp })
  },
  fitTo(width, height, dpr = 1) {
    const { geom } = get()
    // 首次铺满给启动器和 dock 留位（spec 5.4），别让浮层盖住最外圈格子
    set({ vp: fitViewport(geom.cols, geom.rows, width, height, dpr, EDITOR_FIT_PAD) })
  },

  pointerDown(col, row, button, shift) {
    const state = get()
    const { grid, tool, colorIndex } = state

    // 右键 = 取色（任何工具下都一样）
    if (button === 2) {
      const picked = pickColor(grid, col, row)
      if (picked !== null) set({ colorIndex: picked })
      return
    }
    if (!inBounds(grid, col, row)) return

    if (tool === 'pan') return

    if (tool === 'picker') {
      const picked = pickColor(grid, col, row)
      if (picked !== null) set({ colorIndex: picked })
      return
    }

    if (tool === 'rect') {
      rectAnchor = { col, row }
      const rect = makeRect(col, row, col, row)
      set({ selection: shift ? [...state.selection, rect] : [rect], version: state.version + 1 })
      return
    }

    if (tool === 'bucket') {
      recording = new PatchRecorder(grid, '油漆桶')
      const n = floodFill(recording, grid, col, row, colorIndex)
      commitRecording(set, get, n > 0 ? `油漆桶 ${n} 格` : null)
      return
    }

    // 点选：立刻提交一格
    if (tool === 'select') {
      recording = new PatchRecorder(grid, '点选')
      paint(recording, grid, col, row, colorIndex)
      commitRecording(set, get, null)
      return
    }

    // 画笔 / 橡皮：先落覆盖层，松手才提交
    const value = tool === 'eraser' ? EMPTY : colorIndex
    lastPoint = { col, row }
    const pending = new Map<number, number>(state.pending ?? [])
    paint(pendingSink(grid, pending), grid, col, row, value)
    set({ pending, version: state.version + 1 })
  },

  pointerMove(col, row) {
    const state = get()
    if (state.tool === 'pan') return
    if (rectAnchor) {
      const rect = makeRect(rectAnchor.col, rectAnchor.row, col, row)
      const sel = state.selection.length > 1 ? [...state.selection.slice(0, -1), rect] : [rect]
      set({ selection: sel, version: state.version + 1 })
      return
    }
    if (!state.pending || !lastPoint) return
    const value = state.tool === 'eraser' ? EMPTY : state.colorIndex
    const sink = pendingSink(state.grid, state.pending)
    // 指针事件是跳着来的，补上两点之间的格子
    let changed = false
    walkLine(lastPoint, { col, row }, (c, r) => {
      if (paint(sink, state.grid, c, r, value)) changed = true
    })
    lastPoint = { col, row }
    if (changed) set({ version: state.version + 1 })
  },

  pointerUp() {
    rectAnchor = null
    lastPoint = null
    const state = get()
    if (!state.pending) return
    const { grid } = state
    recording = new PatchRecorder(grid, state.tool === 'eraser' ? '橡皮' : '画笔')
    const rec = recording
    for (const [i, v] of state.pending) {
      const col = i % grid.cols
      rec.set(col, (i - col) / grid.cols, v)
    }
    commitRecording(set, get, null)
  },

  setNotice(notice, kind = 'info') {
    set({ notice, noticeKind: notice === null ? 'info' : kind })
  },

  undo() {
    invalidateConversion()
    const patch = history.undo(get().grid)
    if (!patch) {
      set({ converting: false, progress: null })
      return
    }
    set({
      ...(patch.metaBefore ? metaPatch(patch.metaBefore) : {}),
      converting: false,
      progress: null,
      version: get().version + 1,
      commitVersion: get().commitVersion + 1,
      notice: `撤销：${patch.label}`,
      ...syncHistory(),
    })
  },

  redo() {
    invalidateConversion()
    const patch = history.redo(get().grid)
    if (!patch) {
      set({ converting: false, progress: null })
      return
    }
    set({
      ...(patch.metaAfter ? metaPatch(patch.metaAfter) : {}),
      converting: false,
      progress: null,
      version: get().version + 1,
      commitVersion: get().commitVersion + 1,
      notice: `重做：${patch.label}`,
      ...syncHistory(),
    })
  },

  selectAll() {
    const { grid } = get()
    set({
      selection: [{ c0: 0, r0: 0, c1: grid.cols - 1, r1: grid.rows - 1 }],
      version: get().version + 1,
    })
  },

  clearSel() {
    set({ selection: [], version: get().version + 1 })
  },

  invertSel() {
    const { selection, grid } = get()
    if (selection.length !== 1) {
      set({ notice: '反选只支持单选区' })
      return
    }
    set({ selection: invertSelection(selection, grid.cols, grid.rows), version: get().version + 1 })
  },

  fillSel(value) {
    const { selection, grid } = get()
    if (!selection.length) return
    recording = new PatchRecorder(grid, '批量换色')
    const n = fillSelection(recording, grid, selection, value)
    commitRecording(set, get, n > 0 ? `改了 ${n} 格` : null)
  },

  eraseSel() {
    get().fillSel(EMPTY)
  },

  copySel() {
    const { selection, grid } = get()
    const clip = copySelection(grid, selection)
    if (!clip) {
      set({ notice: '没有选区' })
      return
    }
    set({ clipboard: clip, notice: `已复制 ${clip.cols}×${clip.rows}` })
  },

  cutSel() {
    get().copySel()
    get().eraseSel()
  },

  pasteSel() {
    const { clipboard, grid } = get()
    if (!clipboard) {
      set({ notice: '剪贴板是空的' })
      return
    }
    const target = selectionTopLeft(get().selection) ?? { col: 0, row: 0 }
    recording = new PatchRecorder(grid, '粘贴')
    const n = pasteClip(recording, grid, clipboard, target.col, target.row)
    commitRecording(set, get, n > 0 ? `粘贴 ${n} 格` : null)
  },

  mirror(axis) {
    const { selection, grid } = get()
    const rect = selectionRect(selection, grid)
    recording = new PatchRecorder(grid, axis === 'h' ? '左右镜像' : '上下镜像')
    mirrorRect(recording, grid, rect, axis)
    commitRecording(set, get, null)
  },

  rotate(dir) {
    const { selection, grid } = get()
    const rect = selectionRect(selection, grid)
    recording = new PatchRecorder(grid, '旋转')
    if (!rotateRect(recording, grid, rect, dir)) {
      recording = null
      set({ notice: '旋转 90° 要求区域是正方形，先框一个正方形选区' })
      return
    }
    commitRecording(set, get, null)
  },

  translate(dc, dr) {
    const { grid } = get()
    recording = new PatchRecorder(grid, '平移')
    translateGrid(recording, grid, dc, dr)
    commitRecording(set, get, null)
  },

  async importImage(file) {
    const occupied = get().grid.cells.some((value) => value !== EMPTY)
    if (occupied && !window.confirm(t('convert').replaceConfirm)) return
    const generation = invalidateConversion()
    set({ converting: false, progress: null })
    try {
      const image = await decodeImageFile(file)
      if (generation !== conversionGeneration) return
      set({
        sourceImage: image,
        sourceName: file.name,
        sourceCached: false,
        conversion: DEFAULT_SETTINGS,
        panel: 'image',
      })
      // 缓存一份小图，刷新后还能重新转换。缓存失败不影响导入本身
      const id = get().projectId
      void compressForCache(file)
        .then((cached) =>
          putImage(id, { name: file.name, blob: cached.blob, width: cached.width, height: cached.height }),
        )
        .catch(() => undefined)
      // Convert immediately with the fixed defaults; no parameter form is required.
      void get().runConvert()
    } catch (error) {
      if (generation !== conversionGeneration) return
      set({ notice: error instanceof Error ? error.message : '图片读不进来' })
    }
  },

  async restoreSourceImage() {
    if (typeof indexedDB === 'undefined') return false
    const id = get().projectId
    if (get().sourceImage) return false
    try {
      const cached = await getImage(id)
      // 读盘期间换工程/又导了一张：这次恢复作废
      if (!cached || get().projectId !== id || get().sourceImage) return false
      const image = await decodeImageFile(cached.blob)
      if (get().projectId !== id || get().sourceImage) return false
      set({ sourceImage: image, sourceName: cached.name, sourceCached: true })
      return true
    } catch {
      return false
    }
  },

  clearSourceImage() {
    invalidateConversion()
    const id = get().projectId
    set({ sourceImage: null, sourceName: null, sourceCached: false, converting: false, progress: null })
    if (typeof indexedDB !== 'undefined') void remove('images', id).catch(() => undefined)
  },

  setConversion(patch) {
    invalidateConversion()
    const current = get().conversion
    const next: ConversionSettings = { ...current, ...patch }
    // 换了内容类型就把目标色数拉回这档的默认值。
    // 不这么做的话，从通用换到卡通仍停在 24，「这档默认 4 色」的承诺就是假的。
    // 想手动覆盖就换完再拖滑块（patch 里自带 maxColors 时不动）。
    if (patch.strategyId && patch.strategyId !== current.strategyId && patch.maxColors === undefined) {
      next.maxColors = STRATEGIES[resolveStrategy(next.strategyId).id].defaultMaxColors
    }
    set({ conversion: next, converting: false, progress: null })
  },

  async runConvert() {
    const generation = invalidateConversion()
    const state = get()
    if (!state.sourceImage) {
      set({ notice: '先导入一张图片' })
      return
    }
    const paletteColors: Rgb[] = state.palette.colors.map((c) => c.rgb as Rgb)
    const allowed = allowedMask(state.palette, state.allowedCodes)
    const controller = new AbortController()
    conversionController = controller
    set({ converting: true, progress: { stage: '准备', ratio: 0 }, notice: null })
    try {
      const result = await runConvert({
        image: state.sourceImage,
        paletteColors,
        allowed,
        cols: state.grid.cols,
        rows: state.grid.rows,
        settings: state.conversion,
        existing: state.grid.cells,
        signal: controller.signal,
        onProgress: (stage, ratio) => {
          if (generation === conversionGeneration) set({ progress: { stage, ratio } })
        },
      })

      const current = get()
      const inputChanged =
        generation !== conversionGeneration ||
        current.projectId !== state.projectId ||
        current.sourceImage !== state.sourceImage ||
        current.paletteId !== state.paletteId ||
        current.grid !== state.grid ||
        current.pending !== state.pending ||
        current.commitVersion !== state.commitVersion
      if (inputChanged) {
        if (generation === conversionGeneration) {
          set({
            converting: false,
            progress: null,
            notice: '转换期间输入发生变化，旧结果已丢弃，请重新转换',
          })
        }
        return
      }

      // 板没盖到的地方不属于作品：转换结果里的空档一律清掉
      const mask = current.grid.placeable
      if (mask) for (let i = 0; i < result.cells.length; i++) if (!mask[i]) result.cells[i] = EMPTY

      // 转换是一次大改动：能装进撤销栈就装，装不下就清空历史并说明
      const grid = current.grid
      const previous = grid.cells
      const recorder = new PatchRecorder(grid, '转换')
      for (let i = 0; i < result.cells.length; i++) {
        const value = result.cells[i]
        if (previous[i] === value) continue
        const col = i % grid.cols
        recorder.set(col, (i - col) / grid.cols, value)
      }
      const patch = recorder.patch()
      if (patch) history.push(patch)
      else history.clear()

      set({
        version: current.version + 1,
        commitVersion: current.commitVersion + 1,
        converting: false,
        progress: null,
        // 应用完收起图片面板，把画布还回去；想再调从菜单里重新打开
        panel: null,
        lastConvert: {
          ms: result.ms,
          kind: result.kindOfSource,
          used: result.usedIndexes.length,
          dropped: result.droppedIndexes.length,
          cropped: result.cropped,
          strategy: result.strategyUsed,
          cropSkipped: result.cropSkipped,
        },
        notice: recorder.overflowed
          ? '转换完成。改动太大，这一步不计入撤销历史'
          : result.cropSkipped
            ? `转换完成：用了 ${result.usedIndexes.length} 色，${result.ms} ms。背景色不确定，已跳过自动裁切`
            : `转换完成：用了 ${result.usedIndexes.length} 色，${result.ms} ms`,
        ...syncHistory(),
      })
    } catch (error) {
      if (generation !== conversionGeneration) return
      set({
        converting: false,
        progress: null,
        notice: error instanceof Error ? error.message : '转换失败',
      })
    } finally {
      if (conversionController === controller) conversionController = null
    }
  },

}))

/** 覆盖层写入：值先进 pending，不碰 grid */
function pendingSink(grid: CellGrid, pending: Map<number, number>): WriteSink {
  return {
    set(col, row, value) {
      if (!inBounds(grid, col, row)) return false
      const i = row * grid.cols + col
      const cur = pending.get(i) ?? grid.cells[i]
      if (cur === value) return false
      pending.set(i, value)
      return true
    },
  }
}

function commitRecording(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  message: string | null,
  meta?: { before: HistoryMeta; after: HistoryMeta },
): void {
  const rec = recording
  recording = null
  if (!rec) return
  invalidateConversion()
  // 换色板/排除色号可能一格都没改（空画布、或者色号没用过），
  // 但元数据变了 —— 这时也得记一条，否则用户根本撤销不了这次操作。
  const patch = rec.patch() ?? (meta ? emptyPatch(rec.label) : null)
  if (patch) {
    if (meta) {
      patch.metaBefore = meta.before
      patch.metaAfter = meta.after
    }
    history.push(patch)
  }
  set({
    pending: null,
    converting: false,
    progress: null,
    version: get().version + 1,
    commitVersion: get().commitVersion + 1,
    notice: rec.overflowed
      ? '这次操作太大，不计入撤销历史'
      : (message ?? get().notice),
    ...syncHistory(),
  })
}

/** 换色板/排除色号时存下来的元数据快照 */
function metaSnapshot(state: EditorState): HistoryMeta {
  return {
    paletteId: state.paletteId,
    allowedCodes: state.allowedCodes ? [...state.allowedCodes] : null,
    colorIndex: state.colorIndex,
  }
}

/** 把元数据快照写回状态 */
function metaPatch(meta: HistoryMeta): Partial<EditorState> {
  const palette = getPalette(meta.paletteId)
  const size = palette.colors.length
  return {
    palette,
    paletteId: meta.paletteId,
    allowedCodes: meta.allowedCodes ? [...meta.allowedCodes] : null,
    colorIndex:
      Number.isInteger(meta.colorIndex) && meta.colorIndex >= 0 && meta.colorIndex < size
        ? meta.colorIndex
        : defaultColorIndex(palette),
  }
}

/** 合法且在可用名单里就返回索引，否则 null */
function normalizeColorIndex(
  palette: Palette,
  allowedCodes: string[] | null,
  index: number,
): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= palette.colors.length) return null
  if (allowedCodes && !allowedCodes.includes(palette.colors[index].code)) return null
  return index
}

/** 只有元数据变化、没有格子改动时的占位补丁 */
function emptyPatch(label: string): CellPatch {
  return {
    label,
    indexes: new Uint32Array(0),
    before: new Uint16Array(0),
    after: new Uint16Array(0),
  }
}

function selectionRect(sel: Selection, grid: CellGrid): Rect {
  if (sel.length === 1) return sel[0]
  return { c0: 0, r0: 0, c1: grid.cols - 1, r1: grid.rows - 1 }
}

function selectionTopLeft(sel: Selection): { col: number; row: number } | null {
  if (!sel.length) return null
  return { col: sel[0].c0, row: sel[0].r0 }
}

/** Bresenham 的等价物，只在指针事件之间补格子 */
function walkLine(
  from: { col: number; row: number },
  to: { col: number; row: number },
  fn: (col: number, row: number) => void,
): void {
  let { col, row } = from
  const dx = Math.abs(to.col - col)
  const dy = -Math.abs(to.row - row)
  const sx = col < to.col ? 1 : -1
  const sy = row < to.row ? 1 : -1
  let err = dx + dy
  for (;;) {
    fn(col, row)
    if (col === to.col && row === to.row) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      col += sx
    }
    if (e2 <= dx) {
      err += dx
      row += sy
    }
  }
}
