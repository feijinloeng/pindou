import { create } from 'zustand'

import {
  BOARD_PRESETS,
  deriveLayoutGeometry,
  placementsFromArray,
  type BoardGeometry,
  type BoardLayout,
  WARN_CELLS,
} from '../domain/board'
import { EMPTY, type CellGrid, createGrid, inBounds, usedCells } from '../domain/grid'
import { type Palette } from '../domain/palette'
import { allowedMask, defaultColorIndex, getPalette, paletteRgb } from '../data/palettes'
import { createMatcher } from '../conversion/match'
import { fitViewport, type Viewport } from '../render/canvasViewport'
import { History, PatchRecorder } from './history'
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
import { type BenchPhase, runPanBench } from './bench'
import { DEFAULT_SETTINGS, type ConversionSettings } from '../conversion/convert'
import {
  createProject,
  type MakingProgress,
  type Project,
  type ProjectView,
} from '../domain/project'
import { putProject, rememberLastProject, restoreLastProject, saveDraft } from '../storage/db'
import type { RecommendStrategy } from '../follow/followMode'
import { runConvert } from '../conversion/convertClient'
import { resolveDither } from '../conversion/strategies'
import { decodeImageFile } from '../conversion/decode'
import type { Rgb } from '../conversion/colorDistance'
import type { SourceImage } from '../conversion/types'
import { getRenderer } from '../render/rendererHandle'

export type ToolId = 'select' | 'pencil' | 'eraser' | 'picker' | 'bucket' | 'rect'

export interface EditorState {
  /** 作品名（导出文件名用它） */
  name: string
  /** 板阵：自由摆放的板列表 */
  layout: BoardLayout
  /** 选板页是不是开着（开着的时候别的控件都不让点） */
  pickerOpen: boolean
  projectId: string
  customer: string | null
  createdAt: string
  /** 跟做模式进度 */
  making: MakingProgress
  recommendStrategy: RecommendStrategy
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
  tool: ToolId
  selection: Selection
  clipboard: Clip | null
  vp: Viewport
  showCodes: boolean
  canUndo: boolean
  canRedo: boolean
  undoBytes: number
  notice: string | null
  /** 进行中的笔画：格索引 → 色板索引。只画在覆盖层，松手才提交 */
  pending: Map<number, number> | null
  bench: BenchPhase[] | null
  benchRunning: boolean

  /** 导入的源图（解码后、已限制尺寸） */
  sourceImage: SourceImage | null
  sourceName: string | null
  conversion: ConversionSettings
  converting: boolean
  progress: { stage: string; ratio: number } | null
  lastConvert: {
    ms: number
    kind: string
    used: number
    dropped: number
    cropped: boolean
  } | null

  /** 应用一个板阵预设（压测用），成功返回 null，失败返回错误文案 */
  applyPreset(presetId: string): string | null
  /** 应用自由拼出来的板阵。keepContent=false 时清空画布（换板阵通常要清） */
  applyLayout(layout: BoardLayout, keepContent?: boolean): string | null
  openPicker(): void
  closePicker(): void
  setName(name: string): void
  setCustomer(customer: string | null): void
  setRecommendStrategy(strategy: RecommendStrategy): void
  setFocusCode(code: string | null): void
  toggleRegion(code: string, regionId: number): void
  resetMaking(): void
  /** 把当前状态打包成工程对象 */
  toProject(): Project
  /** 立刻落盘（自动保存和手动保存都走它） */
  saveNow(): Promise<void>
  /** 打开一个工程（作品库点进来时用） */
  loadProject(project: Project): void
  /** 新建一个空工程 */
  newProject(name?: string, presetId?: string): void
  /** 刷新后把上次的草稿捡回来 */
  restoreLast(): Promise<boolean>
  setTool(tool: ToolId): void
  setColor(index: number): void
  setPalette(id: string): void
  toggleCode(code: string): void
  restoreAllCodes(): void
  setShowCodes(show: boolean): void
  setVp(vp: Viewport): void
  fitTo(width: number, height: number, dpr?: number): void
  pointerDown(col: number, row: number, button: number, shift: boolean): void
  pointerMove(col: number, row: number): void
  pointerUp(): void
  setNotice(message: string | null): void
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
  runBench(): Promise<void>
  importImage(file: File): Promise<void>
  clearSourceImage(): void
  setConversion(patch: Partial<ConversionSettings>): void
  runConvert(): Promise<void>
}

