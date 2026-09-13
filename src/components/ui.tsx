import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Btn({
  children,
  onClick,
  active,
  disabled,
  title,
  wide,
}: {
  children: ReactNode
  onClick?: () => void
  /** 开关类按钮传布尔值 → 同时输出 aria-pressed；普通按钮不传 */
  active?: boolean
  disabled?: boolean
  title?: string
  wide?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs whitespace-nowrap transition ${
        wide ? 'w-full text-left' : ''
      } ${
        active
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {children}
    </button>
  )
}

/** 主操作按钮：一屏里只有一个（保存 / 下一步：导出） */
export function PrimaryBtn({
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
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1 text-xs font-medium whitespace-nowrap text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** 菜单项：菜单里的一行动作，点完就收菜单 */
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
      className="rounded px-2 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * 下拉菜单：点外面 / Escape 收起。
 * children 可以是函数，拿到 close() 自己决定哪一下点完要收菜单
 * （菜单里嵌输入框时，打字不该把菜单关掉）。
 */
export function Dropdown({
  label,
  title,
  children,
  align = 'left',
  width = 'w-64',
}: {
  label: ReactNode
  title?: string
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  width?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)
  return (
    <div ref={ref} className="relative">
      <Btn active={open} onClick={() => setOpen(!open)} title={title}>
        {label}
      </Btn>
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-30 mt-1 flex flex-col gap-0.5 rounded border border-neutral-200 bg-white p-1 shadow-lg ${width} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="border-b border-neutral-200 px-3 py-3">
      {title && (
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">{title}</h3>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export function Label({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs text-neutral-600">
      <span>{children}</span>
      {value !== undefined && <span className="tabular-nums text-neutral-900">{value}</span>}
    </div>
  )
}
