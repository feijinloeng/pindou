import type { ReactNode } from 'react'

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
