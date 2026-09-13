import { Component, type ErrorInfo, type ReactNode } from 'react'

import { navigate } from '../router'
import { t } from '../i18n/zh'

interface State {
  error: Error | null
}

/**
 * 兜底：组件崩了不要留一页白屏 —— 用户会以为"什么都没了"。
 *
 * 面向用户只给稳定文案 + 能自己动手的出路（回作品库 / 刷新）；
 * 原始 message 和 stack 只在开发模式展开 —— 生产环境的异常文本里可能带
 * 内部路径甚至用户数据，不该直接摆在界面上（P2-22）。
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面崩了：', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const copy = t('crash')
    const dev = import.meta.env?.DEV === true
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-semibold">{copy.title}</h1>
        <p className="max-w-md text-sm text-neutral-600">{copy.body}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm text-white"
            onClick={() => {
              this.setState({ error: null })
              navigate('library')
            }}
          >
            {copy.toLibrary}
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            onClick={() => window.location.reload()}
          >
            {copy.reload}
          </button>
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(`${error.name}: ${error.message}\n${error.stack ?? ''}`)
                .catch(() => undefined)
            }}
          >
            {copy.copyDiagnostics}
          </button>
        </div>
        <p className="max-w-md text-[9.35px] text-neutral-500">{copy.draftHint}</p>
        {dev && (
          <pre className="max-h-48 max-w-2xl overflow-auto rounded bg-neutral-100 p-2 text-left text-[9.35px] text-neutral-600">
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
        )}
      </div>
    )
  }
}
