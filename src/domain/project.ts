import { unzlibSync, zlibSync } from 'fflate'

import { findPalette, getPalette } from '../data/palettes.ts'
import {
  deriveLayoutGeometry,
  describeLayoutError,
  placementsFromArray,
  placementsSizeMm,
  describeBoardArrayError,
  validateBoardArray,
  validateLayout,
  type BoardArray,
  type BoardGeometry,
  type BoardLayout,
} from './board.ts'
import { EMPTY, type CellGrid } from './grid.ts'
import type { ConversionSettings } from '../conversion/convert.ts'
import { DEFAULT_SETTINGS } from '../conversion/settings.ts'
import { STRATEGIES } from '../conversion/strategies.ts'

/** 工程文件必须带 schemaVersion 和迁移函数（第 3.3 节） */
export const PROJECT_SCHEMA_VERSION = 1

export interface ProjectView {
  zoom: number
  panX: number
  panY: number
  showCodes: boolean
}

export interface Project {
  schemaVersion: number
  id: string
  name: string
  customer: string | null
  createdAt: string
  updatedAt: string
  /** 板阵：自由摆放的板列表。老工程只有 boardArray，读的时候会转过来 */
  layout: BoardLayout
  /** @deprecated 旧格式（固定矩阵）。能读，写的时候只写 layout */
  boardArray?: BoardArray
  paletteId: string
  allowedCodes: string[] | null
  grid: CellGrid
  conversion: ConversionSettings | null
  view: ProjectView
}

/** 磁盘上的形状：格子用压缩过的 base64 存，不是 JSON 数组 */
interface StoredGrid {
  cols: number
  rows: number
  /** 文件格式：zlib 压缩后的 Uint16Array，base64 */
  data?: string
  encoding?: string
  /** IndexedDB 格式：结构化克隆直接把 Uint16Array 存下来 */
  cells?: unknown
}

interface StoredProject extends Omit<Project, 'grid' | 'schemaVersion'> {
  schemaVersion: number
  grid: StoredGrid
}

/**
 * 从板阵几何统一恢复网格遮罩。
 * placeable 是布局推导出来的事实，不从磁盘单独信任一份可能过期的副本。
 * 同时清掉空档里的历史脏数据，避免旧工程把空档当成可用格子。
 *
 * 返回清掉了几格：调用方要能把“这份文件本来就有脏数据”告诉用户，
 * 而不是默默修完了当没事发生。
 */
export function normalizeGridForLayout(
  grid: CellGrid,
  geometry: BoardGeometry,
): { grid: CellGrid; cleared: number } {
  const expected = geometry.cols * geometry.rows
  if (
    grid.cols !== geometry.cols ||
    grid.rows !== geometry.rows ||
    grid.cells.length !== expected
  ) {
    throw new Error(
      `板阵推出的是 ${geometry.cols}×${geometry.rows}，格子数据是 ${grid.cols}×${grid.rows}，对不上`,
    )
  }
  const cells = grid.cells.slice()
  let cleared = 0
  for (let i = 0; i < cells.length; i++) {
    if (geometry.placeable[i] === 1) continue
    if (cells[i] !== EMPTY) cleared++
    cells[i] = EMPTY
  }
  return {
    grid: {
      cols: geometry.cols,
      rows: geometry.rows,
      cells,
      placeable: geometry.placeable.slice(),
    },
    cleared,
  }
}

export type ParseError = { kind: 'fatal'; message: string } | { kind: 'recovered'; message: string }

export interface ParseResult {
  project: Project | null
  error: ParseError | null
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * 存：zlib 压缩后再 base64。大色块图能压到几十分之一，
 * 比 JSON 数组（500 万格要写 1000 万字符）省太多。
 * 格式是原始的 U16 字节流（JS 引擎全是小端，跨端读也没问题）。
 */
export function serializeProject(project: Project): string {
  const geometry = deriveLayoutGeometry(project.layout)
  const { grid } = normalizeGridForLayout(project.grid, geometry)
  const { cells } = grid
  const bytes = new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength)
  const stored: StoredProject = {
    ...project,
    grid: {
      cols: grid.cols,
      rows: grid.rows,
      data: toBase64(zlibSync(bytes, { level: 6 })),
      encoding: 'zlib-base64-u16',
    },
  }
  return JSON.stringify(stored)
}

const MAX_CELLS = 5_000_000

/** 只认白名单里的编码：读到不认识的编码宁可拒绝，也不要猜怎么解 */
const SUPPORTED_ENCODINGS = new Set(['zlib-base64-u16'])

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && Number.isFinite(Date.parse(value))
}

