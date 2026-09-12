import Follow from './pages/Follow'
import Editor from './pages/Editor'
import Library from './pages/Library'
import ErrorBoundary from './components/ErrorBoundary'
import { navigate, useRoute } from './router'
import { t } from './i18n/zh'

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
        <Page />
      </main>
      </div>
    </ErrorBoundary>
  )
}
