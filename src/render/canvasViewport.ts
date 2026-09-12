/**
 * 视口：豆格坐标 ↔ 屏幕像素。渲染的唯一入口，其它地方不许自己算缩放平移。
 */
import { EMPTY } from '../domain/grid'

export interface Viewport {
  /** 每格像素数 */
  zoom: number
  panX: number
  panY: number
  /** devicePixelRatio */
  dpr: number
}

export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 64
/** 到这一档才画逐格色号（第 13.1 节） */
export const CODE_ZOOM = 14
/** 到这一档才画细网格线 */
export const GRID_ZOOM = 3

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** 100% 吸附：滑块靠近 1 时直接落到 1（yourlin 的细节） */
export function snapZoom(z: number): number {
  return Math.abs(z - 1) < 0.06 ? 1 : z
}

export interface CellRect {
  c0: number
  c1: number
  r0: number
  r1: number
}

/** 只算可见格范围，绝不遍历整张图 */
export function visibleRange(
  vp: Viewport,
  cols: number,
  rows: number,
  canvasW: number,
  canvasH: number,
): CellRect {
  return {
    c0: Math.max(0, Math.floor(-vp.panX / vp.zoom)),
    c1: Math.min(cols, Math.ceil((canvasW - vp.panX) / vp.zoom)),
    r0: Math.max(0, Math.floor(-vp.panY / vp.zoom)),
    r1: Math.min(rows, Math.ceil((canvasH - vp.panY) / vp.zoom)),
  }
}

export function screenToCell(vp: Viewport, x: number, y: number) {
  return { col: Math.floor((x - vp.panX) / vp.zoom), row: Math.floor((y - vp.panY) / vp.zoom) }
}

export function cellToScreen(vp: Viewport, col: number, row: number) {
  return { x: vp.panX + col * vp.zoom, y: vp.panY + row * vp.zoom }
}

/** 缩放并锚定屏幕点 (x, y)：该点下面的豆格保持不动 */
export function zoomAt(vp: Viewport, nextZoom: number, x: number, y: number): Viewport {
  const zoom = clampZoom(nextZoom)
  return {
    ...vp,
    zoom,
    panX: x - ((x - vp.panX) / vp.zoom) * zoom,
    panY: y - ((y - vp.panY) / vp.zoom) * zoom,
  }
}

/**
 * 滚轮 / 触控板捏合 → 新视口。
 *
 * 触控板捏合在 Chrome 里是带 ctrlKey 的 wheel（deltaY 很小），所以灵敏度不一样；
 * 不拦掉的话浏览器会把整个页面缩放掉 —— 缩放要只作用于画布。
 */
export const WHEEL_SENSITIVITY = 0.0015
export const PINCH_SENSITIVITY = 0.01

export function zoomFromWheel(
  vp: Viewport,
  deltaY: number,
  pinch: boolean,
  x: number,
  y: number,
): Viewport {
  const sensitivity = pinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY
  const factor = Math.exp(-deltaY * sensitivity)
  return zoomAt(vp, vp.zoom * factor, x, y)
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, panX: vp.panX + dx, panY: vp.panY + dy }
}

/** 让整张图居中铺满，留 pad 像素边距 */
export function fitViewport(
  cols: number,
  rows: number,
  canvasW: number,
  canvasH: number,
  dpr = 1,
  pad = 24,
): Viewport {
  const zoom = clampZoom(Math.min((canvasW - pad * 2) / cols, (canvasH - pad * 2) / rows))
  return {
    zoom,
    dpr,
    panX: (canvasW - cols * zoom) / 2,
    panY: (canvasH - rows * zoom) / 2,
  }
}

/** 把画布限制在视口里，不让用户把图拖到看不见的地方 */
export function clampViewport(
  vp: Viewport,
  cols: number,
  rows: number,
  canvasW: number,
  canvasH: number,
): Viewport {
  const w = cols * vp.zoom
  const h = rows * vp.zoom
  const slack = 64
  const minX = Math.min(slack, canvasW - w - slack)
  const minY = Math.min(slack, canvasH - h - slack)
  return {
    ...vp,
    panX: Math.min(Math.max(vp.panX, minX), canvasW - slack),
    panY: Math.min(Math.max(vp.panY, minY), canvasH - slack),
  }
}

/**
 * 把视口对到某个区域上（跟做模式的"推荐下一个区域"）。
 * 两边都要能调：当前缩放太大就缩下来（否则推荐了也看不全），太小就放大。
 * 最后过一遍 clampViewport，目标不会跑出画布外。
 */
export function fitViewportToRegion(
  vp: Viewport,
  bbox: { c0: number; r0: number; c1: number; r1: number },
  canvasW: number,
  canvasH: number,
  cols: number,
  rows: number,
  padCells = 25,
): Viewport {
  if (!canvasW || !canvasH) return vp
  const spanCols = Math.max(8, bbox.c1 - bbox.c0 + padCells)
  const spanRows = Math.max(8, bbox.r1 - bbox.r0 + padCells)
  const zoom = clampZoom(Math.min(canvasW / spanCols, canvasH / spanRows))
  return clampViewport(
    {
      ...vp,
      zoom,
      panX: canvasW / 2 - ((bbox.c0 + bbox.c1) / 2) * zoom,
      panY: canvasH / 2 - ((bbox.r0 + bbox.r1) / 2) * zoom,
    },
    cols,
    rows,
    canvasW,
    canvasH,
  )
}

/** 空格判空用（渲染和工具都从这儿走，避免各处重复写 EMPTY 比较） */
export function isEmpty(value: number): boolean {
  return value === EMPTY
}