const history = new History()

/** 进行中的笔画状态，不进 state（不需要触发渲染） */
let recording: PatchRecorder | null = null
let lastPoint: { col: number; row: number } | null = null
let rectAnchor: { col: number; row: number } | null = null

function defaultBoard() {
  // 进来先给个 1 块 52 的台面，但选板页是开着的 —— 用户自己拼完才算数
  const preset = BOARD_PRESETS.find((p) => p.id === '52-1')!
  return {
    layout: { placements: placementsFromArray(preset.array), gapMm: 0 } as BoardLayout,
    geom: deriveLayoutGeometry({ placements: placementsFromArray(preset.array), gapMm: 0 }),
  }
}

const initial = defaultBoard()

function syncHistory() {
  return { canUndo: history.canUndo, canRedo: history.canRedo, undoBytes: history.memoryBytes() }
}

export const useEditor = create<EditorState>((set, get) => ({
  name: '未命名作品',
  layout: initial.layout,
  pickerOpen: true,
  projectId: 'local-draft',
  customer: null,
  createdAt: new Date().toISOString(),
  making: { completedCodes: [], completedRegions: {}, focusCode: null, startedAt: null },
  recommendStrategy: 'largest',
  savedAt: null,
  saving: false,
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
  pending: null,
  bench: null,
  benchRunning: false,
  sourceImage: null,
  sourceName: null,
  conversion: DEFAULT_SETTINGS,
  converting: false,
  progress: null,
  lastConvert: null,

  applyPreset(presetId) {
    const preset = BOARD_PRESETS.find((p) => p.id === presetId)
    if (!preset) return '没有这个预设'
    return get().applyLayout({
      placements: placementsFromArray(preset.array),
      gapMm: preset.array.gapMm,
    })
  },

  applyLayout(layout, keepContent = true) {
    let geom: BoardGeometry
    try {
      geom = deriveLayoutGeometry(layout)
    } catch (error) {
      return error instanceof Error ? error.message : '板阵不合法'
    }
    const state = get()
    const previous = state.grid
    const next = createGrid(geom.cols, geom.rows, EMPTY, geom.placeable)
    // 默认保留重叠位置上的内容：换板阵不该毁掉已经拼好的部分
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
      pickerOpen: false,
      geom,
      grid: next,
      version: state.version + 1,
      commitVersion: state.commitVersion + 1,
      selection: [],
      clipboard: null,
      pending: null,
      vp: fitViewport(geom.cols, geom.rows, 900, 700),
      notice:
        cells > WARN_CELLS
          ? `画布 ${cells.toLocaleString()} 格，超过 150 万格，建议改用 5mm 豆`
          : `${geom.boards.length} 块板 · ${geom.cols}×${geom.rows} 格`,
      ...syncHistory(),
    })
    return null
  },

  openPicker() {
    set({ pickerOpen: true })
  },

  closePicker() {
    set({ pickerOpen: false })
  },

  setName(name) {
    set({ name })
  },

  setCustomer(customer) {
    set({ customer })
  },

  setRecommendStrategy(recommendStrategy) {
    set({ recommendStrategy })
  },

  setFocusCode(focusCode) {
    const making = get().making
    // 值没变就别 set：store 状态对象换了 identity，订阅它的组件会再跑一次 effect，
    // 那些 effect 又调回来 —— 就是"Maximum update depth exceeded"
    if (making.focusCode === focusCode && making.startedAt) return
    set({
      making: {
        ...making,
        focusCode,
        startedAt: making.startedAt ?? new Date().toISOString(),
      },
    })
  },

  /** 点一个连通域 = 整块标记完成（第 12 节） */
  toggleRegion(code, regionId) {
    const { making } = get()
    const done = new Set(making.completedRegions[code] ?? [])
    if (done.has(regionId)) done.delete(regionId)
    else done.add(regionId)
    const next: MakingProgress = {
      ...making,
      completedRegions: {
        ...making.completedRegions,
        [code]: [...done].sort((a, b) => a - b),
      },
      startedAt: making.startedAt ?? new Date().toISOString(),
    }
    set({ making: next })
  },

  resetMaking() {
    set({
      making: { completedCodes: [], completedRegions: {}, focusCode: null, startedAt: null },
    })
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
      making: state.making,
      view: {
        zoom: state.vp.zoom,
        panX: state.vp.panX,
        panY: state.vp.panY,
        showCodes: state.showCodes,
      } satisfies ProjectView,
    }
  },

  async saveNow() {
    if (typeof indexedDB === 'undefined') return
    const state = get()
    set({ saving: true })
    try {
      const project = state.toProject()
      await putProject(project)
      await saveDraft(project)
      rememberLastProject(project.id)
      set({ savedAt: project.updatedAt, saving: false })
    } catch (error) {
      set({
        saving: false,
        notice: error instanceof Error ? `保存失败：${error.message}` : '保存失败',
      })
    }
  },

  loadProject(project) {
    const geom = deriveLayoutGeometry(project.layout)
    history.clear()
    recording = null
    lastPoint = null
    rectAnchor = null
    set({
      name: project.name,
      projectId: project.id,
      customer: project.customer,
      createdAt: project.createdAt,
      layout: project.layout,
      pickerOpen: false,
      geom,
      grid: project.grid,
      palette: getPalette(project.paletteId),
      paletteId: project.paletteId,
      allowedCodes: project.allowedCodes,
      conversion: project.conversion ?? DEFAULT_SETTINGS,
      making: project.making,
      selection: [],
      pending: null,
      notice: `已打开《${project.name}》`,
      version: get().version + 1,
      commitVersion: get().commitVersion + 1,
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

  newProject(name = '未命名作品', presetId = '52-1') {
    const preset = BOARD_PRESETS.find((p) => p.id === presetId) ?? BOARD_PRESETS[0]
    const layout: BoardLayout = {
      placements: placementsFromArray(preset.array),
      gapMm: preset.array.gapMm,
    }
    const geom = deriveLayoutGeometry(layout)
    history.clear()
    recording = null
    const project = createProject({
      name,
      layout,
      paletteId: get().paletteId,
      grid: createGrid(geom.cols, geom.rows, EMPTY, geom.placeable),
    })
    get().loadProject(project)
    set({ notice: '新建作品', pickerOpen: true })
  },

  setTool(tool) {
    rectAnchor = null
    set({ tool, notice: null })
  },
  setColor(colorIndex) {
    set({ colorIndex })
  },

  /** 换色板：旧色板里用到的每个色都重映射到新色板的最近色 */
  setPalette(id) {
    const { palette: oldPalette, grid } = get()
    const next = getPalette(id)
    if (next.id === oldPalette.id) return
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
    set({ palette: next, paletteId: next.id, allowedCodes: null, colorIndex: defaultColorIndex(next) })
    commitRecording(set, get, `换到 ${next.displayName}`)
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
    set({ allowedCodes: normalized })
    if (!isExcluded) {
      commitRecording(set, get, `排除 ${code}，重映射 ${remapped} 格`)
    } else {
      set({ notice: `恢复 ${code}（已重映射的格子不会自动变回来）` })
    }
  },

  restoreAllCodes() {
    set({ allowedCodes: null, notice: '恢复全部色号' })
  },
  setShowCodes(showCodes) {
    set({ showCodes, version: get().version + 1, commitVersion: get().commitVersion + 1 })
  },
  setVp(vp) {
    set({ vp })
  },
  fitTo(width, height, dpr = 1) {
    const { geom } = get()
    set({ vp: fitViewport(geom.cols, geom.rows, width, height, dpr) })
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

  setNotice(notice) {
    set({ notice })
  },

  undo() {
    const patch = history.undo(get().grid)
    if (!patch) return
    set({
      version: get().version + 1,
      commitVersion: get().commitVersion + 1,
      notice: `撤销：${patch.label}`,
      ...syncHistory(),
    })
  },

  redo() {
    const patch = history.redo(get().grid)
    if (!patch) return
    set({
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
    try {
      const image = await decodeImageFile(file)
      set({ sourceImage: image, sourceName: file.name })
      // 导入完直接转：只按一次按钮才看得到结果，中间那步「再点转换」会让人以为没反应
      await get().runConvert()
    } catch (error) {
      set({ notice: error instanceof Error ? error.message : '图片读不进来' })
    }
  },

  clearSourceImage() {
    set({ sourceImage: null, sourceName: null })
  },

  setConversion(patch) {
    set({ conversion: { ...get().conversion, ...patch } })
  },

  async runConvert() {
    const state = get()
    if (!state.sourceImage) {
      set({ notice: '先导入一张图片' })
      return
    }
    const paletteColors: Rgb[] = state.palette.colors.map((c) => c.rgb as Rgb)
    const allowed = allowedMask(state.palette, state.allowedCodes)
    set({ converting: true, progress: { stage: '准备', ratio: 0 }, notice: null })
    try {
      const result = await runConvert({
        image: state.sourceImage,
        paletteColors,
        allowed,
        cols: state.grid.cols,
        rows: state.grid.rows,
        settings: { ...state.conversion, dither: resolveDither(state.conversion.strategyId, state.conversion.dither) },
        onProgress: (stage, ratio) => set({ progress: { stage, ratio } }),
      })

      // 板没盖到的地方不属于作品：转换结果里的空档一律清掉
      const mask = state.grid.placeable
      if (mask) for (let i = 0; i < result.cells.length; i++) if (!mask[i]) result.cells[i] = EMPTY

      // 转换是一次大改动：能装进撤销栈就装，装不下就清空历史并说明
      const grid = state.grid
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
        version: state.version + 1,
        commitVersion: state.commitVersion + 1,
        converting: false,
        progress: null,
        lastConvert: {
          ms: result.ms,
          kind: result.kindOfSource,
          used: result.usedIndexes.length,
          dropped: result.droppedIndexes.length,
          cropped: result.cropped,
        },
        notice: recorder.overflowed
          ? '转换完成。改动太大，这一步不计入撤销历史'
          : `转换完成：用了 ${result.usedIndexes.length} 色，${result.ms} ms`,
        ...syncHistory(),
      })
    } catch (error) {
      set({
        converting: false,
        progress: null,
        notice: error instanceof Error ? error.message : '转换失败',
      })
    }
  },

  async runBench() {
    const { grid } = get()
    const renderer = getRenderer()
    if (!renderer) {
      set({ notice: '画布还没准备好，压测跑不了' })
      return
    }
    set({ benchRunning: true, notice: null })
    const phases = await runPanBench({
      grid,
      frames: 60,
      size: () => renderer.size(),
      draw: (vp) => renderer.draw(vp),
    })
    set({ bench: phases, benchRunning: false })
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
): void {
  const rec = recording
  recording = null
  if (!rec) return
  const patch = rec.patch()
  if (patch) history.push(patch)
  set({
    pending: null,
    version: get().version + 1,
    commitVersion: get().commitVersion + 1,
    notice: rec.overflowed
      ? '这次操作太大，不计入撤销历史'
      : (message ?? get().notice),
    ...syncHistory(),
  })
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

/** 导出给 UI 用的派生读数 */
export function gridStats(grid: CellGrid) {
  return { cells: grid.cols * grid.rows, used: usedCells(grid) }
}
