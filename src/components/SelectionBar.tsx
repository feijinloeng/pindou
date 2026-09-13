import { X } from '@phosphor-icons/react'

import { t } from '../i18n/zh'
import { MOTION, usePresence } from '../motion'
import { useEditor } from '../editor/store'
import { Z } from './overlayState'
import { Btn, Menu, MenuItem } from './ui'

/**
 * 选区操作条（spec 5.8）：只在有选区时出现，位于启动器那行之下、画布中央。
 * 填色/复制/清除/变换/更多/取消；剪切、粘贴、反选、全选收在「更多」里。
 */
export default function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const clipboard = useEditor((s) => s.clipboard)
  const colorIndex = useEditor((s) => s.colorIndex)
  const copy = t('editor')
  // 动作是稳定引用，不需要订阅（订阅了反而每笔拖拽都重渲染整条栏）
  const a = useEditor.getState()

  const open = selection.length > 0
  const { ref, shown, exiting } = usePresence(open, {
    from: { opacity: 0, y: -6 },
    to: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    enterDuration: MOTION.contextual,
    exitDuration: 0.12,
  })

  if (!shown) return null

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={copy.selection}
      style={{ zIndex: Z.controls }}
      className={`absolute top-16 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-surface px-1.5 py-1 shadow-md ${
        exiting ? 'pointer-events-none' : ''
      }`}
    >
      <span className="px-1 text-xs text-ink-2 tabular">{copy.selCount(selection.length)}</span>
      <Btn onClick={() => a.fillSel(colorIndex)} title={copy.fill}>
        {copy.selFill}
      </Btn>
      <Btn onClick={a.copySel}>{copy.copy}</Btn>
      <Btn onClick={a.eraseSel}>{copy.erase}</Btn>
      <Menu label={copy.selTransform} width="w-44" triggerVariant="ghost">
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                a.mirror('h')
                close()
              }}
            >
              {copy.mirrorH}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.mirror('v')
                close()
              }}
            >
              {copy.mirrorV}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.rotate(1)
                close()
              }}
            >
              {copy.rotateCw}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.rotate(-1)
                close()
              }}
            >
              {copy.rotateCcw}
            </MenuItem>
          </>
        )}
      </Menu>
      <Menu label={copy.selMore} width="w-44" triggerVariant="ghost">
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                a.cutSel()
                close()
              }}
            >
              {copy.cut}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.pasteSel()
                close()
              }}
              disabled={!clipboard}
            >
              {copy.paste}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.invertSel()
                close()
              }}
              disabled={selection.length !== 1}
            >
              {copy.selInvert}
            </MenuItem>
            <MenuItem
              onClick={() => {
                a.selectAll()
                close()
              }}
            >
              {copy.selSelectAll}
            </MenuItem>
          </>
        )}
      </Menu>
      <button
        type="button"
        onClick={a.clearSel}
        aria-label={copy.selCancel}
        title={copy.selCancel}
        className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}
