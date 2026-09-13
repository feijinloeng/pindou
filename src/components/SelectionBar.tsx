import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'
import { Btn, Dropdown, MenuItem } from './ui'

/**
 * 选区操作条：只在真有选区时出现在画布上沿，esc / 取消选区后就消失。
 * 剪切、粘贴、反选、整图位移这些低频动作收在「更多」里。
 */
export default function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const clipboard = useEditor((s) => s.clipboard)
  const colorIndex = useEditor((s) => s.colorIndex)
  const copy = t('editor')
  // 动作是稳定引用，不需要订阅（订阅了反而每笔拖拽都重渲染整条栏）
  const a = useEditor.getState()

  if (selection.length === 0) return null

  return (
    <div
      role="toolbar"
      aria-label={copy.selection}
      className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-neutral-300 bg-white/95 px-1.5 py-1 shadow"
    >
      <span className="px-1 text-[11px] text-neutral-500">{selection.length} 个矩形</span>
      <Btn onClick={() => a.fillSel(colorIndex)} title="把选区填成当前色号">
        {copy.selFill}
      </Btn>
      <Btn onClick={a.copySel}>{copy.copy}</Btn>
      <Btn onClick={a.eraseSel}>{copy.erase}</Btn>
      <Dropdown label={copy.selTransform} width="w-40">
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
      </Dropdown>
      <Dropdown label={copy.selMore} width="w-44">
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
            <MenuItem
              onClick={() => {
                a.clearSel()
                close()
              }}
            >
              {copy.selCancel}
            </MenuItem>
          </>
        )}
      </Dropdown>
      <button
        type="button"
        onClick={a.clearSel}
        aria-label={copy.selCancel}
        title={copy.selCancel}
        className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs text-neutral-500 hover:bg-neutral-100"
      >
        ✕
      </button>
    </div>
  )
}
