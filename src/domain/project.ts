import { unzlibSync, zlibSync } from 'fflate'

import {
  BOARD_PROFILES,
  deriveLayoutGeometry,
  placementsFromArray,
  type BoardArray,
  type BoardGeometry,
  type BoardLayout,
} from './board'
import { EMPTY, type CellGrid } from './grid'
import type { ConversionSettings } from '../conversion/convert'

/** 工程文件必须带 schemaVersion 和迁移函数（第 3.3 节） */
export const PROJECT_SCHEMA_VERSION = 1

export interface MakingProgress {
  /** 整个色号都拼完的 */
  completedCodes: string[]
  /** 按色号记录"已完成的连通域编号"（编号由 deterministic 的扫描顺序给出） */
  completedRegions: Record<string, number[]>
  focusCode: string | null
  startedAt: string | null
}

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
  making: MakingProgress
  view: ProjectView
}

/** 磁盘上的形状：格子用压缩过的 base64 存，不是 JSON 数组 */
interface StoredProject extends Omit<Project, 'grid' | 'schemaVersion'> {
  schemaVersion: number
  grid: {
    cols: number
    rows: number
    /** zlib 压缩后的 Uint16Array，base64 */
    data: string
    encoding: 'zlib-base64-u16'
  }
}

/**
 * 从板阵几何统一恢复网格遮罩。
 * placeable 是布局推导出来的事实，不从磁盘单独信任一份可能过期的副本。
 * 同时清掉空档里的历史脏数据，避免旧工程把空档当成可用格子。
 */
export function normalizeGridForLayout(grid: CellGrid, geometry: BoardGeometry): CellGrid {
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
  for (let i = 0; i < cells.length; i++) {
    if (geometry.placeable[i] !== 1) cells[i] = EMPTY
  }
  return {
    cols: geometry.cols,
    rows: geometry.rows,
    cells,
    placeable: geometry.placeable.slice(),
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
  const grid = normalizeGridForLayout(project.grid, geometry)
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

/**
 * 读：校验 schemaVersion → 迁移 → 校验格数 / 数组长度 / 色号。
 * 任一项不通过就明确报错，不静默修复（第 14.3 节）。
 */
/**
 * @param paletteSize 当前色板的颜色数。给了就校验格子里的索引没越界
 *                    （坏文件最典型的两种：格数超上限、引用了不存在的色号）
 */
export function parseProject(text: string, paletteSize?: number): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { project: null, error: { kind: 'fatal', message: '文件不是合法的 JSON' } }
  }
  if (!raw || typeof raw !== 'object') {
    return { project: null, error: { kind: 'fatal', message: '文件内容不是一个工程对象' } }
  }
  const stored = raw as Partial<StoredProject>
  if (typeof stored.schemaVersion !== 'number') {
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
  let recovered: string | null = null
  if (stored.schemaVersion < PROJECT_SCHEMA_VERSION) {
    recovered = `工程从 v${stored.schemaVersion} 迁移到 v${PROJECT_SCHEMA_VERSION}`
  }

  const grid = stored.grid
  if (!grid || typeof grid.cols !== 'number' || typeof grid.rows !== 'number') {
    return { project: null, error: { kind: 'fatal', message: '工程缺少画布尺寸' } }
  }
  const cells = grid.cols * grid.rows
  if (!Number.isFinite(cells) || cells <= 0 || cells > MAX_CELLS) {
    return {
      project: null,
      error: { kind: 'fatal', message: `画布格数 ${cells} 超出范围（上限 ${MAX_CELLS}）` },
    }
  }

  let restored: CellGrid
  try {
    const bytes = unzlibSync(fromBase64(grid.data ?? ''))
    if (bytes.byteLength !== cells * 2) {
      return {
        project: null,
        error: {
          kind: 'fatal',
          message: `格子数据长度不对：期望 ${cells * 2} 字节，实际 ${bytes.byteLength} 字节`,
        },
      }
    }
    const owned = bytes.slice().buffer
    restored = { cols: grid.cols, rows: grid.rows, cells: new Uint16Array(owned) }
  } catch {
    return { project: null, error: { kind: 'fatal', message: '格子数据解压失败，文件可能被截断' } }
  }

  // 板阵：新格式是 layout（自由摆放），老格式是 boardArray（固定矩阵）
  const layout: BoardLayout = stored.layout
    ? (stored.layout as BoardLayout)
    : stored.boardArray
      ? { placements: placementsFromArray(stored.boardArray as BoardArray), gapMm: (stored.boardArray as BoardArray).gapMm }
      : { placements: [], gapMm: 0 }
  let geometry: ReturnType<typeof deriveLayoutGeometry>
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
  restored = normalizeGridForLayout(restored, geometry)

  if (!stored.paletteId) {
    return { project: null, error: { kind: 'fatal', message: '工程没写色板 id' } }
  }
  if (paletteSize && paletteSize > 0) {
    for (let i = 0; i < restored.cells.length; i++) {
      const value = restored.cells[i]
      if (value !== EMPTY && value >= paletteSize) {
        return {
          project: null,
          error: {
            kind: 'fatal',
            message: `第 ${i} 格引用了不存在的色号（索引 ${value}，色板只有 ${paletteSize} 色）`,
          },
        }
      }
    }
  }

  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: stored.id ?? cryptoId(),
    name: stored.name ?? '未命名作品',
    customer: stored.customer ?? null,
    createdAt: stored.createdAt ?? new Date().toISOString(),
    updatedAt: stored.updatedAt ?? new Date().toISOString(),
    layout,
    paletteId: stored.paletteId ?? 'mard-291',
    allowedCodes: stored.allowedCodes ?? null,
    grid: restored,
    conversion: stored.conversion ?? null,
    making: {
      completedCodes: stored.making?.completedCodes ?? [],
      completedRegions: stored.making?.completedRegions ?? {},
      focusCode: stored.making?.focusCode ?? null,
      startedAt: stored.making?.startedAt ?? null,
    },
    view: stored.view ?? { zoom: 8, panX: 0, panY: 0, showCodes: true },
  }

  return {
    project,
    error: recovered ? { kind: 'recovered', message: recovered } : null,
  }
}

