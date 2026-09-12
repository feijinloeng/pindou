import { useEffect } from 'react'

import { startAutosave } from '../storage/autosave'

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState()
      // 还在选板：快捷键一律不响应
      if (s.pickerOpen) return
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

  // 编辑自动保存（debounce 2 秒），跟做进度立刻写
  useEffect(() => startAutosave(), [])

  // 刷新回来时把上次的草稿捡回来（第 14.1 节：编辑到一半刷新不丢）
  useEffect(() => {
    const state = useEditor.getState()
    if (state.projectId === 'local-draft') void state.restoreLast()
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
        <Locked when={pickerOpen} onBlocked={() => setNotice(t('picker').blocked)}>
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
            <ConvertPanel />
            <ColorList />
          </aside>
        </Locked>

        <div className="relative min-w-0 flex-1">
          {pickerOpen ? <BoardPicker /> : <CanvasStage />}
          {notice && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-neutral-900/85 px-3 py-1.5 text-xs text-white">
              {notice}
            </div>
          )}
        </div>

        <Locked when={pickerOpen} onBlocked={() => setNotice(t('picker').blocked)}>
          <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-neutral-200 bg-white">
            <ExportPanel />
            <SelPanel />
          </aside>
        </Locked>
      </div>
    </div>
  )
}
