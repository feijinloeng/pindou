import { useEditor } from '../editor/store'
import type { Project } from '../domain/project'

/**
 * 自动保存：编辑操作 debounce 2 秒写一次，跟做模式进度变化立刻写（第 14.1 节）。
 * 没有 indexedDB 的环境（测试、SSR）直接跳过。
 */
export function startAutosave(debounceMs = 2000): () => void {
  if (typeof indexedDB === 'undefined') return () => {}
  let timer: ReturnType<typeof setTimeout> | null = null

  // 重入由 store 的保存队列负责：这里的 flush 是"排一次队"，不会丢
  const flush = () => void useEditor.getState().saveNow()

  const schedule = (immediate: boolean) => {
    if (timer) clearTimeout(timer)
    if (immediate) flush()
    else timer = setTimeout(flush, debounceMs)
  }

  const unsubscribe = useEditor.subscribe((state, previous) => {
    if (state.commitVersion !== previous.commitVersion) schedule(false)
    if (state.projectId !== previous.projectId) return
    // 跟做进度和名字是"立刻写"的：丢了会让人白拼半小时
    if (state.making !== previous.making || state.name !== previous.name) schedule(true)
  })

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onHidden)

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHidden)
    if (timer) clearTimeout(timer)
  }
}

export function projectFromStore(): Project {
  return useEditor.getState().toProject()
}
