import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsClockwise,
  CursorClick,
  Eraser,
  Eyedropper,
  FrameCorners,
  Image as ImageIcon,
  PaintBucket,
  Palette,
  Pencil,
  Selection,
  SquaresFour,
} from '@phosphor-icons/react'

import { labelTextColor } from '../domain/palette'
import { t } from '../i18n/zh'
import { gsap, MOTION, reducedMotion } from '../motion'
import { useEditor, type PanelId, type ToolId } from '../editor/store'
import { Z } from './overlayState'
import { Tip } from './ui'
import { useRef } from 'react'

import { CODE_ZOOM } from '../render/canvasViewport'

/**
 * Excalidraw 式顶部工具岛：功能入口、绘图工具、视图控制和历史操作。
 * 画布让给图案，工具悬浮在上方；按压只缩内部视觉层，靶子不动。
 */
const TOOLS: Array<{ id: ToolId; icon: React.ReactNode; key: string }> = [
  { id: 'select', icon: <CursorClick size={17} aria-hidden />, key: 'V' },
  { id: 'rect', icon: <Selection size={17} aria-hidden />, key: 'M' },
  { id: 'pencil', icon: <Pencil size={17} aria-hidden />, key: 'B' },
  { id: 'eraser', icon: <Eraser size={17} aria-hidden />, key: 'E' },
  { id: 'bucket', icon: <PaintBucket size={17} aria-hidden />, key: 'G' },
  { id: 'picker', icon: <Eyedropper size={17} aria-hidden />, key: 'I' },
]

export default function ToolDock({
  onZoom,
  onFit,
}: {
  onZoom: (factor: number) => void
  onFit: () => void
}) {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const palette = useEditor((s) => s.palette)
  const colorIndex = useEditor((s) => s.colorIndex)
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const openPicker = useEditor((s) => s.openPicker)
  const vp = useEditor((s) => s.vp)
  const showCodes = useEditor((s) => s.showCodes)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const copy = t('editor')
  const color = palette.colors[colorIndex]

  const launchers: Array<{
    id: PanelId | 'boards'
    label: string
    icon: React.ReactNode
    onClick: () => void
    expanded: boolean
  }> = [
    {
      id: 'image',
      label: copy.importImage,
      icon: <ImageIcon size={17} aria-hidden />,
      onClick: () => openPanel(panel === 'image' ? null : 'image'),
      expanded: panel === 'image',
    },
    {
      id: 'color',
      label: copy.launchColors,
      icon: <Palette size={17} aria-hidden />,
      onClick: () => openPanel(panel === 'color' ? null : 'color'),
      expanded: panel === 'color',
    },
    {
      id: 'boards',
      label: copy.launchBoards,
      icon: <SquaresFour size={17} aria-hidden />,
      onClick: () => openPicker('edit'),
      expanded: false,
    },
    {
      id: 'transform',
      label: copy.launchTransform,
      icon: <ArrowsClockwise size={17} aria-hidden />,
      onClick: () => openPanel(panel === 'transform' ? null : 'transform'),
      expanded: panel === 'transform',
    },
  ]

  const names: Record<ToolId, { name: string; hint: string }> = {
    pencil: { name: copy.toolPencil, hint: copy.toolPencilHint },
    eraser: { name: copy.toolEraser, hint: copy.toolEraserHint },
    bucket: { name: copy.toolBucket, hint: copy.toolBucketHint },
    picker: { name: copy.toolPicker, hint: copy.toolPickerHint },
    select: { name: copy.toolSelect, hint: copy.toolSelectHint },
    rect: { name: copy.toolRect, hint: copy.toolRectHint },
  }

  return (
    <nav
      aria-label={`${copy.launchImage}、${copy.tool}`}
      style={{ zIndex: Z.controls }}
      className="tool-dock absolute top-4 left-1/2 flex max-w-[calc(100vw-20.4px)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-xl border border-line bg-surface/95 p-1.5 shadow-md"
    >
        {launchers.map((item) => (
          <Tip key={item.id} label={item.label} placement="bottom">
            <button
              type="button"
              aria-expanded={item.id === 'boards' ? undefined : item.expanded}
              onClick={item.onClick}
              aria-label={item.label}
              className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm ${
                item.expanded ? 'bg-hover font-medium text-accent' : 'text-ink hover:bg-hover'
              }`}
            >
              {item.icon}
            </button>
          </Tip>
        ))}

        <div aria-hidden className="mx-1 h-6 w-px bg-line" />

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
          <Tip label={`${copy.activeColor} ${color.code} ${color.name}`} placement="bottom">
            <button
              type="button"
              aria-pressed={panel === 'color'}
              aria-label={`${copy.activeColor} ${color.code} ${color.name}，打开色号面板`}
              onClick={() => openPanel(panel === 'color' ? null : 'color')}
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                panel === 'color' ? 'border-accent ring-1 ring-accent' : 'border-line'
              }`}
              style={{ backgroundColor: color.hex }}
            >
              <span
                className={`text-[8.5px] font-medium ${
                  labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'
                }`}
              >
                {color.code}
              </span>
            </button>
          </Tip>
        )}

        <div aria-hidden className="mx-1 h-6 w-px bg-line" />

        <Tip label={`${copy.zoom} −`} placement="bottom">
          <button
            type="button"
            aria-label={`${copy.zoom} −`}
            onClick={() => onZoom(1 / 1.25)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-hover"
          >
            −
          </button>
        </Tip>
        <span
          className="px-1 text-xs text-ink-2 tabular"
          title={showCodes && vp.zoom < CODE_ZOOM ? copy.viewCodesZoomHint : undefined}
        >
          {copy.pxPerCell(vp.zoom)}
        </span>
        <Tip label={`${copy.zoom} ＋`} placement="bottom">
          <button
            type="button"
            aria-label={`${copy.zoom} ＋`}
            onClick={() => onZoom(1.25)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-hover"
          >
            ＋
          </button>
        </Tip>
        <Tip label={copy.fitCanvasHint} placement="bottom">
          <button
            type="button"
            onClick={onFit}
            aria-label={copy.fitCanvas}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-hover"
          >
            <FrameCorners size={15} aria-hidden />
          </button>
        </Tip>

        <div aria-hidden className="mx-1 h-6 w-px bg-line" />

        <Tip label={`${copy.undo}（Cmd/Ctrl+Z）`} placement="bottom">
          <button
            type="button"
            aria-label={`${copy.undo}（Cmd/Ctrl+Z）`}
            disabled={!canUndo}
            onClick={undo}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowCounterClockwise size={15} aria-hidden />
          </button>
        </Tip>
        <Tip label={`${copy.redo}（Shift+Cmd/Ctrl+Z）`} placement="bottom">
          <button
            type="button"
            aria-label={`${copy.redo}（Shift+Cmd/Ctrl+Z）`}
            disabled={!canRedo}
            onClick={redo}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowClockwise size={15} aria-hidden />
          </button>
        </Tip>

    </nav>
  )
}

/** dock 里的 34px 图标按钮：按压反馈只作用在内部 span 上 */
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
    <Tip label={label} placement="bottom">
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
