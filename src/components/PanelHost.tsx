import { useEffect, useRef, useState } from 'react'
import { PushPin, X } from '@phosphor-icons/react'

import ColorList from './ColorList'
import ConvertPanel from './ConvertPanel'
import TransformPanel from './TransformPanel'
import BoardPicker from '../pages/BoardPicker'
import Library from '../pages/Library'
import { t } from '../i18n/zh'
import { gsap, MOTION, reducedMotion, usePresence } from '../motion'
import { useEditor, type PanelId } from '../editor/store'
import { Modal } from './ui'
import { useMediaQuery } from './media'
import { Z } from './overlayState'

const TITLES: Record<PanelId, string> = {
  library: t('nav').library,
  boards: t('editor').launchBoards,
  image: t('convert').title,
  color: t('editor').colors,
  transform: t('editor').transformTitle,
}

// 所有常规临时面板共用同一套外框：与工具岛顶部对齐，底部贴近工作区，宽度统一。
const SIDE_PANEL_FRAME = 'top-4 bottom-4 left-4 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-lg'

/**
 * 辅助面板宿主（spec 5.5）：同一时间一个面板，浮在画布左上，不挤压画布、不动缩放。
 * 退出时立刻不可交互，播完才卸载；退出途中重开会杀掉旧退出回调。
 * 换面板类型：外框不动，内容 140ms 交叉淡入。
 */
export default function PanelHost() {
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const mobile = useMediaQuery('(max-width: 767px)')
  const open = panel !== null

  // 内容身份：退出动画期间还得显示旧面板，所以本地留一份
  const [shown, setShown] = useState<PanelId | null>(panel)
  if (panel && panel !== shown) setShown(panel)

  const imagePanel = shown === 'image'
  const { ref, shown: frameShown, exiting } = usePresence(open, {
    from: imagePanel ? { opacity: 0 } : { opacity: 0, x: -12 },
    to: imagePanel ? { opacity: 1 } : { opacity: 1, x: 0 },
    exit: imagePanel ? { opacity: 0 } : { opacity: 0, x: -8 },
    enterDuration: MOTION.panelIn,
    exitDuration: MOTION.panelOut,
  })

  // 换面板类型：外框不动，内容交叉淡入
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = contentRef.current
    if (!el || !shown || reducedMotion()) return
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: MOTION.fade, ease: MOTION.easeOut })
  }, [shown])

  if (!frameShown || !shown) return null

  const body = (
    <div
      ref={contentRef}
      onPointerDown={
        imagePanel
          ? (event) => {
              if (event.target === event.currentTarget) openPanel(null)
            }
          : undefined
      }
      className={imagePanel ? 'pointer-events-auto flex min-h-0 flex-1 items-center justify-center' : 'flex min-h-0 flex-1 flex-col'}
    >
      {shown === 'library' ? (
        <Library embedded onClose={() => openPanel(null)} />
      ) : shown === 'boards' ? (
        <BoardPicker />
      ) : shown === 'color' ? (
        <ColorList />
      ) : shown === 'image' ? (
        <ConvertPanel />
      ) : (
        <TransformPanel />
      )}
    </div>
  )

  if (mobile && shown !== 'library' && !imagePanel) {
    // 移动 sheet 是模态：焦点圈内、背景惰性、Escape/背板关闭（Modal 都包了）
    return (
      <Modal open={open} onClose={() => openPanel(null)} title={TITLES[shown]} sheet>
        <PanelHeader shown={shown} onClose={() => openPanel(null)} />
        {body}
      </Modal>
    )
  }

  return (
    <aside
      ref={ref}
      aria-label={TITLES[shown]}
      style={{ zIndex: Z.panel }}
      className={`absolute flex flex-col ${
        imagePanel
          ? 'inset-0'
          : shown === 'library'
            ? 'inset-x-0 top-24 mx-auto max-h-[calc(100vh-6rem)] w-[92vw] max-w-[92vw] overflow-y-auto max-lg:top-40'
            : SIDE_PANEL_FRAME
      } ${exiting ? 'pointer-events-none' : ''}`}
    >
      {shown === 'library' ? null : imagePanel ? <PanelClose onClose={() => openPanel(null)} /> : <PanelHeader shown={shown} onClose={() => openPanel(null)} />}
      {body}
    </aside>
  )
}

function PanelClose({ onClose }: { onClose: () => void }) {
  const copy = t('editor')
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={copy.closePanel}
      title={copy.closePanel}
      className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-surface/90 text-ink-2 hover:bg-hover"
    >
      <X size={14} aria-hidden />
    </button>
  )
}

function PanelHeader({ shown, onClose }: { shown: PanelId; onClose: () => void }) {
  const colorPinned = useEditor((s) => s.colorPinned)
  const setColorPinned = useEditor((s) => s.setColorPinned)
  const boardPinned = useEditor((s) => s.boardPinned)
  const setBoardPinned = useEditor((s) => s.setBoardPinned)
  const copy = t('editor')
  const pin =
    shown === 'color'
      ? { pinned: colorPinned, setPinned: setColorPinned, hint: copy.pinColorHint }
      : shown === 'boards'
        ? { pinned: boardPinned, setPinned: setBoardPinned, hint: copy.pinBoardHint }
        : null

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
      <h2 className="text-base font-semibold">{TITLES[shown]}</h2>
      <div className="ml-auto flex items-center gap-1">
        {pin && (
          <button
            type="button"
            aria-pressed={pin.pinned}
            aria-label={pin.hint}
            title={pin.hint}
            onClick={() => pin.setPinned(!pin.pinned)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              pin.pinned ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-hover'
            }`}
          >
            <PushPin size={14} weight={pin.pinned ? 'fill' : 'regular'} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.closePanel}
          title={copy.closePanel}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </header>
  )
}
