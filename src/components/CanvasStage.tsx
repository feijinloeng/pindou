import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BOARD_PROFILES, type BoardTypeId } from '../domain/board'
import { EMPTY } from '../domain/grid'
import { useEditor } from '../editor/store'
import { shouldHandleCanvasKey } from '../editor/keyboard'
import {
  cellToScreen,
  clampViewport,
  panBy,
  screenToCell,
  zoomFromWheel,
  type Viewport,
} from '../render/canvasViewport'
import { BOARD_BG, drawCursorBox, drawPattern, fillCellRect } from '../render/drawPattern'
import { GridBitmap } from '../render/gridBitmap'
import ToolDock from './ToolRail'

export default function CanvasStage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const commitRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const bitmap = useMemo(() => new GridBitmap(), [])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null)
  /** 键盘光标：方向键移动，Enter 应用当前工具 */
  const [kbCell, setKbCell] = useState<{ col: number; row: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ x: number; y: number } | null>(null)
  const boardDragRef = useRef<{ index: number; colOffset: number; rowOffset: number } | null>(null)
  const spaceRef = useRef(false)

  const projectId = useEditor((s) => s.projectId)
  const grid = useEditor((s) => s.grid)
  const palette = useEditor((s) => s.palette)
  const geom = useEditor((s) => s.geom)
  const vp = useEditor((s) => s.vp)
  const commitVersion = useEditor((s) => s.commitVersion)
  const version = useEditor((s) => s.version)
  const showCodes = useEditor((s) => s.showCodes)
  const tool = useEditor((s) => s.tool)
  const selection = useEditor((s) => s.selection)
  const panel = useEditor((s) => s.panel)
  const stage = useEditor((s) => s.stage)
  const setVp = useEditor((s) => s.setVp)
  const fitTo = useEditor((s) => s.fitTo)
  const addBoard = useEditor((s) => s.addBoard)

  const [dpr, setDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  )

  // 换屏幕 / 改系统缩放时跟着变（初始值在 useState 里就直接拿到了，不用先渲染再修正）
  useEffect(() => {
    const update = () => setDpr(Math.min(window.devicePixelRatio || 1, 2))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
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

  // 只在新工程、第一次放板或重新变空时自动居中；后续拖入板块不重置用户视口。
  const layoutKey = useMemo(
    () => geom.boards.map((b) => `${b.c0},${b.r0},${b.cw},${b.rh}`).join('|'),
    [geom],
  )
  const fittedRef = useRef('')
  const previousProjectIdRef = useRef('')
  const previousBoardCountRef = useRef<number | null>(null)
  useEffect(() => {
    if (!size.width || !size.height) return
    const key = `${projectId}:${geom.cols}x${geom.rows}#${layoutKey}`
    if (fittedRef.current === key) return
    const shouldFit =
      fittedRef.current === '' || previousProjectIdRef.current !== projectId || previousBoardCountRef.current === 0
    fittedRef.current = key
    previousProjectIdRef.current = projectId
    previousBoardCountRef.current = geom.boards.length
    if (shouldFit) fitTo(size.width, size.height, dpr)
  }, [projectId, geom, layoutKey, size, dpr, fitTo])

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
        // 屏幕上的板框用中性色（spec 5.4）：红色那圈太警报。导出文档有自己的常量，不受影响
        seamColor: '#8B9691',
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
    const hasContent =
      s.geom.boards.length > 0 || Boolean(s.pending?.size) || s.grid.cells.some((value) => value !== EMPTY)
    if (!hasContent) return
    if (s.pending?.size) {
      for (const [i, v] of s.pending) {
        const col = i % s.grid.cols
        const row = (i - col) / s.grid.cols
        fillCellRect(ctx, s.vp, col, row, s.palette.colors[v]?.hex ?? BOARD_BG)
      }
    }
    if (tool !== 'pan') {
      const activeCursor = cursor ?? kbCell
      if (activeCursor) drawCursorBox(ctx, s.vp, activeCursor.col, activeCursor.row)
    }
  }, [cursor, kbCell, dpr, tool])

  useEffect(() => {
    drawOverlay()
  }, [drawOverlay, version])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // 在输入框里打空格不该开启"空格拖画布"
      if (!shouldHandleCanvasKey(e)) return
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

  /** 键盘光标移到可视区外就跟着推视口，不然光标跑到看不见的地方了 */
  const scrollToCell = (cell: { col: number; row: number }) => {
    const s = useEditor.getState()
    const point = cellToScreen(s.vp, cell.col, cell.row)
    const pad = s.vp.zoom * 2
    let dx = 0
    let dy = 0
    if (point.x < 0) dx = -point.x + pad
    if (point.y < 0) dy = -point.y + pad
    if (point.x + s.vp.zoom > size.width) dx = size.width - point.x - s.vp.zoom - pad
    if (point.y + s.vp.zoom > size.height) dy = size.height - point.y - s.vp.zoom - pad
    if (!dx && !dy) return
    s.setVp(clampViewport(panBy(s.vp, dx, dy), s.grid.cols, s.grid.rows, size.width, size.height))
  }

  const moveKbCursor = (dc: number, dr: number) => {
    const s = useEditor.getState()
    const from = kbCell ?? screenToCell(s.vp, size.width / 2, size.height / 2)
    const next = {
      col: Math.min(s.grid.cols - 1, Math.max(0, from.col + dc)),
      row: Math.min(s.grid.rows - 1, Math.max(0, from.row + dr)),
    }
    setKbCell(next)
    scrollToCell(next)
  }

  const kbIndex = kbCell ? kbCell.row * grid.cols + kbCell.col : -1
  const kbValue = kbIndex >= 0 ? grid.cells[kbIndex] : null
  const kbCode =
    kbValue === null || kbValue === 0xffff ? null : (palette.colors[kbValue]?.code ?? null)
  const boardAtCell = (cell: { col: number; row: number }) => {
    for (let i = geom.boards.length - 1; i >= 0; i--) {
      const board = geom.boards[i]
      if (
        cell.col >= board.c0 &&
        cell.col < board.c0 + board.cw &&
        cell.row >= board.r0 &&
        cell.row < board.r0 + board.rh
      ) {
        return board.index
      }
    }
    return -1
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none overflow-hidden overscroll-none"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/pindou-board')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        const board = e.dataTransfer.getData('text/pindou-board') as BoardTypeId
        if (!board || !BOARD_PROFILES[board]) return
        e.preventDefault()
        const { x, y } = localPoint(e)
        const center = screenToCell(vp, x, y)
        const size = BOARD_PROFILES[board].pegs
        const failure = addBoard(
          board,
          center.col - Math.floor(size / 2),
          center.row - Math.floor(size / 2),
        )
        if (failure) useEditor.getState().setNotice(failure, 'error')
      }}
    >
      <canvas
        ref={commitRef}
        className={`absolute left-0 top-0 ${panel === 'library' ? 'invisible' : ''}`}
      />
      <canvas
        ref={overlayRef}
        className={`absolute left-0 top-0 touch-none ${
          tool === 'pan' ? (panning ? 'cursor-grabbing' : 'cursor-grab') : panel === 'boards' ? 'cursor-move' : ''
        } ${panel === 'library' ? 'invisible' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="豆格画布：方向键移动光标，Enter 应用当前工具"
        aria-describedby="canvas-help"
        onKeyDown={(e) => {
          if (!shouldHandleCanvasKey(e)) return
          const step = e.shiftKey ? 5 : 1
          if (e.key === 'ArrowLeft') moveKbCursor(-step, 0)
          else if (e.key === 'ArrowRight') moveKbCursor(step, 0)
          else if (e.key === 'ArrowUp') moveKbCursor(0, -step)
          else if (e.key === 'ArrowDown') moveKbCursor(0, step)
          else if (e.key === 'Enter') {
            const s = useEditor.getState()
            const at = kbCell ?? screenToCell(s.vp, size.width / 2, size.height / 2)
            s.pointerDown(at.col, at.row, 0, false)
            s.pointerUp()
          } else return
          e.preventDefault()
        }}
        onFocus={() => {
          if (kbCell) return
          const s = useEditor.getState()
          setKbCell(screenToCell(s.vp, size.width / 2, size.height / 2))
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const { x, y } = localPoint(e)
          const cell = screenToCell(vp, x, y)
          e.currentTarget.setPointerCapture(e.pointerId)
          if (e.button === 1 || spaceRef.current || (tool === 'pan' && e.button === 0)) {
            panRef.current = { x: e.clientX, y: e.clientY }
            setPanning(true)
            return
          }
          const state = useEditor.getState()
          if (e.button === 0 && state.panel === 'boards') {
            const index = boardAtCell(cell)
            const placement = index >= 0 ? state.layout.placements[index] : null
            if (placement) {
              boardDragRef.current = {
                index,
                colOffset: cell.col - placement.col,
                rowOffset: cell.row - placement.row,
              }
              return
            }
          }
          state.pointerDown(cell.col, cell.row, e.button, e.shiftKey)
        }}
        onPointerMove={(e) => {
          const { x, y } = localPoint(e)
          const cell = screenToCell(vp, x, y)
          setCursor(tool === 'pan' ? null : cell)
          if (boardDragRef.current) {
            const state = useEditor.getState()
            const current = screenToCell(state.vp, x, y)
            const failure = state.moveBoard(
              boardDragRef.current.index,
              current.col - boardDragRef.current.colOffset,
              current.row - boardDragRef.current.rowOffset,
            )
            if (failure) state.setNotice(failure, 'error')
            return
          }
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
          setPanning(false)
          boardDragRef.current = null
          useEditor.getState().pointerUp()
        }}
        onPointerLeave={() => {
          panRef.current = null
          setPanning(false)
          boardDragRef.current = null
          setCursor(null)
          useEditor.getState().pointerUp()
        }}
        onPointerCancel={() => {
          panRef.current = null
          setPanning(false)
          boardDragRef.current = null
          useEditor.getState().pointerUp()
        }}
      />
      {stage !== 'export' && <ToolDock />}
      <p id="canvas-help" className="sr-only">
        方向键移动光标，按住 Shift 加方向键一次跳 5 格，Enter 把当前工具用在光标那一格上。
        Cmd 或 Ctrl 加 Z 撤销，V/B/E/I/G/M/H 切换工具。打开画板面板后可拖动板块微调位置。
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {kbCell
          ? `第 ${kbCell.row + 1} 行 第 ${kbCell.col + 1} 列，${kbCode ? `色号 ${kbCode}` : '空格'}`
          : '画布未聚焦'}
      </div>
    </div>
  )
}
