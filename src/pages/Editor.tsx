import { useEffect } from 'react'

import { startAutosave } from '../storage/autosave'
import { shouldHandleCanvasKey } from '../editor/keyboard'

import ColorList from '../components/ColorList'
import ConvertPanel from '../components/ConvertPanel'
import { t } from '../i18n/zh'
import BoardPicker from './BoardPicker'
import CanvasStage from '../components/CanvasStage'
import Locked from '../components/Locked'
import ExportPanel from '../components/ExportPanel'
import SelPanel from '../components/SelPanel'
import Toolbar from '../components/Toolbar'
import { useEditor, type ToolId } from '../editor/store'

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  b: 'pencil',
  e: 'eraser',
  i: 'picker',
  g: 'bucket',
  m: 'rect',
}

export default function Editor() {
  const notice = useEditor((s) => s.notice)
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const setNotice = useEditor((s) => s.setNotice)
  const panelsOpen = useEditor((s) => s.panelsOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 正在输入框/下拉框里打字，或输入法正在组合：快捷键让路，别抢 V/B/E/I/G/M、Cmd+A、Cmd+C
      if (!shouldHandleCanvasKey(e)) return
      const s = useEditor.getState()
      // 还在选板：快捷键一律不响应（Escape 除外，见下）
      if (s.pickerOpen && e.key !== 'Escape') return
      const mod = e.metaKey || e.ctrlKey
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
      if (e.key === 'Escape') {
        s.clearSel()
        return
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool && !mod) s.setTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 编辑自动保存（debounce 2 秒），跟做进度立刻写。
  // 必须把取消订阅的函数交回去：切换页面后旧订阅还活着会重复写盘。
  useEffect(() => startAutosave(), [])

  // 刷新回来时把上次的草稿捡回来（第 14.1 节：编辑到一半刷新不丢）
  useEffect(() => {
    const state = useEditor.getState()
    const boot = state.projectId === 'local-draft' ? state.restoreLast() : Promise.resolve(false)
    // 源图只存了小图副本：捡回来是为了能重新转换，不是“原图还在”
    void boot.then(() => useEditor.getState().restoreSourceImage())
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* 没选板之前，两侧面板照旧在，只是点不动 —— 点了给一句"先选板" */}
        {panelsOpen && (
          <Locked
            when={pickerOpen}
            reason={t('picker').blocked}
            onBlocked={() => setNotice(t('picker').blocked)}
          >
            <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
              <ConvertPanel />
              <ColorList />
            </aside>
          </Locked>
        )}

        <div className="relative min-w-0 flex-1">
          {pickerOpen ? <BoardPicker /> : <CanvasStage />}
          {notice && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-neutral-900/85 px-3 py-1.5 text-xs text-white"
            >
              {notice}
            </div>
          )}
        </div>

        {panelsOpen && (
          <Locked
            when={pickerOpen}
            reason={t('picker').blocked}
            onBlocked={() => setNotice(t('picker').blocked)}
          >
            <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
              <ExportPanel />
              <SelPanel />
            </aside>
          </Locked>
        )}
      </div>
    </div>
  )
}
