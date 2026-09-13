import { createPortal } from 'react-dom'

/** Portal 出口：模态不被任意祖先的 overflow/transform 裁掉。层级/escape 栈在 overlayState.ts。 */
export function OverlayPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}
