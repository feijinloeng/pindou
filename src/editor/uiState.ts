import { create } from 'zustand'

/**
 * 纯界面状态：动效偏好 / 面板会话状态。
 * 不进工程文件（Project schema v1 不加字段），换工程只保留明确说是偏好的部分。
 *
 * 动效偏好持久化到 localStorage（键 pindou.ui）；
 * 面板筛选等会话数据刷新即丢。
 */

export type MotionPref = 'system' | 'reduced'
export type ColorFilter = 'used' | 'all'
export type ColorOrder = 'name' | 'color'

interface UiState {
  motion: MotionPref
  colorFilter: ColorFilter | null
  colorOrder: ColorOrder

  setMotion(motion: MotionPref): void
  setColorFilter(filter: ColorFilter | null): void
  setColorOrder(order: ColorOrder): void
  /** 换工程时清掉会话级的面板状态（保留 pin 等显式偏好） */
  resetSession(): void
}

const PREF_KEY = 'pindou.ui'

function loadPrefs(): { motion: MotionPref } {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { motion: 'system' }
    const parsed = JSON.parse(raw) as { motion?: MotionPref }
    return {
      motion: ['system', 'reduced'].includes(parsed.motion ?? '') ? parsed.motion! : 'system',
    }
  } catch {
    return { motion: 'system' }
  }
}

function savePrefs(motion: MotionPref): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ motion }))
  } catch {
    // 隐私模式写不进就算了，偏好不是关键数据
  }
}

const initialPrefs = typeof localStorage === 'undefined' ? { motion: 'system' as MotionPref } : loadPrefs()

export const useUi = create<UiState>((set) => ({
  motion: initialPrefs.motion,
  colorFilter: null,
  colorOrder: 'color',

  setMotion(motion) {
    savePrefs(motion)
    set({ motion })
  },
  setColorFilter(colorFilter) {
    set({ colorFilter })
  },
  setColorOrder(colorOrder) {
    set({ colorOrder })
  },
  resetSession() {
    set({
      colorFilter: null,
      colorOrder: 'color',
    })
  },
}))

/** 系统要求减少动态效果 */
export function systemReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 把动效偏好应用到 <html>。App 挂载时调一次，返回清理函数。
 * data-motion 只在「应用层面降级」用；OS 级的 reduce 由 CSS media query 自己兜。
 */
export function applyUiPrefs(): () => void {
  const apply = () => {
    const { motion } = useUi.getState()
    // 应用选了 reduced 才写；OS reduce 不需要它（CSS media query 已生效）
    document.documentElement.dataset.motion = motion === 'reduced' ? 'reduced' : ''
  }
  apply()
  const unsubscribe = useUi.subscribe(apply)
  return unsubscribe
}
