import { useEffect } from 'react'

import { useEditor } from '../editor/store'
import { useUi } from '../editor/uiState'
import { useRoute } from '../router'
import { startAutosave } from './autosave'

/**
 * 工程 session 的唯一拥有者（spec 13）：
 *  - 进编辑器：没有加载过工程就恢复上次的草稿，再捡缓存的源图
 *  - 回作品库：先把挂起的保存冲掉，再退订，后台不再写工程
 *  - 换工程：清掉会话级的界面状态（面板查询、专注模式）
 *
 * 全应用只挂这一个实例 —— Editor 不自己挂 autosave，避免离开页面时订阅管理分散。
 */
export default function ProjectSession() {
  const route = useRoute()
  const inProject = route === 'editor'

  useEffect(() => {
    if (!inProject) return
    const state = useEditor.getState()
    // 'local-draft' 是还没加载过任何工程的初始 id
    const boot =
      state.projectId === 'local-draft' ? state.restoreLast() : Promise.resolve(false)
    void boot.then(() => useEditor.getState().restoreSourceImage())
    const stop = startAutosave()
    return () => {
      // 离开工程页面：先把 pending 的改动落盘再退订，顺序不能反
      void useEditor.getState().saveNow()
      stop()
    }
  }, [inProject])

  useEffect(
    () =>
      useEditor.subscribe((state, previous) => {
        if (state.projectId !== previous.projectId) useUi.getState().resetSession()
      }),
    [],
  )

  return null
}
