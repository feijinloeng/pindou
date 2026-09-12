import type { Viewport } from './canvasViewport'

export interface RendererHandle {
  /** 用给定视口重画一次（不经过 React 状态） */
  draw: (vp: Viewport) => void
  size: () => { width: number; height: number }
  dpr: () => number
}

let handle: RendererHandle | null = null

/** 画布挂载时注册自己，卸载时清掉。压测靠它直接调绘制，不走状态更新 */
export function setRenderer(next: RendererHandle | null): void {
  handle = next
}

export function getRenderer(): RendererHandle | null {
  return handle
}
