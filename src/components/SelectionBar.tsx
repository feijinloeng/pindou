import { t } from '../i18n/zh'
import { MOTION, usePresence } from '../motion'
import { selectionBBox } from '../editor/selection'
import { useEditor } from '../editor/store'
import { cellToScreen } from '../render/canvasViewport'
import { Z } from './overlayState'
import { Btn } from './ui'

/**
 * 选区操作条：只在有选区时出现，跟在选区外接框的下方。
 * 只保留填色、清除、复制三个高频操作；点击选区外或按 Escape 收起。
 */
export default function SelectionBar() {
  const selection = useEditor((s) => s.selection)
  const colorIndex = useEditor((s) => s.colorIndex)
  const vp = useEditor((s) => s.vp)
  const copy = t('editor')
  // 动作是稳定引用，不需要订阅（订阅了反而每笔拖拽都重渲染整条栏）
  const a = useEditor.getState()

  const open = selection.length > 0
  const box = selectionBBox(selection)
  const position = box
    ? (() => {
        const topLeft = cellToScreen(vp, box.c0, box.r0)
        const bottomRight = cellToScreen(vp, box.c1 + 1, box.r1 + 1)
        return {
          centerX: (topLeft.x + bottomRight.x) / 2,
          bottomY: bottomRight.y,
        }
      })()
    : { centerX: 0, bottomY: 0 }
  const { ref, shown, exiting } = usePresence(open, {
    from: { opacity: 0, y: 6 },
    to: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 6 },
    enterDuration: MOTION.contextual,
    exitDuration: 0.12,
  })

  if (!shown) return null

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={copy.selection}
      style={{
        zIndex: Z.controls,
        left: `clamp(96px, ${position.centerX}px, calc(100% - 96px))`,
        top: `${position.bottomY + 8}px`,
      }}
      className={`absolute flex items-center gap-1 rounded-xl border border-line bg-surface px-1.5 py-1 shadow-md ${
        exiting ? 'pointer-events-none' : ''
      }`}
    >
      <Btn onClick={() => a.fillSel(colorIndex)} title={copy.fill}>
        {copy.selFill}
      </Btn>
      <Btn onClick={a.eraseSel}>{copy.erase}</Btn>
      <Btn onClick={a.copySel}>{copy.copy}</Btn>
    </div>
  )
}
