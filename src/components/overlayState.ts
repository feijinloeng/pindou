import { useEffect, useRef } from 'react'

/** 系统层级：canvas 0 · controls 10 · panel 20 · menu 30 · modal 40/41 · notice 50 */
export const Z = { controls: 10, panel: 20, menu: 30, backdrop: 40, dialog: 41, notice: 50 } as const

const stack: Array<{ onEscape: () => void }> = []
export function pushOverlay(onEscape: () => void): () => void {
  const entry = { onEscape }
  stack.push(entry)
  return () => { const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1) }
}
export function escapeTopmost(): boolean { const top = stack.at(-1); if (!top) return false; top.onEscape(); return true }
export function hasOverlay(): boolean { return stack.length > 0 }
export function useOverlayEscape(active: boolean, onEscape: () => void): void {
  const current = useRef(onEscape)
  useEffect(() => { current.current = onEscape }, [onEscape])
  useEffect(() => active ? pushOverlay(() => current.current()) : undefined, [active])
}
