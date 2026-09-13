import { lazy, Suspense, useEffect, useRef } from 'react'

import ErrorBoundary from './components/ErrorBoundary'
import ProjectSession from './storage/ProjectSession'
import { applyUiPrefs } from './editor/uiState'
import { animate, MOTION } from './motion'
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
  // 编辑器和跟做页各自带文档头；应用导航只出现在作品库
  const chrome = route === 'library'

  // 主题/动效偏好应用到 <html>（data-theme / data-motion）
  useEffect(() => applyUiPrefs(), [])

  // 换页时整块内容淡入（180ms，不位移：transform 会改掉画布浮层的包含块）
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = mainRef.current
    if (el) animate(el, { opacity: 0 }, { opacity: 1, duration: MOTION.contextual, ease: MOTION.easeOut })
  }, [route])

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col bg-workspace text-ink">
        <ProjectSession />
        {chrome && (
          <header className="flex h-14 items-center gap-6 border-b border-line bg-surface px-5">
            <h1 className="text-sm font-semibold">{t('appName')}</h1>
            <nav className="flex gap-1">
              {TABS.map((tab) => (
                <button
                  key={tab.route}
                  onClick={() => navigate(tab.route)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    route === tab.route
                      ? 'bg-accent text-on-accent'
                      : 'text-ink-2 hover:bg-hover'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </header>
        )}
        <main ref={mainRef} className="min-h-0 flex-1">
          <Suspense fallback={<p className="p-6 text-sm text-ink-2">{t('loading')}</p>}>
            <Page />
          </Suspense>
        </main>
        {chrome && (
          <footer className="border-t border-line bg-surface py-2 text-center text-xs text-ink-2">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              {t('icp')}
            </a>
          </footer>
        )}
      </div>
    </ErrorBoundary>
  )
}
