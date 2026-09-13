import { create } from 'zustand'

/**
 * 纯界面状态：主题 / 动效偏好 / 专注模式 / 面板会话状态。
 * 不进工程文件（Project schema v1 不加字段），换工程只保留明确说是偏好的部分。
 *
 * 持久化只有 theme 和 motion 两项（localStorage，键 pindou.ui）；
 * 专注模式、面板查询这些是 session 数据，刷新即丢。
 */

export type ThemePref = 'system' | 'light' | 'dark'
export type MotionPref = 'system' | 'reduced'
export type ColorFilter = 'used' | 'all' | 'free'

interface UiState {
  theme: ThemePref
  motion: MotionPref
  /** 专注模式：藏起元数据和面板，只留画布、dock、缩放。session-only */
  focusMode: boolean
  /** 进专注模式前开着的面板，退出时原样恢复 */
  panelBeforeFocus: string | null
  /** 色号面板的会话状态：同一次工程 session 里切面板不丢 */
  colorQuery: string
  colorFilter: ColorFilter | null
  colorSettingsOpen: boolean

  setTheme(theme: ThemePref): void
  setMotion(motion: MotionPref): void
  setFocusMode(on: boolean): void
  setPanelBeforeFocus(panel: string | null): void
  setColorQuery(query: string): void
  setColorFilter(filter: ColorFilter | null): void
  setColorSettingsOpen(open: boolean): void
  /** 换工程时清掉会话级的面板状态（保留 pin 等显式偏好） */
  resetSession(): void
}

const PREF_KEY = 'pindou.ui'

function loadPrefs(): { theme: ThemePref; motion: MotionPref } {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { theme: 'system', motion: 'system' }
    const parsed = JSON.parse(raw) as { theme?: ThemePref; motion?: MotionPref }
    return {
      theme: ['system', 'light', 'dark'].includes(parsed.theme ?? '') ? parsed.theme! : 'system',
      motion: ['system', 'reduced'].includes(parsed.motion ?? '') ? parsed.motion! : 'system',
    }
  } catch {
    return { theme: 'system', motion: 'system' }
  }
}

function savePrefs(theme: ThemePref, motion: MotionPref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ theme, motion }))
  } catch {
    // 隐私模式写不进就算了，偏好不是关键数据
  }
}

const initialPrefs = typeof localStorage === 'undefined' ? { theme: 'system' as ThemePref, motion: 'system' as MotionPref } : loadPrefs()

export const useUi = create<UiState>((set, get) => ({
  theme: initialPrefs.theme,
  motion: initialPrefs.motion,
  focusMode: false,
  panelBeforeFocus: null,
  colorQuery: '',
  colorFilter: null,
  colorSettingsOpen: false,

  setTheme(theme) {
    savePrefs(theme, get().motion)
    set({ theme })
  },
  setMotion(motion) {
    savePrefs(get().theme, motion)
    set({ motion })
  },
  setFocusMode(focusMode) {
    set({ focusMode })
  },
  setPanelBeforeFocus(panelBeforeFocus) {
    set({ panelBeforeFocus })
  },
  setColorQuery(colorQuery) {
    set({ colorQuery })
  },
  setColorFilter(colorFilter) {
    set({ colorFilter })
  },
  setColorSettingsOpen(colorSettingsOpen) {
    set({ colorSettingsOpen })
  },
  resetSession() {
    set({
      focusMode: false,
      panelBeforeFocus: null,
      colorQuery: '',
      colorFilter: null,
      colorSettingsOpen: false,
    })
  },
}))

/** 系统当前是不是暗色 */
export function systemDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** 系统要求减少动态效果 */
export function systemReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 把主题/动效偏好应用到 <html>。App 挂载时调一次，返回清理函数。
 * data-motion 只在「应用层面降级」用；OS 级的 reduce 由 CSS media query 自己兜。
 */
export function applyUiPrefs(): () => void {
  const apply = () => {
    const { theme, motion } = useUi.getState()
    const dark = theme === 'dark' || (theme === 'system' && systemDark())
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    // 应用选了 reduced 才写；OS reduce 不需要它（CSS media query 已生效）
    document.documentElement.dataset.motion = motion === 'reduced' ? 'reduced' : ''
  }
  apply()
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const unsubscribe = useUi.subscribe(apply)
  darkQuery.addEventListener('change', apply)
  return () => {
    unsubscribe()
    darkQuery.removeEventListener('change', apply)
  }
}