/** IndexedDB 里格子就是 Uint16Array；写成普通数组也认，坏数据不认 */
function plainCells(value: unknown): Uint16Array {
  if (value instanceof Uint16Array) return value.slice()
  if (!Array.isArray(value)) throw new Error('格子数据不是数组')
  const cells = new Uint16Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const cell = value[i]
    if (!Number.isInteger(cell) || cell < 0 || cell > 0xffff) {
      throw new Error(`第 ${i} 格不是合法的色号索引`)
    }
    cells[i] = cell
  }
  return cells
}

/** 多条“已经替你修好了”的提示拼成一条 —— 界面只有一个位置放它 */
function joinNotes(notes: string[]): ParseError | null {
  return notes.length > 0 ? { kind: 'recovered', message: notes.join('；') } : null
}

/** 视图设置：数值必须是有限正数，否则重置。视图坏了不值得拒绝整份工程 */
function readView(raw: unknown, notes: string[]): ProjectView {
  const view = (raw ?? {}) as Partial<ProjectView>
  const zoom = finiteOr(view.zoom, 8)
  const panX = finiteOr(view.panX, 0)
  const panY = finiteOr(view.panY, 0)
  const showCodes = typeof view.showCodes === 'boolean' ? view.showCodes : true
  const clean =
    zoom === view.zoom && panX === view.panX && panY === view.panY && showCodes === view.showCodes
  if (!clean && raw !== undefined) notes.push('视图设置不规范，已修正')
  return { zoom: zoom > 0 ? zoom : 8, panX, panY, showCodes }
}

/** 色号白名单：不存在的色号要剔除，否则 UI 上会出现“看得见却用不了”的色号 */
function readAllowedCodes(raw: unknown, paletteId: string, notes: string[]): string[] | null {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw)) {
    notes.push('可用色号名单格式不对，已改成全部可用')
    return null
  }
  const codes = getPalette(paletteId).colors.map((c) => c.code)
  const known = new Set(codes)
  const kept = raw.filter((code): code is string => typeof code === 'string' && known.has(code))
  if (kept.length !== raw.length) notes.push('可用色号名单里有不存在的色号，已剔除')
  if (kept.length === 0 || kept.length === codes.length) return null
  return kept
}

function readConversion(raw: unknown, notes: string[]): ConversionSettings | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('转换参数读不出来，已重置')
    return null
  }
  const value = raw as Partial<ConversionSettings>
  if (value.strategyId !== 'auto' && !Object.prototype.hasOwnProperty.call(STRATEGIES, String(value.strategyId))) {
    notes.push(`转换策略“${String(value.strategyId)}”不存在，已重置转换参数`)
    return null
  }
  const count = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback
  const bounded = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
    return Math.max(min, Math.min(max, n))
  }
  return {
    strategyId: value.strategyId as ConversionSettings['strategyId'],
    maxColors: count(value.maxColors, DEFAULT_SETTINGS.maxColors),
    dither: value.dither === null || value.dither === undefined ? null : Math.max(0, finiteOr(value.dither, 0)),
    cropToSubject: value.cropToSubject !== false,
    removeBackground: value.removeBackground === true,
    clearExisting: value.clearExisting !== false,
    fit: value.fit === 'contain' || value.fit === 'stretch' ? value.fit : 'cover',
    scale: bounded(value.scale, DEFAULT_SETTINGS.scale, 0.25, 3),
    offsetX: bounded(value.offsetX, DEFAULT_SETTINGS.offsetX, -1, 1),
    offsetY: bounded(value.offsetY, DEFAULT_SETTINGS.offsetY, -1, 1),
    backgroundThreshold: bounded(value.backgroundThreshold, DEFAULT_SETTINGS.backgroundThreshold, 0, 100),
  }
}

/**
 * 读：校验 schemaVersion → 迁移 → 校验格数 / 数组长度 / 色号。
 * 任一项不通过就明确报错，不静默修复（第 14.3 节）。
 */
export function parseProject(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { project: null, error: { kind: 'fatal', message: '文件不是合法的 JSON' } }
  }
  return validateProject(raw)
}

/**
 * 工程对象的唯一入口校验。三条读路径共用：工程文件导入、IndexedDB 读取、复制。
 *
 * 结构性错误（版本 / 格数 / 解码 / 板阵 / 色板 id）直接拒绝；
 * 可修的字段（时间戳 / 视图 / 越界白名单 / 空档脏数据）就地修好，
 * 并在 error.message 里说清楚改了什么。
 */
