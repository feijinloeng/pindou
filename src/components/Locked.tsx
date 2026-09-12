import type { ReactNode } from 'react'

/**
 * 选板期间的"挡住"：不盖蒙层、不隐藏内容，只是点不动，点了给一句提示。
 * 用户要求"其他地方不会消失，也不会被挡住，但点不了"。
 */
export default function Locked({
  when,
  onBlocked,
  children,
}: {
  when: boolean
  onBlocked: () => void
  children: ReactNode
}) {
  if (!when) return <>{children}</>
  return (
    <div
      className="flex min-h-0 select-none opacity-50 [&_*]:cursor-not-allowed"
      onClickCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onBlocked()
      }}
      onKeyDownCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onBlocked()
      }}
    >
      {children}
    </div>
  )
}
