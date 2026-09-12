import { useEffect, useState } from 'react'

/**
 * 三个页面，用 hash 路由。纯静态工具不需要 router 依赖，静态托管也直接能跑。
 * 形如 `#/editor`。
 */
export type Route = 'library' | 'editor' | 'follow'

const ROUTES: Route[] = ['library', 'editor', 'follow']

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split('?')[0]
  return (ROUTES as string[]).includes(name) ? (name as Route) : 'library'
}

/** 没有 window 时（SSR / 冒烟测试）也读得出一个默认路由 */
function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

export function navigate(route: Route) {
  window.location.hash = `#/${route}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(currentHash()))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(currentHash()))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