export function validateProject(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') {
    return { project: null, error: { kind: 'fatal', message: '文件内容不是一个工程对象' } }
  }
  const stored = raw as Partial<StoredProject>
  const notes: string[] = []

  if (typeof stored.schemaVersion !== 'number' || !Number.isFinite(stored.schemaVersion)) {
    return { project: null, error: { kind: 'fatal', message: '缺少 schemaVersion，无法确认版本' } }
  }
  if (stored.schemaVersion > PROJECT_SCHEMA_VERSION) {
    return {
      project: null,
      error: {
        kind: 'fatal',
        message: `这个文件是更新版本（v${stored.schemaVersion}）存的，当前程序只认到 v${PROJECT_SCHEMA_VERSION}`,
      },
    }
  }
  if (stored.schemaVersion < PROJECT_SCHEMA_VERSION) {
    notes.push(`工程从 v${stored.schemaVersion} 迁移到 v${PROJECT_SCHEMA_VERSION}`)
  }

  const grid = stored.grid
  if (!grid || typeof grid !== 'object') {
    return { project: null, error: { kind: 'fatal', message: '工程缺少画布尺寸' } }
  }
  if (grid.encoding !== undefined && !SUPPORTED_ENCODINGS.has(String(grid.encoding))) {
    return {
      project: null,
      error: { kind: 'fatal', message: `不支持的格子编码：${String(grid.encoding)}` },
    }
  }
  if (
    !Number.isInteger(grid.cols) ||
    !Number.isInteger(grid.rows) ||
    grid.cols <= 0 ||
    grid.rows <= 0
  ) {
    return {
      project: null,
      error: {
        kind: 'fatal',
        message: `画布尺寸必须是正整数：${String(grid.cols)} × ${String(grid.rows)}`,
      },
    }
  }
  if (typeof grid.data !== 'string' && grid.cells === undefined) {
    return { project: null, error: { kind: 'fatal', message: '工程缺少格子数据' } }
  }
  const cells = grid.cols * grid.rows
  if (cells > MAX_CELLS) {
    return {
      project: null,
      error: { kind: 'fatal', message: `画布格数 ${cells} 超出范围（上限 ${MAX_CELLS}）` },
    }
  }

  let restored: CellGrid
  try {
    if (typeof grid.data === 'string') {
      // 工程文件：zlib + base64。给一个只比预期多 1 字节的输出缓冲：
      // 解压炸弹最多只能撑到 expected + 1，多出来的那一格让长度检查把文件挡回去。
      const expected = cells * 2
      const bytes = unzlibSync(fromBase64(grid.data), { out: new Uint8Array(expected + 1) })
      if (bytes.length !== expected) {
        return {
          project: null,
          error: {
            kind: 'fatal',
            message: `格子数据长度不对：期望 ${expected} 字节，实际 ${bytes.length} 字节`,
          },
        }
      }
      restored = { cols: grid.cols, rows: grid.rows, cells: new Uint16Array(bytes.buffer, bytes.byteOffset, cells) }
    } else {
      // IndexedDB：已经没有压缩这一层，直接拿数组
      restored = { cols: grid.cols, rows: grid.rows, cells: plainCells(grid.cells) }
    }
  } catch {
    return { project: null, error: { kind: 'fatal', message: '格子数据解压失败，文件可能被截断' } }
  }
  if (restored.cells.length !== cells) {
    return {
      project: null,
      error: {
        kind: 'fatal',
        message: `格子数据长度不对：期望 ${cells} 格，实际 ${restored.cells.length} 格`,
      },
    }
  }

  // 板阵：新格式是 layout（自由摆放），老格式是 boardArray（固定矩阵）。
  // 旧数据先走完整校验，避免 placementsFromArray 对坏板型直接抛 TypeError。
  let layout: BoardLayout
  if (stored.layout) {
    layout = stored.layout as BoardLayout
  } else if (stored.boardArray) {
    const boardArray = stored.boardArray as BoardArray
    const invalidArray = validateBoardArray(boardArray)
    if (invalidArray) {
      return {
        project: null,
        error: { kind: 'fatal', message: `板阵非法：${describeBoardArrayError(invalidArray)}` },
      }
    }
    layout = { placements: placementsFromArray(boardArray), gapMm: boardArray.gapMm }
  } else {
    layout = { placements: [], gapMm: 0 }
  }
  const invalidLayout = validateLayout(layout)
  if (invalidLayout) {
    return {
      project: null,
      error: { kind: 'fatal', message: `板阵非法：${describeLayoutError(invalidLayout)}` },
    }
  }
  const rawGap = (layout as Partial<BoardLayout>).gapMm
  const gapMm =
    typeof rawGap === 'number' && Number.isFinite(rawGap) && rawGap >= 0 ? rawGap : 0
  if (rawGap !== undefined && gapMm !== rawGap) notes.push('板缝数值不规范，已改成 0')
  layout = { ...layout, gapMm }
  let geometry: BoardGeometry
  try {
    geometry = deriveLayoutGeometry(layout)
  } catch (error) {
    return {
      project: null,
      error: {
        kind: 'fatal',
        message: `板阵非法：${error instanceof Error ? error.message : '读不出来'}`,
      },
    }
  }
  if (geometry.cols !== restored.cols || geometry.rows !== restored.rows) {
    return {
      project: null,
      error: {
        kind: 'fatal',
        message: `板阵推出的是 ${geometry.cols}×${geometry.rows}，格子数据是 ${restored.cols}×${restored.rows}，对不上`,
      },
    }
  }
  const normalized = normalizeGridForLayout(restored, geometry)
  restored = normalized.grid
  if (normalized.cleared > 0) {
    notes.push(`板外的空档里有 ${normalized.cleared} 格脏数据，已清掉`)
  }

  if (typeof stored.paletteId !== 'string' || !stored.paletteId) {
    return { project: null, error: { kind: 'fatal', message: '工程没写色板 id' } }
  }
  const palette = findPalette(stored.paletteId)
  if (!palette) {
    // 不静默回退：换个色板，色号会全部对不上，必须拒绝这份工程。
    return {
      project: null,
      error: { kind: 'fatal', message: `找不到色板：${stored.paletteId}` },
    }
  }
  const paletteId = palette.id
  const size = palette.colors.length
  if (size > 0) {
    for (let i = 0; i < restored.cells.length; i++) {
      const value = restored.cells[i]
      if (value !== EMPTY && value >= size) {
        return {
          project: null,
          error: {
            kind: 'fatal',
            message: `第 ${i} 格引用了不存在的色号（索引 ${value}，色板只有 ${size} 色）`,
          },
        }
      }
    }
  }

  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: typeof stored.id === 'string' && stored.id ? stored.id : cryptoId(),
    name: typeof stored.name === 'string' && stored.name.trim() ? stored.name : '未命名作品',
    customer: typeof stored.customer === 'string' && stored.customer ? stored.customer : null,
    createdAt: isIsoDate(stored.createdAt) ? stored.createdAt : new Date().toISOString(),
    updatedAt: isIsoDate(stored.updatedAt) ? stored.updatedAt : new Date().toISOString(),
    layout,
    paletteId,
    allowedCodes: readAllowedCodes(stored.allowedCodes, paletteId, notes),
    grid: restored,
    conversion: readConversion(stored.conversion, notes),
    view: readView(stored.view, notes),
  }

  return { project, error: joinNotes(notes) }
}

