import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FlipHorizontal,
  FlipVertical,
} from '@phosphor-icons/react'

import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'

/**
 * 整图变换面板（spec 5.8）：四个显式操作 + 四向平移一格。
 * 整图动作先清选区再调用已有变换命令 —— 和选区变换是两套，不混。
 */
export default function TransformPanel() {
  const geom = useEditor((s) => s.geom)
  const copy = t('editor')

  /** 整图操作：先清选区，镜像 / 旋转 / 平移才是整张图的意思 */
  const whole = (run: (state: ReturnType<typeof useEditor.getState>) => void) => {
    const state = useEditor.getState()
    state.clearSel()
    run(state)
  }

  const square = geom.cols === geom.rows

  const ops = [
    {
      icon: <ArrowClockwise size={15} aria-hidden />,
      label: copy.rotateWholeCw,
      onClick: () => whole((s) => s.rotate(1)),
    },
    {
      icon: <ArrowCounterClockwise size={15} aria-hidden />,
      label: copy.rotateWholeCcw,
      onClick: () => whole((s) => s.rotate(-1)),
    },
    {
      icon: <FlipHorizontal size={15} aria-hidden />,
      label: copy.mirrorWholeH,
      onClick: () => whole((s) => s.mirror('h')),
    },
    {
      icon: <FlipVertical size={15} aria-hidden />,
      label: copy.mirrorWholeV,
      onClick: () => whole((s) => s.mirror('v')),
    },
  ]

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-col gap-1">
        {ops.map((op) => (
          <button
            key={op.label}
            type="button"
            onClick={op.onClick}
            className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink hover:bg-hover"
          >
            {op.icon}
            {op.label}
          </button>
        ))}
      </div>

      {!square && (
        <p role="note" className="rounded-lg bg-warn-bg p-2 text-xs text-warn-ink">
          {copy.transformSquareOnly}（{t('library').cells} {geom.cols}×{geom.rows}）
        </p>
      )}

      <div>
        <p className="mb-1 text-xs text-ink-2">{copy.transformMove}</p>
        <div className="grid w-28 grid-cols-3 gap-1">
          <span />
          <MoveBtn icon={<ArrowUp size={14} aria-hidden />} label="↑" onClick={() => whole((s) => s.translate(0, -1))} />
          <span />
          <MoveBtn icon={<ArrowLeft size={14} aria-hidden />} label="←" onClick={() => whole((s) => s.translate(-1, 0))} />
          <span />
          <MoveBtn icon={<ArrowRight size={14} aria-hidden />} label="→" onClick={() => whole((s) => s.translate(1, 0))} />
          <span />
          <MoveBtn icon={<ArrowDown size={14} aria-hidden />} label="↓" onClick={() => whole((s) => s.translate(0, 1))} />
          <span />
        </div>
      </div>
    </div>
  )
}

function MoveBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={`${t('editor').transformMove} ${label}`}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink hover:bg-hover"
    >
      {icon}
    </button>
  )
}
