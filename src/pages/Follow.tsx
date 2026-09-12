import { useEffect, useMemo, useRef, useState } from 'react'

import { useEditor } from '../editor/store'
import {
  findAllRegions,
  findRegionAt,
  isColorComplete,
  progressOf,
  recommendRegion,
} from '../follow/followMode'
import { usageByIndex } from '../domain/grid'
import {
  clampViewport,
  fitViewport,
  fitViewportToRegion,
  panBy,
  screenToCell,
  zoomFromWheel,
  type Viewport,
} from '../render/canvasViewport'
import { drawPattern } from '../render/drawPattern'
import { GridBitmap } from '../render/gridBitmap'
import { t } from '../i18n/zh'
import { Btn } from '../components/ui'

/** 稳定引用，免得每次 render 都当成新数组触发重算 */
const NO_REGIONS: never[] = []
/** 超过这个位移才算"拖动画布"，否则就是一次点击（否则想标记却把视口挪走了） */
const DRAG_THRESHOLD_PX = 4

const STRATEGIES = [
  { id: 'largest', label: '最大的区域' },
  { id: 'nearest', label: '离上次最近' },
  { id: 'edge-first', label: '从边缘开始' },
] as const

export default function Follow() {
  const grid = useEditor((s) => s.grid)
  const palette = useEditor((s) => s.palette)
  const geom = useEditor((s) => s.geom)
  const making = useEditor((s) => s.making)
  const strategy = useEditor((s) => s.recommendStrategy)
  const version = useEditor((s) => s.commitVersion)
  const a = useEditor.getState()
  const copy = t('follow')

  const [focusCode, setFocusCode] = useState<string | null>(making.focusCode)
  const [lastPoint, setLastPoint] = useState<{ col: number; row: number } | null>(null)
  const [dpr] = useState(() => (typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bitmap = useMemo(() => new GridBitmap(), [])
  const [vp, setVp] = useState<Viewport>(() => fitViewport(grid.cols, grid.rows, 900, 700, 1))
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** 按下时的起点：没超过阈值就不平移 */
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)

  const usage = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )

  const focusIndex = focusCode ? palette.colors.findIndex((c) => c.code === focusCode) : -1
  // 全图连通域只算一次：以前每个色号各扫一遍全图（291 × 130 万格），页面直接卡死
  const allRegions = useMemo(
    () => findAllRegions(grid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version],
  )
  const regions = useMemo(
    () => (focusIndex >= 0 ? (allRegions.byColor[focusIndex] ?? NO_REGIONS) : NO_REGIONS),
    [allRegions, focusIndex],
  )
  const completed = useMemo(
    () => new Set(focusCode ? making.completedRegions[focusCode] ?? [] : []),
    [focusCode, making],
  )
  const progress = progressOf(regions, completed)

  /** 已完成的格子在画布上画淡 */
  const completedMask = useMemo(() => {
    const mask = new Uint8Array(grid.cols * grid.rows)
    for (const region of regions) {
      if (!completed.has(region.id)) continue
      for (const index of region.cells) mask[index] = 1
    }
    return mask
  }, [regions, completed, grid.cols, grid.rows])

  useEffect(() => {
    if (focusCode) useEditor.getState().setFocusCode(focusCode)
  }, [focusCode])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size.width) return
    setVp((current) => (current.panX === 0 && current.panY === 0 ? fitViewport(grid.cols, grid.rows, size.width, size.height, dpr) : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, grid.cols, grid.rows])

  /**
   * 缩放只作用于画布：React 的 onWheel 是 passive 的，拦不住浏览器缩放（和编辑器里同一个坑）。
   * 触控板捏合 = 带 ctrlKey 的 wheel；Safari 捏合 = gesture 事件。
   */
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const zoomBy = (deltaY: number, pinch: boolean, x: number, y: number) => {
      setVp((current) =>
        clampViewport(
          zoomFromWheel(current, deltaY, pinch, x, y),
          grid.cols,
          grid.rows,
          size.width,
          size.height,
        ),
      )
    }
    const point = (clientX: number | undefined, clientY: number | undefined) => {
      const rect = el.getBoundingClientRect()
      return { x: (clientX ?? 0) - rect.left, y: (clientY ?? 0) - rect.top }
    }
    const onWheel = (e: WheelEvent) => {
      const inside = wrapRef.current?.contains(e.target as Node) ?? false
      const pinch = e.ctrlKey || e.metaKey
      if (!inside && !pinch) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const { x, y } = inside ? point(e.clientX, e.clientY) : { x: rect.width / 2, y: rect.height / 2 }
      zoomBy(e.deltaY, pinch, x, y)
    }
    let gestureScale = 1
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number }
      const scale = g.scale ?? 1
      const deltaY = -Math.log(scale / gestureScale) / 0.01
      gestureScale = scale
      const inside = wrapRef.current?.contains(g.target as Node) ?? false
      const rect = el.getBoundingClientRect()
      const { x, y } = inside ? point(g.clientX, g.clientY) : { x: rect.width / 2, y: rect.height / 2 }
      zoomBy(deltaY, true, x, y)
    }
    const preventOnly = (e: Event) => {
      e.preventDefault()
      gestureScale = 1
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('gesturestart', preventOnly)
    document.addEventListener('gesturechange', onGestureChange)
    document.addEventListener('gestureend', preventOnly)
    return () => {
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('gesturestart', preventOnly)
      document.removeEventListener('gesturechange', onGestureChange)
      document.removeEventListener('gestureend', preventOnly)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.cols, grid.rows, size.width, size.height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.width) return
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawPattern(ctx, {
      grid,
      palette,
      vp: { ...vp, dpr },
      width: size.width,
      height: size.height,
      showCodes: vp.zoom >= 14,
      version: 0,
      boards: geom.boards,
      placeable: grid.placeable,
      bitmap,
      focus: { colorIndex: focusIndex >= 0 ? focusIndex : null, completed: completedMask },
    })
  }, [grid, palette, vp, size, dpr, geom, bitmap, focusIndex, completedMask, version])

  /** 全色总进度：用已经算好的区域表，不再重复扫全图。没有可拼内容时返回 null */
  const overall = useMemo(() => {
    let total = 0
    let done = 0
    for (let index = 0; index < palette.colors.length; index++) {
      const list = allRegions.byColor[index]
      if (!list) continue
      const finished = new Set(making.completedRegions[palette.colors[index].code] ?? [])
      for (const region of list) {
        total += region.size
        if (finished.has(region.id)) done += region.size
      }
    }
    return total === 0 ? null : done / total
  }, [allRegions, palette, making])

  const recommend = () => {
    const next = recommendRegion(regions, completed, strategy, lastPoint)
    if (!next) return
    setVp((current) =>
      fitViewportToRegion(current, next.bbox, size.width, size.height, grid.cols, grid.rows),
    )
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-3 py-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-neutral-500">{copy.colors}</h3>
          <p className="mt-1 text-xs text-neutral-500">
            {overall === null
              ? copy.empty
              : `${copy.overallProgress} ${(overall * 100).toFixed(1)}%`}
          </p>
          <details className="mt-1 text-[11px] text-neutral-500">
            <summary className="cursor-pointer select-none">{copy.whatIsIt}</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>{copy.howto1}</li>
              <li>{copy.howto2}</li>
              <li>{copy.howto3}</li>
              <li>{copy.howto4}</li>
            </ol>
          </details>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-200">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${(overall ?? 0) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 p-2">
          {palette.colors.map((color, index) => {
            const list = allRegions.byColor[index]
            if (!list || usage[index] === 0) return null
            // 区域表已经有了，这里只是数数，不再重算
            const finished = making.completedRegions[color.code]
            let total = 0
            let done = 0
            for (const region of list) {
              total += region.size
              if (finished?.includes(region.id)) done += region.size
            }
            const complete = isColorComplete(list, new Set(finished ?? []))
            return (
              <button
                key={color.code}
                type="button"
                onClick={() => setFocusCode(color.code)}
                className={`flex items-center gap-2 rounded border px-2 py-1 text-left text-xs ${
                  focusCode === color.code
                    ? 'border-neutral-900 ring-1 ring-neutral-900'
                    : 'border-neutral-200'
                }`}
              >
                <span
                  className="h-4 w-4 shrink-0 rounded border border-neutral-300"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="w-14 shrink-0 font-mono">{color.code}</span>
                <span className="tabular-nums text-neutral-500">
                  {total - done}/{total}
                </span>
                {complete && <span className="ml-auto text-emerald-600">✓</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 text-xs">
          <span className="font-mono">{focusCode ?? copy.pickColor}</span>
          {focusCode && (
            <span className="tabular-nums text-neutral-500">
              {copy.remaining} {progress.total - progress.done} {copy.beads} · {progress.regionsLeft}/
              {progress.regionsTotal} {copy.regions}
            </span>
          )}
          <select
            className="rounded border border-neutral-300 bg-white px-2 py-1"
            value={strategy}
            onChange={(e) => a.setRecommendStrategy(e.target.value as never)}
          >
            {STRATEGIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <Btn onClick={recommend} disabled={!focusCode || progress.regionsLeft === 0}>
            {copy.recommend}
          </Btn>
          <Btn
            onClick={() => {
              if (focusCode) {
                for (const region of regions) {
                  if (!completed.has(region.id)) a.toggleRegion(focusCode, region.id)
                }
              }
            }}
            disabled={!focusCode || progress.regionsLeft === 0}
          >
            {copy.markAll}
          </Btn>
          <Btn
            onClick={() => {
              a.resetMaking()
              // 本地焦点和上次落点也要跟着清，否则重置后还停在上个色号上
              setFocusCode(null)
              setLastPoint(null)
            }}
            disabled={overall === null}
          >
            {copy.reset}
          </Btn>
          <Btn
            disabled={overall === null}
            onClick={() => {
              const el = wrapRef.current?.parentElement
              if (!document.fullscreenElement) void el?.requestFullscreen?.()
              else void document.exitFullscreen?.()
            }}
          >
            {copy.fullscreen}
          </Btn>
        </div>

        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
          {!focusCode && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
              <p className="inline-block rounded bg-neutral-900/80 px-4 py-2 text-sm text-white">
                {copy.pickColor}
              </p>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="absolute left-0 top-0 touch-none"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              downRef.current = { x: e.clientX, y: e.clientY }
              const cell = screenToCell(vp, e.clientX - rect.left, e.clientY - rect.top)
              if (focusCode && e.button === 0) {
                const region = findRegionAt(regions, cell.row * grid.cols + cell.col)
                if (region) {
                  a.toggleRegion(focusCode, region.id)
                  setLastPoint({ col: cell.col, row: cell.row })
                  // 点到区域 = 标记完成，不进入平移；轻微手抖也不会把视口挪走
                  downRef.current = null
                }
              }
            }}
            onPointerMove={(e) => {
              const down = downRef.current
              if (!down) return
              if (!panRef.current) {
                if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) return
                panRef.current = { x: e.clientX, y: e.clientY }
                return
              }
              const dx = e.clientX - panRef.current.x
              const dy = e.clientY - panRef.current.y
              panRef.current = { x: e.clientX, y: e.clientY }
              setVp((current) =>
                clampViewport(panBy(current, dx, dy), grid.cols, grid.rows, size.width, size.height),
              )
            }}
            onPointerUp={() => {
              downRef.current = null
              panRef.current = null
            }}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
    </div>
  )
}
