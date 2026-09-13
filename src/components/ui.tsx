/* oxlint-disable react(only-export-components), react(refs) -- 共享原语同时导出组件、hook 与样式常量 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { gsap, MOTION, reducedMotion, usePresence } from '../motion'
import { OverlayPortal } from './OverlayHost'
import { useOverlayEscape, Z } from './overlayState'

/**
 * 共享控件。视觉值全部来自 index.css 的语义 token，不写死颜色。
 * 尺寸规矩（spec 3.1）：桌面控件 ≥36px 高，图标靶 40×40，触屏 44×44；
 * 按钮/输入圆角 8，气泡/面板/卡片 12。
 */

/* ---------- 按压反馈：只缩内部视觉层，可点靶子不动 ---------- */

function usePressFeedback() {
  const ref = useRef<HTMLSpanElement>(null)
  const release = useCallback(() => {
    const el = ref.current
    if (el && !reducedMotion()) gsap.to(el, { scale: 1, duration: MOTION.release, ease: MOTION.easeBack, overwrite: 'auto' })
  }, [])
  const onPointerDown = useCallback(() => {
    const el = ref.current
    if (el && !reducedMotion()) gsap.to(el, { scale: 0.97, duration: MOTION.press, overwrite: 'auto' })
  }, [])
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = ref.current
    if ((e.key === 'Enter' || e.key === ' ') && el && !reducedMotion()) gsap.fromTo(el, { scale: 0.97 }, { scale: 1, duration: MOTION.release, ease: MOTION.easeBack, overwrite: 'auto' })
  }, [])
  return { ref, handlers: { onPointerDown, onPointerUp: release, onPointerLeave: release, onKeyDown } }
}

/* ---------- 按钮 ---------- */

type BtnVariant = 'secondary' | 'primary' | 'ghost'

const BTN_BASE =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-40'
const BTN_VARIANTS: Record<BtnVariant, string> = {
  secondary: 'border-line bg-surface text-ink hover:bg-hover',
  primary: 'border-accent bg-accent text-on-accent hover:opacity-90',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-hover hover:text-ink',
}

export function Btn({
  children,
  onClick,
  active,
  disabled,
  title,
  variant = 'secondary',
  wide,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  /** 开关类按钮传布尔值 → 同时输出 aria-pressed；普通按钮不传 */
  active?: boolean
  disabled?: boolean
  title?: string
  variant?: BtnVariant
  wide?: boolean
  type?: 'button' | 'submit'
}) {
  const { ref: inner, handlers } = usePressFeedback()
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      {...handlers}
      className={`${BTN_BASE} ${BTN_VARIANTS[variant]} ${wide ? 'w-full' : ''} ${
        active ? 'border-accent bg-accent text-on-accent' : ''
      }`}
    >
      <span ref={inner} className="inline-flex items-center gap-1.5">
        {children}
      </span>
    </button>
  )
}

/* ---------- 提示：悬停 350ms 后出现，键盘聚焦立刻出现。纯 CSS，没有定时器要清 ---------- */

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs whitespace-nowrap text-surface opacity-0 shadow-md transition-opacity group-hover/tip:block group-hover/tip:opacity-100 group-hover/tip:delay-[350ms] group-focus-within/tip:block group-focus-within/tip:opacity-100 group-focus-within/tip:delay-0"
      >
        {label}
      </span>
    </span>
  )
}

/* ---------- 图标按钮：40×40，tip 文本同时是可访问名 ---------- */

export function IconBtn({
  icon,
  label,
  onClick,
  active,
  disabled,
  size = 40,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  size?: number
}) {
  const { ref: inner, handlers } = usePressFeedback()
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        disabled={disabled}
        onClick={onClick}
        {...handlers}
        style={{ width: size, height: size }}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg border text-ink select-none disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? 'border-accent bg-accent text-on-accent'
            : 'border-transparent bg-transparent hover:bg-hover'
        }`}
      >
        <span ref={inner} className="inline-flex">
          {icon}
        </span>
      </button>
    </Tip>
  )
}

/* ---------- 表单字段：标签在输入框上面 ---------- */

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-2">
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-2">{hint}</span>}
    </label>
  )
}

export const INPUT_CLS =
  'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-2/60'

/* ---------- 键值行 ---------- */

export function Label({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm text-ink-2">
      <span>{children}</span>
      {value !== undefined && <span className="tabular text-ink">{value}</span>}
    </div>
  )
}

/* ---------- 披露（更多调整这类）：aria-expanded/controls 齐全 ---------- */

export function Disclosure({
  summary,
  children,
  open,
  onToggle,
}: {
  summary: ReactNode
  children: ReactNode
  open?: boolean
  onToggle?: (open: boolean) => void
}) {
  const id = useId()
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = open !== undefined
  const shown = controlled ? open : innerOpen
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!shown || !el || reducedMotion()) return
    gsap.fromTo(
      el,
      { opacity: 0, y: 4 },
      { opacity: 1, y: 0, duration: MOTION.pop, ease: MOTION.easeOut, clearProps: 'transform' },
    )
  }, [shown])

  return (
    <div>
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => (controlled ? onToggle?.(!shown) : setInnerOpen(!shown))}
        className="flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <span
          aria-hidden
          className={`inline-block transition-transform ${shown ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        {summary}
      </button>
      {shown && (
        <div id={id} ref={bodyRef} className="mt-2">
          {children}
        </div>
      )}
    </div>
  )
}

