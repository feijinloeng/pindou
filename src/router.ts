/**
 * 顶层只有编辑器。纯静态工具保留 hash 地址以兼容已有链接。
 * 旧的 `#/library` 不再渲染独立页面，会被归一到 `#/editor`。
 * 形如 `#/editor`。
 */
export type Route = 'editor'

export function parseHash(_hash: string): Route {
  return 'editor'
}

export function normalizeLegacyHash(): void {
  if (typeof window === 'undefined') return
  const name = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  if (name !== 'library') return
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}#/editor`,
  )
}

export function navigate(route: Route) {
  if (window.location.hash !== `#/${route}`) window.location.hash = `#/${route}`
}
