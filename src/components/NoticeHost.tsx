import { useEffect } from 'react'

import { useEditor } from '../editor/store'
import { MOTION, usePresence } from '../motion'
import { Z } from './overlayState'

/**
 * 全局通知：挂在编辑/导出/选板的分支之外，导出失败、转换完成这类反馈
 * 在哪个子状态都看得见。成功 4 秒自己消失；错误一直留到手动关掉或纠正。
 *
 * 全屏时也用它 —— 必须挂在全屏目标的子树里，portal 到 body 就看不见了，
 * 所以这里不用 OverlayPortal，调用方把它放在需要的位置。
 */
export default function NoticeHost() {
  const notice = useEditor((s) => s.notice)
  const kind = useEditor((s) => s.noticeKind)
  const setNotice = useEditor((s) => s.setNotice)
  const open = notice !== null
  const { ref, shown, exiting } = usePresence(open, {
    from: { opacity: 0, y: 8 },
    to: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 8 },
    enterDuration: MOTION.contextual,
    exitDuration: 0.12,
  })

  useEffect(() => {
    if (!notice || kind === 'error') return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice, kind, setNotice])

  if (!shown) return null

  return (
    <div
      ref={ref}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      style={{ zIndex: Z.notice }}
      className={`pointer-events-none absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg px-3 py-1.5 text-xs shadow-lg ${
        kind === 'error' ? 'bg-danger text-white' : 'bg-ink text-surface'
      } ${exiting ? 'pointer-events-none' : ''}`}
    >
      <span>{notice}</span>
      {kind === 'error' && (
        <button
          type="button"
          aria-label="关闭通知"
          onClick={() => setNotice(null)}
          className="pointer-events-auto rounded px-1 text-white/90 hover:text-white"
        >
          ✕
        </button>
      )}
    </div>
  )
}
