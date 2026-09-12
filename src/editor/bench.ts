import type { CellGrid } from '../domain/grid'
import { visibleRange, type Viewport } from '../render/canvasViewport'

export interface BenchPhase {
  label: string
  zoom: number
  visibleCells: number
  frames: number
  /** 一次重绘的平均耗时 */
  avgDrawMs: number
  worstDrawMs: number
  /** 按平均重绘耗时算出的理论帧率 */
  fps: number
}

export interface BenchOptions {
  grid: CellGrid
  size: () => { width: number; height: number }
  draw: (vp: Viewport) => void
  frames?: number
}

const WARMUP = 3

function summarize(label: string, zoom: number, visibleCells: number, times: number[]): BenchPhase {
  const kept = times.slice(WARMUP)
  const sum = kept.reduce((a, b) => a + b, 0)
  const avg = sum / kept.length
  return {
    label,
    zoom: Number(zoom.toFixed(2)),
    visibleCells,
    frames: kept.length,
    avgDrawMs: Number(avg.toFixed(2)),
    worstDrawMs: Number(Math.max(...kept).toFixed(2)),
    fps: Math.round(1000 / avg),
  }
}

function phase(zoom: number, panStep: number, opts: BenchOptions, label: string): Promise<BenchPhase> {
  const { grid, draw, size, frames = 60 } = opts
  const { width, height } = size()
  const range = visibleRange({ zoom, panX: 0, panY: 0, dpr: 1 }, grid.cols, grid.rows, width, height)
  const visibleCells = (range.c1 - range.c0) * (range.r1 - range.r0)
  const times: number[] = []
  let frame = 0

  return new Promise((resolve) => {
    const tick = () => {
      // 三角波来回拖：始终在有效范围内，也不会有跳帧干扰
      const t = frame % 120
      const s = t < 60 ? t : 120 - t
      const t0 = performance.now()
      draw({ zoom, panX: -s * panStep, panY: -s * (panStep / 2), dpr: 1 })
      times.push(performance.now() - t0)
      if (++frame < frames + WARMUP) requestAnimationFrame(tick)
      else resolve(summarize(label, zoom, visibleCells, times))
    }
    requestAnimationFrame(tick)
  })
}

/**
 * 拖动性能自测，两个档位各跑一遍：
 * 1. 编辑档（放大逐格画）
 * 2. 全局档（缩到整图铺满，走位图缓存）
 */
export async function runPanBench(opts: BenchOptions): Promise<BenchPhase[]> {
  const { grid, frames = 60, size } = opts
  const out: BenchPhase[] = []
  out.push(await phase(8, 6, { ...opts, frames }, '编辑档 zoom 8（逐格绘制）'))
  const { width, height } = size()
  const fitZoom = Math.min(width / grid.cols, height / grid.rows)
  out.push(await phase(fitZoom, 4, { ...opts, frames }, '全局档（缩到整图铺满，位图缓存）'))
  return out
}
