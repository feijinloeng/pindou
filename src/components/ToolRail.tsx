import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CursorClick,
  Eraser,
  Eyedropper,
  PaintBucket,
  Pencil,
  Selection,
} from '@phosphor-icons/react'

import { labelTextColor } from '../domain/palette'
import { t } from '../i18n/zh'
import { gsap, MOTION, reducedMotion } from '../motion'
import { useEditor, type ToolId } from '../editor/store'
import { Z } from './overlayState'
import { Tip } from './ui'
import { useRef } from 'react'

/**
 * 底部绘图 dock（spec 5.3）：六个工具 | 当前色号 | 撤销重做。
 * 画布让给图案，工具集中在这条 56px 的浮条里；按压只缩内部视觉层，靶子不动。
 */
const TOOLS: Array<{ id: ToolId; icon: React.ReactNode; key: string }> = [
  { id: 'pencil', icon: <Pencil size={20} aria-hidden />, key: 'B' },
  { id: 'eraser', icon: <Eraser size={20} aria-hidden />, key: 'E' },
  { id: 'bucket', icon: <PaintBucket size={20} aria-hidden />, key: 'G' },
  { id: 'picker', icon: <Eyedropper size={20} aria-hidden />, key: 'I' },
  { id: 'select', icon: <CursorClick size={20} aria-hidden />, key: 'V' },
  { id: 'rect', icon: <Selection size={20} aria-hidden />, key: 'M' },
]

export default function ToolDock() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const palette = useEditor((s) => s.palette)
  const colorIndex = useEditor((s) => s.colorIndex)
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const copy = t('editor')
  const color = palette.colors[colorIndex]

  const names: Record<ToolId, { name: string; hint: string }> = {
    pencil: { name: copy.toolPencil, hint: copy.toolPencilHint },
    eraser: { name: copy.toolEraser, hint: copy.toolEraserHint },
    bucket: { name: copy.toolBucket, hint: copy.toolBucketHint },
    picker: { name: copy.toolPicker, hint: copy.toolPickerHint },
    select: { name: copy.toolSelect, hint: copy.toolSelectHint },
    rect: { name: copy.toolRect, hint: copy.toolRectHint },
  }

  return (
    <>
      <nav
        aria-label={copy.tool}
        style={{ zIndex: Z.controls }}
        className="tool-dock absolute bottom-4 left-1/2 flex max-w-[500px] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-xl border border-line bg-surface p-1.5 shadow-md"
      >
        {TOOLS.map((item) => (
          <DockButton
            key={item.id}
            label={`${names[item.id].name}：${names[item.id].hint}（${item.key}）`}
            active={tool === item.id}
            onClick={() => setTool(item.id)}
          >
            {item.icon}
          </DockButton>
        ))}

        <div aria-hidden className="mx-1 h-6 w-px bg-line" />

        {color && (
          <Tip label={`${copy.activeColor} ${color.code} ${color.name}`}>
            <button
              type="button"
              aria-pressed={panel === 'color'}
              aria-label={`${copy.activeColor} ${color.code} ${color.name}，打开色号面板`}
              onClick={() => openPanel(panel === 'color' ? null : 'color')}
              className={`flex h-10 items-center gap-1.5 rounded-lg border px-2 ${
                panel === 'color' ? 'border-accent ring-1 ring-accent' : 'border-line'
              }`}
              style={{ backgroundColor: color.hex }}
            >
              <span
                className={`text-[10px] font-medium ${
                  labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'
                }`}
              >
                {color.code}
              </span>
            </button>
          </Tip>
        )}

        <div aria-hidden className="mx-1 h-6 w-px bg-line" />

        <DockButton label={`${copy.undo}（Cmd/Ctrl+Z）`} disabled={!canUndo} onClick={undo}>
          <ArrowCounterClockwise size={20} aria-hidden />
        </DockButton>
        <DockButton label={`${copy.redo}（Shift+Cmd/Ctrl+Z）`} disabled={!canRedo} onClick={redo}>
          <ArrowClockwise size={20} aria-hidden />
        </DockButton>
      </nav>

      {/* 左下：当前工具的一句话说明，换工具才换内容 */}
      <p
        aria-hidden
        style={{ zIndex: Z.controls }}
        className="absolute bottom-4 left-4 hidden rounded-lg bg-surface/80 px-2 py-1 text-xs text-ink-2 md:block"
      >
        {names[tool].name} · {names[tool].hint}
      </p>
    </>
  )
}

/** dock 里的 40px 图标按钮：按压反馈只作用在内部 span 上 */
function DockButton({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  const inner = useRef<HTMLSpanElement>(null)
  const release = () => {
    if (inner.current && !reducedMotion()) {
      gsap.to(inner.current, {
        scale: 1,
        duration: MOTION.release,
        ease: MOTION.easeBack,
        overwrite: 'auto',
      })
    }
  }
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        onPointerDown={() => {
          if (inner.current && !reducedMotion()) {
            gsap.to(inner.current, { scale: 0.97, duration: MOTION.press, overwrite: 'auto' })
          }
        }}
        onPointerUp={release}
        onPointerLeave={release}
        className={`flex h-10 w-10 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-30 ${
          active ? 'bg-accent text-on-accent' : 'text-ink hover:bg-hover'
        }`}
      >
        <span ref={inner} className="inline-flex">
          {children}
        </span>
      </button>
    </Tip>
  )
}
