import { useEffect, useRef } from 'react'

import { shouldHandleCanvasKey } from '../editor/keyboard'
import { escapeTopmost, hasOverlay } from '../components/overlayState'

import BoardPicker from './BoardPicker'
import CanvasStage from '../components/CanvasStage'
import ExportStage from '../components/ExportStage'
import NoticeHost from '../components/NoticeHost'
import PanelHost from '../components/PanelHost'
import SelectionBar from '../components/SelectionBar'
import ToolDock from '../components/ToolRail'
import Toolbar from '../components/Toolbar'
import WorkspaceControls from '../components/WorkspaceControls'
import { useEditor, type ToolId } from '../editor/store'
import { useUi } from '../editor/uiState'
import { gsap, MOTION, reducedMotion, useGSAP } from '../motion'

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  b: 'pencil',
  e: 'eraser',
  i: 'picker',
  g: 'bucket',
  m: 'rect',
}

export default function Editor() {
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const stage = useEditor((s) => s.stage)
  const focusMode = useUi((s) => s.focusMode)
  const editing = !pickerOpen && stage === 'edit'
  const rootRef = useRef<HTMLDivElement>(null)

  // 首次编辑器显示：头 180ms、画布 220ms、dock 240ms，总时长不超 400ms。
  useGSAP(() => {
    if (reducedMotion()) return
    const tl = gsap.timeline()
    tl.from('.editor-header', { opacity: 0, duration: 0.18, ease: MOTION.easeOut })
      .from('.canvas-layer', { opacity: 0, duration: 0.22, ease: MOTION.easeOut }, '<0.02')
      .from('.tool-dock', { opacity: 0, y: 8, duration: 0.24, ease: MOTION.easeOut }, '<0.04')
  }, { scope: rootRef })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 正在输入框/下拉框里打字，或输入法正在组合：快捷键让路，别抢 V/B/E/I/G/M、Cmd+A、Cmd+C
      if (!shouldHandleCanvasKey(e)) return
      const s = useEditor.getState()
      // 选板页和导出页不是画布：除了 Escape，快捷键一律不响应
      if ((s.pickerOpen || s.stage === 'export') && e.key !== 'Escape') return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        // 一次只退一层：浮层栈顶 → 面板 → 选区 → 专注模式
        if (escapeTopmost()) return
        if (s.panel) s.openPanel(null)
        else if (s.selection.length) s.clearSel()
        else if (useUi.getState().focusMode) useUi.getState().setFocusMode(false)
        return
      }
      // 菜单/对话框开着的时候，字母键是浮层的，不是画布的
      if (hasOverlay()) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.selectAll()
        return
      }
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        s.copySel()
        return
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault()
        s.cutSel()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        s.pasteSel()
        return
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool && !mod) s.setTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-workspace text-ink">
      {/* 专注模式：头部高度保留（不跳布局），内容淡出融进工作区 */}
      <div
        className={`editor-header shrink-0 transition-opacity ${focusMode ? 'pointer-events-none opacity-0' : ''}`}
      >
        <Toolbar />
      </div>

      <div className="relative min-h-0 flex-1">
        {/* 画布常驻：导出/选板只是盖在它上面，回来视口、工具、选区都还是原来那一眼 */}
        <div
          className={`canvas-layer absolute inset-0 ${editing ? '' : 'pointer-events-none invisible'}`}
          aria-hidden={!editing}
        >
          <CanvasStage />
        </div>

        {pickerOpen ? (
          <div className="absolute inset-0 flex flex-col bg-workspace">
            <BoardPicker />
          </div>
        ) : stage === 'export' ? (
          <div className="absolute inset-0 flex flex-col bg-workspace">
            <ExportStage />
          </div>
        ) : (
          <>
            <WorkspaceControls />
            {!focusMode && <SelectionBar />}
            {!focusMode && <PanelHost />}
            <ToolDock />
          </>
        )}

        {/* 通知挂在所有子状态之上：导出失败、转换完成在哪个页面都看得见 */}
        <NoticeHost />
      </div>
    </div>
  )
}
