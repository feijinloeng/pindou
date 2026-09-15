import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  boardGuide,
  boardPlacementOverlapsOthers,
  BOARD_PROFILES,
  type BoardPlacement,
  type BoardTypeId,
} from '../domain/board'
import { EMPTY } from '../domain/grid'
import { selectionContains } from '../editor/selection'
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
import { BOARD_BG, BOARD_GUIDE_COLOR } from '../render/colors'
import { drawCursorBox, drawPattern, fillCellRect } from '../render/drawPattern'
import { GridBitmap } from '../render/gridBitmap'
import ToolDock from './ToolRail'

type BoardDragState = {
  /** null means a new board is being dragged in from the model list. */
  index: number | null
  board: BoardTypeId
  origin: BoardPlacement | null
  colOffset: number
  rowOffset: number
  col: number
  row: number
  invalid: boolean
}

/** Draw only the temporary board footprint; the committed canvas stays untouched during drag. */
function drawBoardPreview(
  ctx: CanvasRenderingContext2D,
  drag: BoardDragState,
  vp: Viewport,
): void {
  const pegs = BOARD_PROFILES[drag.board].pegs
  const x = (col: number) => vp.panX + col * vp.zoom
  const y = (row: number) => vp.panY + row * vp.zoom
  const drawRect = (placement: BoardPlacement) => {
    ctx.fillRect(x(placement.col), y(placement.row), pegs * vp.zoom, pegs * vp.zoom)
  }

  ctx.save()
  if (drag.origin) {
    // Hide the old footprint while it is being moved. The real pattern is redrawn on release.
    ctx.fillStyle = BOARD_BG
    drawRect(drag.origin)
  }

  ctx.fillStyle = drag.invalid ? 'rgba(180, 67, 58, 0.18)' : 'rgba(45, 98, 75, 0.16)'
  drawRect({ board: drag.board, col: drag.col, row: drag.row })
  ctx.strokeStyle = drag.invalid ? '#b4433a' : '#2d624b'
  ctx.lineWidth = 2
  ctx.setLineDash(drag.invalid ? [6, 4] : [5, 4])
  ctx.strokeRect(x(drag.col), y(drag.row), pegs * vp.zoom, pegs * vp.zoom)

  const guide = boardGuide({ board: drag.board, c0: drag.col, r0: drag.row })
  if (guide) {
    ctx.strokeStyle = BOARD_GUIDE_COLOR
    ctx.lineWidth = 1
    ctx.setLineDash([])
    for (const col of guide.solidCols) {
      ctx.beginPath()
      ctx.moveTo(x(col), y(guide.top))
      ctx.lineTo(x(col), y(guide.bottom))
      ctx.stroke()
    }
    for (const row of guide.solidRows) {
      ctx.beginPath()
      ctx.moveTo(x(guide.left), y(row))
      ctx.lineTo(x(guide.right), y(row))
      ctx.stroke()
    }
    ctx.setLineDash([4, 3])
    for (const col of guide.dashedCols) {
      ctx.beginPath()
      ctx.moveTo(x(col), y(guide.top))
      ctx.lineTo(x(col), y(guide.bottom))
      ctx.stroke()
    }
    for (const row of guide.dashedRows) {
      ctx.beginPath()
      ctx.moveTo(x(guide.left), y(row))
      ctx.lineTo(x(guide.right), y(row))
      ctx.stroke()
    }
  }
  ctx.restore()
}

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
  const boardDragRef = useRef<BoardDragState | null>(null)
  const activeBoardRef = useRef<number | null>(null)
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
    const boardDrag = boardDragRef.current
    if (boardDrag) {
      drawBoardPreview(ctx, boardDrag, s.vp)
      return
    }
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
   * 只挂在画布覆盖层上：画布滚轮可以缩放，面板和浏览器页面缩放保留原生行为。
   */
  useEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const zoomBy = (deltaY: number, pinch: boolean, x: number, y: number) => {
      const s = useEditor.getState()
      const next = zoomFromWheel(s.vp, deltaY, pinch, x, y)
      s.setVp(clampViewport(next, s.grid.cols, s.grid.rows, size.width, size.height))
    }
    /** 缩放锚在光标那一点 */
    const point = (clientX: number | undefined, clientY: number | undefined) => {
      const rect = el.getBoundingClientRect()
      return { x: (clientX ?? 0) - rect.left, y: (clientY ?? 0) - rect.top }
    }

    const onWheel = (e: WheelEvent) => {
      // 监听只挂在画布上，面板和浏览器页面缩放不被拦截。
      e.preventDefault()
      const { x, y } = point(e.clientX, e.clientY)
      zoomBy(e.deltaY, e.ctrlKey || e.metaKey, x, y)
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
      const { x, y } = point(g.clientX, g.clientY)
      zoomBy(deltaY, true, x, y)
    }
    const onGestureEnd = (e: Event) => e.preventDefault()

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
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

  /** Add only on an explicit click/drop. The layout action is the single commit point. */
  const addBoardAt = (board: BoardTypeId, col: number, row: number): boolean => {
    const state = useEditor.getState()
    const failure = state.addBoard(board, col, row)
    if (failure) {
      state.setNotice(failure, 'error')
      return false
    }
    activeBoardRef.current = useEditor.getState().layout.placements.length - 1
    const next = useEditor.getState()
    if (!next.boardPinned) next.openPanel(null)
    return true
  }

  const moveActiveBoard = (dc: number, dr: number): boolean => {
    const index = activeBoardRef.current
    if (index === null) return false
    const state = useEditor.getState()
    const placement = state.layout.placements[index]
    if (!placement) {
      activeBoardRef.current = null
      return false
    }
    const failure = state.moveBoard(index, placement.col + dc, placement.row + dr)
    if (failure) state.setNotice(failure, 'error')
    return true
  }

  const updateNewBoardPreview = (
    board: BoardTypeId,
    x: number,
    y: number,
  ): void => {
    const state = useEditor.getState()
    const pegs = BOARD_PROFILES[board].pegs
    const center = screenToCell(state.vp, x, y)
    const col = center.col - Math.floor(pegs / 2)
    const row = center.row - Math.floor(pegs / 2)
    const candidate = { board, col, row }
    boardDragRef.current = {
      index: null,
      board,
      origin: null,
      colOffset: 0,
      rowOffset: 0,
      col,
      row,
      invalid: boardPlacementOverlapsOthers(state.layout.placements, -1, candidate),
    }
    drawOverlay()
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none overflow-hidden overscroll-none"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/pindou-board')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        const board = e.dataTransfer.getData('text/pindou-board') as BoardTypeId
        if (!board || !BOARD_PROFILES[board]) return
        const { x, y } = localPoint(e)
        updateNewBoardPreview(board, x, y)
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget
        if (related instanceof Node && e.currentTarget.contains(related)) return
        if (boardDragRef.current?.index === null) {
          boardDragRef.current = null
          drawOverlay()
        }
      }}
      onDrop={(e) => {
        const board = e.dataTransfer.getData('text/pindou-board') as BoardTypeId
        if (!board || !BOARD_PROFILES[board]) return
        e.preventDefault()
        const { x, y } = localPoint(e)
        const preview = boardDragRef.current
        const state = useEditor.getState()
        const pegs = BOARD_PROFILES[board].pegs
        const center = screenToCell(state.vp, x, y)
        const col = preview?.index === null && preview.board === board
          ? preview.col
          : center.col - Math.floor(pegs / 2)
        const row = preview?.index === null && preview.board === board
          ? preview.row
          : center.row - Math.floor(pegs / 2)
        boardDragRef.current = null
        drawOverlay()
        addBoardAt(board, col, row)
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
          const state = useEditor.getState()
          if (state.panel === 'boards' && activeBoardRef.current !== null) {
            const step = e.shiftKey ? 5 : 1
            if (e.key === 'ArrowLeft') moveActiveBoard(-step, 0)
            else if (e.key === 'ArrowRight') moveActiveBoard(step, 0)
            else if (e.key === 'ArrowUp') moveActiveBoard(0, -step)
            else if (e.key === 'ArrowDown') moveActiveBoard(0, step)
            else if (e.key === 'Delete' || e.key === 'Backspace') {
              const index = activeBoardRef.current
              const failure = state.removeBoard(index)
              if (failure) state.setNotice(failure, 'error')
              activeBoardRef.current = null
            } else if (e.key === 'Enter') {
              // Enter is reserved for canvas tools; it must not paint behind the board panel.
              e.preventDefault()
              return
            } else {
              // Leave letters and other shortcuts available to the editor shell.
              return
            }
            e.preventDefault()
            return
          }
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
          const state = useEditor.getState()
          const cell = screenToCell(state.vp, x, y)
          e.currentTarget.setPointerCapture(e.pointerId)

          // In board mode, a right click removes a board and an empty click adds the selected model.
          // Handle this before selection/canvas tools so the panel never accidentally paints a bead.
          if (state.panel === 'boards' && e.button === 2) {
            const index = boardAtCell(cell)
            if (index >= 0) {
              activeBoardRef.current = index
              const failure = state.removeBoard(index)
              if (failure) state.setNotice(failure, 'error')
            }
            return
          }
          if (e.button === 1 || spaceRef.current) {
            panRef.current = { x: e.clientX, y: e.clientY }
            setPanning(true)
            return
          }
          if (e.button === 0 && state.panel === 'boards') {
            const index = boardAtCell(cell)
            const placement = index >= 0 ? state.layout.placements[index] : null
            if (placement) {
              activeBoardRef.current = index
              state.setNotice(null)
              boardDragRef.current = {
                index,
                board: placement.board,
                origin: { ...placement },
                colOffset: cell.col - placement.col,
                rowOffset: cell.row - placement.row,
                col: placement.col,
                row: placement.row,
                invalid: false,
              }
              drawOverlay()
              return
            }
            if (state.tool === 'pan') {
              panRef.current = { x: e.clientX, y: e.clientY }
              setPanning(true)
              return
            }
            // 画布空白处不再直接添加板块，新增板块统一从左侧型号卡拖入。
            return
          }
          if (state.tool === 'pan' && e.button === 0) {
            panRef.current = { x: e.clientX, y: e.clientY }
            setPanning(true)
            return
          }
          if (e.button === 0 && state.selection.length && !selectionContains(state.selection, cell.col, cell.row)) {
            state.clearSel()
            // 框选工具可以在清掉旧选区的同时直接开始新的框选；其它工具先只负责收起操作条。
            if (state.tool !== 'rect') return
          }
          state.pointerDown(cell.col, cell.row, e.button, e.shiftKey)
        }}
        onPointerMove={(e) => {
          const { x, y } = localPoint(e)
          const state = useEditor.getState()
          if (boardDragRef.current) {
            const current = screenToCell(state.vp, x, y)
            const drag = boardDragRef.current
            if (drag.index !== null) {
              drag.col = current.col - drag.colOffset
              drag.row = current.row - drag.rowOffset
              drag.invalid = boardPlacementOverlapsOthers(
                state.layout.placements,
                drag.index,
                { board: drag.board, col: drag.col, row: drag.row },
              )
            } else {
              drag.col = current.col - Math.floor(BOARD_PROFILES[drag.board].pegs / 2)
              drag.row = current.row - Math.floor(BOARD_PROFILES[drag.board].pegs / 2)
              drag.invalid = boardPlacementOverlapsOthers(
                state.layout.placements,
                -1,
                { board: drag.board, col: drag.col, row: drag.row },
              )
            }
            drawOverlay()
            return
          }
          const cell = screenToCell(state.vp, x, y)
          setCursor(state.tool === 'pan' ? null : cell)
          if (panRef.current) {
            const state = useEditor.getState()
            const dx = e.clientX - panRef.current.x
            const dy = e.clientY - panRef.current.y
            panRef.current = { x: e.clientX, y: e.clientY }
            setVp(clampViewport(panBy(state.vp, dx, dy), state.grid.cols, state.grid.rows, size.width, size.height))
            return
          }
          state.pointerMove(cell.col, cell.row)
        }}
        onPointerUp={() => {
          const drag = boardDragRef.current
          boardDragRef.current = null
          drawOverlay()
          panRef.current = null
          setPanning(false)
          const state = useEditor.getState()
          if (drag?.index !== null && drag) {
            const failure = state.moveBoard(drag.index, drag.col, drag.row)
            if (failure) state.setNotice(failure, 'error')
          }
          state.pointerUp()
        }}
        onPointerLeave={() => {
          // Pointer capture keeps a board drag/pan alive outside the canvas edge.
          if (boardDragRef.current || panRef.current) return
          setCursor(null)
          useEditor.getState().pointerUp()
        }}
        onPointerCancel={() => {
          boardDragRef.current = null
          drawOverlay()
          panRef.current = null
          setPanning(false)
          useEditor.getState().pointerUp()
        }}
      />
      {stage !== 'export' && <ToolDock />}
      <p id="canvas-help" className="sr-only">
        方向键移动光标，按住 Shift 加方向键一次跳 5 格，Enter 把当前工具用在光标那一格上。
        Cmd 或 Ctrl 加 Z 撤销，B/E/I/G/M/H 切换工具。打开画板面板后，从左侧型号卡拖一块板到画布；拖动或用方向键调整选中的板块，Delete 或 Backspace 删除板块。
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {kbCell
          ? `第 ${kbCell.row + 1} 行 第 ${kbCell.col + 1} 列，${kbCode ? `色号 ${kbCode}` : '空格'}`
          : '画布未聚焦'}
      </div>
    </div>
  )
}
