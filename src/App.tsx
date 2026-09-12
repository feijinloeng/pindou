import { lazy, Suspense } from 'react'

import ErrorBoundary from './components/ErrorBoundary'
import { navigate, useRoute } from './router'
import { t } from './i18n/zh'

/**
 * 三个页面各自一个 chunk（P2-26）：
 * 作品库不需要加载画布渲染、图片转换和 PDF 导出那一大堆代码。
 * 色板数据是共享的，三个页面都要用，所以仍然在首屏的那个 chunk 里。
 */
const Library = lazy(() => import('./pages/Library'))
const Editor = lazy(() => import('./pages/Editor'))
const Follow = lazy(() => import('./pages/Follow'))

const TABS = [
  { route: 'library', label: t('nav').library },
  { route: 'editor', label: t('nav').editor },
  { route: 'follow', label: t('nav').follow },
] as const

export default function App() {
  const route = useRoute()
  const Page = { library: Library, editor: Editor, follow: Follow }[route]

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col bg-neutral-50 text-neutral-900">
      <header className="flex items-center gap-6 border-b border-neutral-200 bg-white px-5 py-3">
        <h1 className="text-sm font-semibold">{t('appName')}</h1>
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.route}
              onClick={() => navigate(tab.route)}
              className={`rounded px-3 py-1 text-sm ${
                route === tab.route
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1">
        <Suspense
          fallback={<p className="p-6 text-sm text-neutral-500">{t('loading')}</p>}
        >
          <Page />
        </Suspense>
      </main>
      </div>
    </ErrorBoundary>
  )
}
