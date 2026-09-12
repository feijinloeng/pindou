import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useEditor } from '../editor/store'
import {
  CODE_ZOOM,
  clampViewport,
  panBy,
  screenToCell,
  zoomFromWheel,
  type Viewport,
} from '../render/canvasViewport'
import { BOARD_BG, drawCursorBox, drawPattern, fillCellRect } from '../render/drawPattern'
import { GridBitmap } from '../render/gridBitmap'
import { setRenderer } from '../render/rendererHandle'

export default function CanvasStage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const commitRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const bitmap = useMemo(() => new GridBitmap(), [])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const spaceRef = useRef(false)

  const grid = useEditor((s) => s.grid)
  const geom = useEditor((s) => s.geom)
  const vp = useEditor((s) => s.vp)
  const commitVersion = useEditor((s) => s.commitVersion)
  const version = useEditor((s) => s.version)
  const showCodes = useEditor((s) => s.showCodes)
  const selection = useEditor((s) => s.selection)
  const setVp = useEditor((s) => s.setVp)
  const fitTo = useEditor((s) => s.fitTo)

  const [dpr, setDpr] = useState(1)

  useEffect(() => {
    setDpr(Math.min(window.devicePixelRatio || 1, 2))
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 换板阵（或第一次拿到尺寸）时自动铺满；之后由用户自己的缩放说了算
  const fittedRef = useRef('')
  useEffect(() => {
    if (!size.width || !size.height) return
    const key = `${geom.cols}x${geom.rows}`
    if (fittedRef.current === key) return
    fittedRef.current = key
    fitTo(size.width, size.height, dpr)
  }, [geom, size, dpr, fitTo])

  useEffect(() => {
    for (const c of [commitRef.current, overlayRef.current]) {
      if (!c || !size.width) continue
      c.width = Math.round(size.width * dpr)
      c.height = Math.round(size.height * dpr)
      c.style.width = `${size.width}px`
      c.style.height = `${size.height}px`
    }
  }, [size, dpr])

  /** 提交层：只在 grid 真的变了、或视图变了时重画 */
  const drawCommit = useCallback(
    (view: Viewport) => {
      const c = commitRef.current
      if (!c || !c.width) return
      const ctx = c.getContext('2d')
      if (!ctx) return
      const s = useEditor.getState()
      drawPattern(ctx, {
        grid: s.grid,
        palette: s.palette,
        // dpr 以画布实际的为准，store 里那个可能差一帧
        vp: { ...view, dpr },
        width: c.width / dpr,
        height: c.height / dpr,
        showCodes: s.showCodes,
        version: s.commitVersion,
        selection: s.selection,
        boards: s.geom.boards,
        placeable: s.grid.placeable,
        bitmap,
      })
    },
    [bitmap, dpr],
  )

  useEffect(() => {
    drawCommit(vp)
  }, [drawCommit, vp, grid, commitVersion, showCodes, selection])

  /** 覆盖层：进行中的笔画 + 光标框。拖拽时只重画这一层 */
  const drawOverlay = useCallback(() => {
    const c = overlayRef.current
    if (!c || !c.width) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const s = useEditor.getState()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (s.pending?.size) {
      for (const [i, v] of s.pending) {
        const col = i % s.grid.cols
        const row = (i - col) / s.grid.cols
        fillCellRect(ctx, s.vp, col, row, s.palette.colors[v]?.hex ?? BOARD_BG)
      }
    }
    if (cursor) drawCursorBox(ctx, s.vp, cursor.col, cursor.row)
  }, [cursor, dpr])

  useEffect(() => {
    drawOverlay()
  }, [drawOverlay, version])

  // 压测直接从这儿调绘制，不走 React 状态
  useEffect(() => {
    setRenderer({
      draw: (view) => drawCommit({ ...view, dpr }),
      size: () => ({ width: size.width, height: size.height }),
      dpr: () => dpr,
    })
    return () => setRenderer(null)
  }, [drawCommit, size, dpr])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const localPoint = (e: {
    clientX: number
    clientY: number
    currentTarget: EventTarget & HTMLElement
  }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /**
   * 缩放必须只作用于画布，不能带着整个页面一起缩。
   *
   * React 的 onWheel 是 passive 的（preventDefault 无效），所以手挂原生监听：
   *  - Chrome/Edge：触控板捏合 = 带 ctrlKey 的 wheel
   *  - Safari：捏合走非标准的 gesture 事件
   *  - macOS 上 Cmd+滚轮也可能带 metaKey
   *
   * 挂在 document 上是因为"在右侧色号表上捏合"也应该缩画布，而不是缩整个网页；
   * 但面板上的普通滚轮要留给面板自己滚。
   */
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const wrapper = wrapRef.current

    const zoomBy = (deltaY: number, pinch: boolean, x: number, y: number) => {
      const s = useEditor.getState()
      const next = zoomFromWheel(s.vp, deltaY, pinch, x, y)
      s.setVp(clampViewport(next, s.grid.cols, s.grid.rows, size.width, size.height))
    }
    /** 画布外的捏合锚在画布中心，画布内的锚在光标那一点 */
    const point = (clientX: number | undefined, clientY: number | undefined, inside: boolean) => {
      const rect = el.getBoundingClientRect()
      if (!inside) return { x: rect.width / 2, y: rect.height / 2 }
      return { x: (clientX ?? 0) - rect.left, y: (clientY ?? 0) - rect.top }
    }

    const onWheel = (e: WheelEvent) => {
      const inside = wrapper ? wrapper.contains(e.target as Node) : false
      const pinch = e.ctrlKey || e.metaKey
      if (!inside && !pinch) return // 面板上的普通滚轮：让面板滚
      e.preventDefault()
      const { x, y } = point(e.clientX, e.clientY, inside)
      zoomBy(e.deltaY, pinch, x, y)
    }

    let gestureScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number }
      const scale = g.scale ?? 1
      const deltaY = -Math.log(scale / gestureScale) / 0.01
      gestureScale = scale
      const inside = wrapper ? wrapper.contains(g.target as Node) : false
      const { x, y } = point(g.clientX, g.clientY, inside)
      zoomBy(deltaY, true, x, y)
    }
    const onGestureEnd = (e: Event) => e.preventDefault()

    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('gesturestart', onGestureStart)
    document.addEventListener('gesturechange', onGestureChange)
    document.addEventListener('gestureend', onGestureEnd)
    return () => {
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('gesturestart', onGestureStart)
      document.removeEventListener('gesturechange', onGestureChange)
      document.removeEventListener('gestureend', onGestureEnd)
    }
  }, [size.width, size.height])

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none overflow-hidden overscroll-none">
      <canvas ref={commitRef} className="absolute left-0 top-0" />
      <canvas
        ref={overlayRef}
        className="absolute left-0 top-0 touch-none"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const { x, y } = localPoint(e)
          const cell = screenToCell(vp, x, y)
          e.currentTarget.setPointerCapture(e.pointerId)
          if (e.button === 1 || spaceRef.current) {
            panRef.current = { x: e.clientX, y: e.clientY }
            return
          }
          useEditor.getState().pointerDown(cell.col, cell.row, e.button, e.shiftKey)
        }}
        onPointerMove={(e) => {
          const { x, y } = localPoint(e)
          const cell = screenToCell(vp, x, y)
          setCursor(cell)
          if (panRef.current) {
            const dx = e.clientX - panRef.current.x
            const dy = e.clientY - panRef.current.y
            panRef.current = { x: e.clientX, y: e.clientY }
            setVp(clampViewport(panBy(vp, dx, dy), grid.cols, grid.rows, size.width, size.height))
            return
          }
          useEditor.getState().pointerMove(cell.col, cell.row)
        }}
        onPointerUp={() => {
          panRef.current = null
          useEditor.getState().pointerUp()
        }}
        onPointerLeave={() => {
          panRef.current = null
          setCursor(null)
          useEditor.getState().pointerUp()
        }}
      />
      <div className="pointer-events-none absolute right-3 bottom-3 rounded bg-white/80 px-2 py-1 text-xs tabular-nums text-neutral-600">
        {vp.zoom >= CODE_ZOOM ? '100%+ 色号' : `${Math.round(vp.zoom * 100)}%`}
      </div>
    </div>
  )
}
