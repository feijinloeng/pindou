import { useEffect, useRef, useState } from 'react'
import { PushPin, X } from '@phosphor-icons/react'

import ColorList from './ColorList'
import ConvertPanel from './ConvertPanel'
import TransformPanel from './TransformPanel'
import { t } from '../i18n/zh'
import { gsap, MOTION, reducedMotion, usePresence } from '../motion'
import { useEditor, type PanelId } from '../editor/store'
import { Modal } from './ui'
import { useMediaQuery } from './media'
import { Z } from './overlayState'

const TITLES: Record<PanelId, string> = {
  image: t('convert').title,
  color: t('editor').colors,
  transform: t('editor').transformTitle,
}

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

  const { ref, shown: frameShown, exiting } = usePresence(open, {
    from: { opacity: 0, x: -12 },
    to: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -8 },
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
    <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
      {shown === 'color' ? <ColorList /> : shown === 'image' ? <ConvertPanel /> : <TransformPanel />}
    </div>
  )

  if (mobile) {
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
      className={`absolute top-28 bottom-4 left-4 flex w-80 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg max-lg:top-40 ${
        exiting ? 'pointer-events-none' : ''
      }`}
    >
      <PanelHeader shown={shown} onClose={() => openPanel(null)} />
      {body}
    </aside>
  )
}

function PanelHeader({ shown, onClose }: { shown: PanelId; onClose: () => void }) {
  const colorPinned = useEditor((s) => s.colorPinned)
  const setColorPinned = useEditor((s) => s.setColorPinned)
  const copy = t('editor')
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
      <h2 className="text-base font-semibold">{TITLES[shown]}</h2>
      <div className="ml-auto flex items-center gap-1">
        {shown === 'color' && (
          <button
            type="button"
            aria-pressed={colorPinned}
            aria-label={copy.pinColorHint}
            title={copy.pinColorHint}
            onClick={() => setColorPinned(!colorPinned)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              colorPinned ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-hover'
            }`}
          >
            <PushPin size={14} weight={colorPinned ? 'fill' : 'regular'} aria-hidden />
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
