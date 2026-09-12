/**
 * 全局快捷键的前置判断：正在文本输入 / 下拉框 / 输入法组合中就把键盘还给浏览器。
 * 只按 tagName 和 isContentEditable 判断，不碰 DOM，测试里可以传假对象。
 */
export function isEditableTarget(target: unknown): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true
  return el.isContentEditable === true
}

/** 输入法正在组合输入（keydown 上 isComposing，或旧的 229 码） */
export function isComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229
}

/** 画布快捷键该不该响应：不在输入控件里、不在输入法组合中 */
export function shouldHandleCanvasKey(event: {
  target?: unknown
  isComposing?: boolean
  keyCode?: number
}): boolean {
  if (isComposing(event)) return false
  return !isEditableTarget(event.target)
}
