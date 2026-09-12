import type { ReactNode } from 'react'

/**
 * 选板期间的"挡住"：不盖蒙层、不隐藏内容，只是点不动，点了给一句提示。
 * 用户要求"其他地方不会消失，也不会被挡住，但点不了"。
 *
 * `inert` 是这里的正解：它同时挡住指针、键盘焦点和屏幕阅读器，
 * 光靠透明度和 capture 挡事件，屏幕阅读器还会把里面的按钮读成可点的。
 * 锁定原因用外面的一个 role="status" 说明 —— inert 区域里的话是读不出来的。
 */
export default function Locked({
  when,
  onBlocked,
  reason,
  children,
}: {
  when: boolean
  onBlocked: () => void
  /** 为什么点不了（读给屏幕阅读器听） */
  reason?: string
  children: ReactNode
}) {
  if (!when) return <>{children}</>
  return (
    <>
      {reason && (
        <span className="sr-only" role="status">
          {reason}
        </span>
      )}
      <div className="relative flex min-h-0 select-none opacity-50">
        {/* 蒙一层专门负责"点了给句话"：里面那些控件已经 inert，收不到指针事件 */}
        <div
          role="presentation"
          onClick={onBlocked}
          className="absolute inset-0 z-10 [&_*]:cursor-not-allowed"
        />
        <div inert className="flex min-h-0 [&_*]:cursor-not-allowed">
          {children}
        </div>
      </div>
    </>
  )
}