export function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // 没有 crypto 时退回时间戳 + 计数器（只在测试等环境里发生）
  return `p-${Date.now().toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`
}

/**
 * IndexedDB 里可能还躺着老版本写的工程（只有 boardArray，甚至两个字段都没有）。
 * 每一条读出来的工程都过一遍这里，别让缺失的 layout 漏到渲染层。
 */
export function ensureLayout(project: Project): Project {
  if (project.layout) return project
  const array = project.boardArray
  return {
    ...project,
    layout: array
      ? { placements: placementsFromArray(array), gapMm: array.gapMm }
      : { placements: [], gapMm: 0 },
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
    making: { completedCodes: [], completedRegions: {}, focusCode: null, startedAt: null },
    view: { zoom: 8, panX: 0, panY: 0, showCodes: true },
  }
}

/** 缩略图从 grid 生成，不需要重算（第 14.2 节） */
export function projectSummary(project: Project) {
  let used = 0
  const codes = new Set<number>()
  for (const value of project.grid.cells) {
    if (value === EMPTY) continue
    used++
    codes.add(value)
  }
  return {
    cells: project.grid.cols * project.grid.rows,
    beads: used,
    colorCount: codes.size,
    boardCount: project.layout.placements.length,
    sizeMm: {
      w: project.grid.cols * pitchOf(project.layout),
      h: project.grid.rows * pitchOf(project.layout),
    },
  }
}

/** 板阵用的针距（mm）。空板阵按 2.6mm 报 */
function pitchOf(layout: BoardLayout): number {
  const first = layout.placements[0]
  return first ? BOARD_PROFILES[first.board].pitchMm : 2.6
}
