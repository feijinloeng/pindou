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
import { EMPTY, type CellGrid, createGrid, inBounds, lostCells, lostCellsAfterShift } from '../domain/grid'
import { type Palette } from '../domain/palette'
import {
  allowedMask,
  DEFAULT_PALETTE_ID,
  defaultColorIndex,
  getPalette,
  paletteRgb,
} from '../data/palettes'
import { createMatcher } from '../conversion/match'
import { EDITOR_FIT_PAD, fitViewport, type Viewport } from '../render/canvasViewport'
import { History, PatchRecorder, type CellPatch, type HistoryMeta } from './history'
import {
  copySelection,
  countMirrorLoss,
  countRotateLoss,
  countTranslateLoss,
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
import type { ConversionSettings } from '../conversion/convert'
import { DEFAULT_SETTINGS } from '../conversion/settings'
import {
  createProject,
  normalizeGridForLayout,
  type Project,
  type ProjectView,
} from '../domain/project'
import {
  getImage,
  putImage,
  putProject,
  purgeProject,
  trashProject,
  rememberLastProject,
  restoreLastProject,
  saveDraft,
} from '../storage/db'
import { compressForCache } from '../storage/imageCache'
import { runConvert } from '../conversion/convertClient'
import { decodeImageFile } from '../conversion/decode'
import type { Rgb } from '../conversion/colorDistance'
import type { SourceImage } from '../conversion/types'
import { t } from '../i18n/zh'

export type ToolId = 'pencil' | 'eraser' | 'picker' | 'bucket' | 'rect' | 'pan'

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
  createdAt: string
  /** 上次保存时间（界面显示"已保存"用） */
  savedAt: string | null
  saving: boolean
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
  /** 板面板当前选中的型号，只是界面状态，不写入工程文件 */
  selectedBoard: BoardTypeId
  tool: ToolId
  /** 吸色管取色成功后要回到的工具 */
  toolBeforePicker: ToolId
  selection: Selection
  clipboard: Clip | null
  vp: Viewport
  showCodes: boolean
  canUndo: boolean
  canRedo: boolean
  notice: string | null
  /** 通知级别：error 不自动消失，必须手动关掉或纠正 */
  noticeKind: 'info' | 'error'
  /** 进行中的笔画：格索引 → 色板索引。只画在覆盖层，松手才提交 */
  pending: Map<number, number> | null
  /** 导入的源图（解码后、已限制尺寸） */
  sourceImage: SourceImage | null
  sourceName: string | null
  conversion: ConversionSettings
  converting: boolean
  progress: { stage: string; ratio: number } | null
  /** 立即应用自由摆放的板块；keepContent=false 时清空画布 */
  applyLayout(
    layout: BoardLayout,
    keepContent?: boolean,
    contentShift?: { col: number; row: number },
  ): string | null
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
  /** Serialize deletion with saves before leaving the current project. */
  deleteProject(id: string, permanent?: boolean): Promise<void>
  /** 刷新后把上次的草稿捡回来 */
  restoreLast(): Promise<boolean>
  setTool(tool: ToolId): void
  setColor(index: number): void
  setSelectedBoard(board: BoardTypeId): void
  setPalette(id: string): void
  setConversion(patch: Partial<ConversionSettings>): void
  setVp(vp: Viewport): void
  fitTo(width: number, height: number, dpr?: number): void
  /** 画布旁开着哪个临时面板（纯界面状态，不进工程文件） */
  panel: PanelId | null
  /** 颜色面板钉住：连续取色时不自动关 */
  colorPinned: boolean
  /** 底板面板钉住：连续选板时不自动关 */
  boardPinned: boolean
  /** 当前目的地：编辑 / 导出 */
  stage: Stage
  /** 保存那一刻的 commitVersion。等于当前值才允许直接去导出 */
  savedCommitVersion: number | null
  openPanel(panel: PanelId | null): void
  setColorPinned(pinned: boolean): void
  setBoardPinned(pinned: boolean): void
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
let projectGeneration = 0

function enqueueSave(run: () => Promise<void>): Promise<void> {
  queuedSaves++
  useEditor.setState({ saving: true })
  const next = saveChain.then(run, run).finally(() => {
    queuedSaves--
    useEditor.setState({ saving: queuedSaves > 0 })
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
const defaultPalette = getPalette(DEFAULT_PALETTE_ID)

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
  return { canUndo: history.canUndo, canRedo: history.canRedo }
}

export const useEditor = create<EditorState>((set, get) => ({
  name: '未命名作品',
  layout: initial.layout,
  projectId: 'local-draft',
  panel: null,
  colorPinned: false,
  // 排板是连续操作：默认保持面板打开，用户仍可手动取消钉住来恢复一次性添加。
  boardPinned: true,
  stage: 'edit',
  savedCommitVersion: null,
  createdAt: new Date().toISOString(),
  savedAt: null,
  saving: false,
  geom: initial.geom,
  grid: createGrid(initial.geom.cols, initial.geom.rows, EMPTY, initial.geom.placeable),
  version: 0,
  commitVersion: 0,
  palette: defaultPalette,
  paletteId: DEFAULT_PALETTE_ID,
  allowedCodes: null,
  colorIndex: defaultColorIndex(defaultPalette),
  selectedBoard: 'mini52',
  tool: 'pencil',
  toolBeforePicker: 'pencil',
  selection: [],
  clipboard: null,
  vp: fitViewport(initial.geom.cols, initial.geom.rows, 900, 700),
  showCodes: true,
  canUndo: false,
  canRedo: false,
  notice: null,
  noticeKind: 'info' as const,
  pending: null,
  sourceImage: null,
  sourceName: null,
  conversion: DEFAULT_SETTINGS,
  converting: false,
  progress: null,

  applyLayout(layout, keepContent = true, contentShift = { col: 0, row: 0 }) {
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
    // 默认保留坐标不变的内容；板块整体归一化时，内容也要跟着坐标移动。
    if (keepContent) {
      const copyCols = Math.min(previous.cols + Math.max(0, contentShift.col), geom.cols)
      const copyRows = Math.min(previous.rows + Math.max(0, contentShift.row), geom.rows)
      for (let r = 0; r < copyRows; r++) {
        for (let c = 0; c < copyCols; c++) {
          if (!inBounds(next, c, r)) continue
          const sourceCol = c - contentShift.col
          const sourceRow = r - contentShift.row
          if (!inBounds(previous, sourceCol, sourceRow)) continue
          const value = previous.cells[sourceRow * previous.cols + sourceCol]
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
    const failure = get().applyLayout(
      {
        placements: normalized.placements,
        gapMm: state.layout.gapMm,
      },
      true,
      normalized,
    )
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
    const nextLayout = { placements: normalized.placements, gapMm: state.layout.gapMm }
    let nextGeometry: BoardGeometry
    try {
      nextGeometry = deriveLayoutGeometry(nextLayout)
    } catch (error) {
      return error instanceof Error ? error.message : '板阵不合法'
    }
    const lost = lostCellsAfterShift(state.grid, nextGeometry, normalized.col, normalized.row)
    if (lost > 0) {
      const message = t('picker').moveConfirm(lost)
      if (typeof window === 'undefined') return message
      if (!window.confirm(message)) return null
    }
    const failure = get().applyLayout(
      nextLayout,
      true,
      normalized,
    )
    if (!failure && (normalized.col || normalized.row)) preserveWorldPosition(set, get, normalized)
    return failure
  },

  removeBoard(index) {
    const state = get()
    if (index < 0 || index >= state.layout.placements.length) return null
    const nextLayout = {
      placements: state.layout.placements.filter((_, i) => i !== index),
      gapMm: state.layout.gapMm,
    }
    const nextGeometry = deriveLayoutGeometry(nextLayout)
    const lost = lostCells(state.grid, nextGeometry)
    if (lost > 0) {
      const message = t('picker').removeConfirm(lost)
      if (typeof window === 'undefined') return message
      if (!window.confirm(message)) return null
    }
    return get().applyLayout(nextLayout)
  },

  openPanel(panel) {
    set({ panel })
  },

  setColorPinned(colorPinned) {
    set({ colorPinned })
  },

  setBoardPinned(boardPinned) {
    set({ boardPinned })
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
      createdAt: state.createdAt,
      // Keep successive saves ordered even within one millisecond.
      updatedAt: new Date(Math.max(Date.now(), Date.parse(state.savedAt ?? state.createdAt) + 1)).toISOString(),
      layout: state.layout,
      paletteId: state.paletteId,
      allowedCodes: state.allowedCodes,
      grid: { ...state.grid, cells: state.grid.cells.slice() },
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
    if (explicit) get().pointerUp()
    const initial = get()
    if (!explicit && initial.projectId === 'local-draft' && initial.commitVersion === 0) return
    if (typeof indexedDB === 'undefined') {
      const error = new Error(t('storage').unavailable)
      set({ notice: t('storage').saveFailed(error.message), noticeKind: 'error' })
      throw error
    }
    const generation = projectGeneration
    return enqueueSave(async () => {
      // A queued task must never save a different (or reloaded) project.
      if (projectGeneration !== generation) return
      const state = get()
      if (!explicit && state.savedCommitVersion === state.commitVersion) return
      const commitAtSave = state.commitVersion
      try {
        const project = state.toProject()
        if (explicit) await putProject(project)
        else await saveDraft(project)
        if (projectGeneration !== generation) return
        rememberLastProject(project.id)
        set({
          savedAt: project.updatedAt,
          savedCommitVersion: explicit ? commitAtSave : get().savedCommitVersion,
        })
      } catch (error) {
        if (projectGeneration === generation) {
          set({
            notice: t('storage').saveFailed(error instanceof Error ? error.message : String(error)),
            noticeKind: 'error',
          })
        }
        throw error
      }
    })
  },

  deleteProject(id, permanent = false) {
    return enqueueSave(async () => {
      if (get().projectId === id && !permanent) {
        get().pointerUp()
        await saveDraft(get().toProject())
      }
      if (permanent) await purgeProject(id)
      else await trashProject(id)
      if (get().projectId === id) get().newProject()
    })
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
    projectGeneration++
    invalidateConversion()
    history.clear()
    recording = null
    lastPoint = null
    rectAnchor = null
    set({
      name: project.name,
      projectId: project.id,
      createdAt: project.createdAt,
      layout,
      geom,
      grid: normalized.grid,
      palette: getPalette(pid),
      paletteId: pid,
      allowedCodes: project.allowedCodes,
      colorIndex: defaultColorIndex(getPalette(pid)),
      conversion: project.conversion ?? DEFAULT_SETTINGS,
      clipboard: null,
      selection: [],
      pending: null,
      converting: false,
      progress: null,
      sourceImage: null,
      sourceName: null,
      savedAt: project.updatedAt,
      savedCommitVersion: saved ? commitVersion : null,
      saving: queuedSaves > 0,
      panel: null,
      stage: 'edit',
      notice: `已打开《${project.name}》`,
      version: get().version + 1,
      commitVersion,
      canUndo: false,
      canRedo: false,
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
    const generation = projectGeneration
    const commitVersion = get().commitVersion
    try {
      const latest = await restoreLastProject()
      if (!latest || generation !== projectGeneration || get().commitVersion !== commitVersion || get().pending) return false
      get().loadProject(latest.project, !latest.hasNewerDraft)
      set({ notice: t('storage').restored(latest.project.name) })
      return true
    } catch (error) {
      set({ notice: t('storage').restoreFailed(String(error)), noticeKind: 'error' })
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
    const current = get().tool
    set({
      tool,
      toolBeforePicker: tool === 'picker' && current !== 'picker' ? current : get().toolBeforePicker,
      notice: null,
    })
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

  setSelectedBoard(board) {
    if (findBoardProfile(board)) set({ selectedBoard: board })
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

  setConversion(patch) {
    invalidateConversion()
    set({
      conversion: { ...get().conversion, ...patch },
      converting: false,
      progress: null,
    })
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
      if (picked !== null) set({ colorIndex: picked, tool: state.toolBeforePicker })
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
    const lost = countMirrorLoss(grid, rect, axis)
    if (lost > 0 && !confirmBeadLoss(lost)) return
    recording = new PatchRecorder(grid, axis === 'h' ? '左右镜像' : '上下镜像')
    mirrorRect(recording, grid, rect, axis)
    commitRecording(set, get, null)
  },

  rotate(dir) {
    const { selection, grid } = get()
    const rect = selectionRect(selection, grid)
    const lost = countRotateLoss(grid, rect, dir)
    if (lost > 0 && !confirmBeadLoss(lost)) return
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
    const lost = countTranslateLoss(grid, dc, dr)
    if (lost > 0 && !confirmBeadLoss(lost)) return
    recording = new PatchRecorder(grid, '平移')
    translateGrid(recording, grid, dc, dr)
    commitRecording(set, get, null)
  },

  async importImage(file) {
    if (get().geom.boards.length === 0) {
      set({ notice: t('convert').noBoards })
      return
    }
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
      // 先用默认参数生成一次，之后可在图片面板继续调整。
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
      set({ sourceImage: image, sourceName: cached.name })
      return true
    } catch {
      return false
    }
  },

  async runConvert() {
    const generation = invalidateConversion()
    const state = get()
    if (state.geom.boards.length === 0) {
      set({ converting: false, progress: null, notice: t('convert').noBoards })
      return
    }
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

      // 转换能记入撤销栈就保留；只有一次改动超限才必须清空历史。
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
      else if (recorder.overflowed) history.clear()

      set({
        version: current.version + 1,
        commitVersion: current.commitVersion + 1,
        converting: false,
        progress: null,
        // 转换完成后保留图片面板，方便继续调大小、位置和透明边缘
        panel: 'image',
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
  const cellPatch = rec.patch()
  const changed = rec.overflowed || cellPatch !== null || meta !== undefined
  if (!changed) {
    // No-op gestures should not cancel conversion or create a fake commit/history entry.
    set({ pending: null, version: get().version + 1 })
    return
  }
  invalidateConversion()
  // 换色板/排除色号可能一格都没改（空画布、或者色号没用过），
  // 但元数据变了 —— 这时也得记一条，否则用户根本撤销不了这次操作。
  if (rec.overflowed) {
    // An unrecorded large mutation breaks the undo sequence; old entries must not cross it.
    history.clear()
  } else {
    const patch = cellPatch ?? (meta ? emptyPatch(rec.label) : null)
    if (patch) {
      if (meta) {
        patch.metaBefore = meta.before
        patch.metaAfter = meta.after
      }
      history.push(patch)
    }
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

function confirmBeadLoss(count: number): boolean {
  const message = t('editor').transformDiscard(count)
  if (typeof window === 'undefined') {
    useEditor.setState({ notice: message, noticeKind: 'error' })
    return false
  }
  return window.confirm(message)
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