/* ---------- 浮层共用：打开/关闭动画 + 外交互关闭 + Escape 入栈 + 焦点归还 ---------- */

function useFloating(open: boolean, onClose: () => void) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useOverlayEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open, onClose])

  // 关掉后焦点还给触发按钮（键盘用户不该被丢回 body）
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open) wasOpen.current = true
    else if (wasOpen.current) {
      wasOpen.current = false
      triggerRef.current?.focus()
    }
  }, [open])

  return { triggerRef, boxRef }
}

/* ---------- 菜单：menu 语义 + 方向键导航。只放动作；表单去 Popover ---------- */

export function Menu({
  label,
  title,
  children,
  align = 'left',
  width = 'w-64',
  triggerVariant = 'secondary',
}: {
  label: ReactNode
  title?: string
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  width?: string
  triggerVariant?: BtnVariant
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const { triggerRef, boxRef } = useFloating(open, close)
  const { ref, shown, exiting } = usePresence(open, {
    from: { opacity: 0, scale: 0.98, y: -4 },
    to: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -4 },
    enterDuration: MOTION.pop,
    exitDuration: 0.1,
  })

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(
      boxRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    )
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (e.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`${BTN_BASE} ${open ? 'border-accent bg-accent text-on-accent' : BTN_VARIANTS[triggerVariant]}`}
      >
        {label}
      </button>
      {shown && (
        <div
          ref={(el) => {
            boxRef.current = el
            ref.current = el
          }}
          role="menu"
          aria-label={title}
          onKeyDown={onMenuKey}
          style={{ zIndex: Z.menu, transformOrigin: align === 'right' ? 'top right' : 'top left' }}
          className={`absolute top-full mt-1 flex flex-col gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lg ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${exiting ? 'pointer-events-none' : ''}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  )
}

export function MenuItem({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/* ---------- 气泡：非模态 dialog，放表单。菜单放动作，气泡放内容 ---------- */

export function Popover({
  label,
  title,
  children,
  align = 'left',
  width = 'w-72',
  trigger,
}: {
  label?: ReactNode
  title: string
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  width?: string
  /** 完全自定义触发器（默认是一个 secondary 按钮） */
  trigger?: (open: boolean, toggle: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const { triggerRef, boxRef } = useFloating(open, close)
  const { ref, shown, exiting } = usePresence(open, {
    from: { opacity: 0, scale: 0.98, y: -4 },
    to: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -4 },
    enterDuration: MOTION.pop,
    exitDuration: 0.1,
  })

  return (
    <span className="relative inline-flex">
      {trigger ? (
        trigger(open, () => setOpen(!open))
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`${BTN_BASE} ${open ? 'border-accent bg-accent text-on-accent' : BTN_VARIANTS.secondary}`}
        >
          {label}
        </button>
      )}
      {shown && (
        <div
          ref={(el) => {
            boxRef.current = el
            ref.current = el
          }}
          role="dialog"
          aria-label={title}
          style={{ zIndex: Z.menu }}
          className={`absolute top-full mt-1 rounded-xl border border-line bg-surface p-3 shadow-lg ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${exiting ? 'pointer-events-none' : ''}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  )
}

/* ---------- 模态 / 移动 sheet：portal + 背板 + 焦点圈 + Escape 入栈 ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  sheet,
  dismissable = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** true = 移动底部 sheet（≤72dvh、安全区）；false = 居中对话框 */
  sheet?: boolean
  /** 点背板能不能关（有需要确认的交互时关掉） */
  dismissable?: boolean
}) {
  useOverlayEscape(open, onClose)
  const { ref, shown, exiting } = usePresence<HTMLDivElement>(open, sheet
    ? {
        from: { opacity: 0, y: 20 },
        to: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 20 },
        enterDuration: MOTION.panelIn,
        exitDuration: MOTION.panelOut,
      }
    : {
        from: { opacity: 0, scale: 0.98, y: -4 },
        to: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98 },
        enterDuration: MOTION.pop,
        exitDuration: 0.1,
      })
  const dialogRef = useRef<HTMLDivElement>(null)

  // 焦点圈：打开时聚焦第一个可聚焦物，Tab 不出对话框
  useEffect(() => {
    if (!shown || exiting) return
    const el = dialogRef.current
    if (!el) return
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
    const first = focusables()[0]
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [shown, exiting])

  if (!shown) return null

  return (
    <OverlayPortal>
      <div
        aria-hidden
        onClick={dismissable ? onClose : undefined}
        style={{ zIndex: Z.backdrop }}
        className={`fixed inset-0 bg-black/30 ${exiting ? 'pointer-events-none' : ''}`}
      />
      <div
        ref={(el) => {
          dialogRef.current = el
          ref.current = el
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ zIndex: Z.dialog }}
        className={
          sheet
            ? `fixed inset-x-0 bottom-0 flex max-h-[72dvh] flex-col rounded-t-xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl ${
                exiting ? 'pointer-events-none' : ''
              }`
            : `fixed top-1/2 left-1/2 w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-4 shadow-xl ${
                exiting ? 'pointer-events-none' : ''
              }`
        }
      >
        {children}
      </div>
    </OverlayPortal>
  )
}