export function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // 没有 crypto 时退回时间戳 + 计数器（只在测试等环境里发生）
  return `p-${Date.now().toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`
}

/**
 * IndexedDB 里可能还躺着老版本写的工程（只有 boardArray，甚至两个字段都没有）。
 * 和工程文件走同一套校验，别让坏数据绕过导入那条路直接进运行时。
 */
export function decodeStoredProject(value: unknown): Project | null {
  try {
    const result = validateProject(value)
    return result.project
  } catch {
    return null
  }
}

export function createProject(options: {
  name: string
  /** 新代码用这个 */
  layout?: BoardLayout
  /** 老调用方还传矩阵，会自动转成摆放列表 */
  boardArray?: BoardArray
  paletteId: string
  grid: CellGrid
  conversion?: ConversionSettings | null
}): Project {
  const layout: BoardLayout =
    options.layout ??
    (options.boardArray
      ? { placements: placementsFromArray(options.boardArray), gapMm: options.boardArray.gapMm }
      : { placements: [], gapMm: 0 })
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: cryptoId(),
    name: options.name,
    customer: null,
    createdAt: now,
    updatedAt: now,
    layout,
    paletteId: options.paletteId,
    allowedCodes: null,
    grid: options.grid,
    conversion: options.conversion ?? null,
    view: { zoom: 8, panX: 0, panY: 0, showCodes: true },
  }
}

/** 缩略图从 grid 生成，不需要重算（第 14.2 节） */
export interface ProjectSummary {
  cells: number
  beads: number
  colorCount: number
  boardCount: number
  sizeMm: { w: number; h: number }
}

export function projectSummary(project: Project): ProjectSummary {
  let used = 0
  const codes = new Set<number>()
  const placeable = project.grid.placeable
  for (let i = 0; i < project.grid.cells.length; i++) {
    const value = project.grid.cells[i]
    if (value === EMPTY) continue
    if (placeable && placeable[i] !== 1) continue
    used++
    codes.add(value)
  }
  return {
    cells: project.grid.cols * project.grid.rows,
    beads: used,
    colorCount: codes.size,
    boardCount: project.layout.placements.length,
    sizeMm: placementsSizeMm(project.layout.placements, project.layout.gapMm),
  }
}
