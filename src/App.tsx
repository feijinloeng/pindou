import { lazy, Suspense, useEffect, useRef } from 'react'

import ErrorBoundary from './components/ErrorBoundary'
import ProjectSession from './storage/ProjectSession'
import { applyUiPrefs } from './editor/uiState'
import { animate, MOTION } from './motion'
import { normalizeLegacyHash } from './router'
import { t } from './i18n/zh'

/**
 * 编辑器是唯一的顶层页面；作品库作为编辑器里的临时面板按需加载。
 */
const Editor = lazy(() => import('./pages/Editor'))

export default function App() {
  // 动效偏好应用到 <html>（data-motion）；界面固定浅色
  useEffect(() => applyUiPrefs(), [])

  // 独立作品库页面已移除：旧链接统一回到编辑器，且不新增浏览历史记录。
  useEffect(() => normalizeLegacyHash(), [])

  // 换页时整块内容淡入（180ms，不位移：transform 会改掉画布浮层的包含块）
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = mainRef.current
    if (el) animate(el, { opacity: 0 }, { opacity: 1, duration: MOTION.contextual, ease: MOTION.easeOut })
  }, [])

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col bg-workspace text-ink">
        <ProjectSession />
        <main ref={mainRef} className="min-h-0 flex-1">
          <Suspense fallback={<p className="p-6 text-sm text-ink-2">{t('loading')}</p>}>
            <Editor />
          </Suspense>
        </main>
      </div>
    </ErrorBoundary>
  )
}
