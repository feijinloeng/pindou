import { Component, type ErrorInfo, type ReactNode } from 'react'

import { t } from '../i18n/zh'

interface State {
  error: Error | null
}

/**
 * 兜底：组件崩了不要留一页白屏 —— 用户会以为"什么都没了"。
 * 草稿是自动保存的，刷新就能回来，所以这里给刷新按钮和错误原文。
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('界面崩了：', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    const copy = t('crash')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-base font-semibold">{copy.title}</h1>
        <p className="max-w-md text-sm text-neutral-600">{copy.body}</p>
        <button
          type="button"
          className="rounded border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm text-white"
          onClick={() => window.location.reload()}
        >
          {copy.reload}
        </button>
        <pre className="max-h-48 max-w-2xl overflow-auto rounded bg-neutral-100 p-2 text-left text-[11px] text-neutral-600">
          {error.message}
        </pre>
      </div>
    )
  }
}
