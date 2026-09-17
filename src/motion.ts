/* oxlint-disable react(refs) -- presence ref 是 GSAP 的 DOM 生命周期所有者 */
import { useEffect, useRef, useState } from 'react'

import gsap from 'gsap'

import { systemReducedMotion, useUi } from './editor/uiState'

/**
 * 全站动效规格（spec 12.2）。时长和缓动都从这里取 —— 组件里各写一套数字，
 * 改的时候会漏，最后各处节奏不一致，看着像几个网站拼起来的。
 */
export const MOTION = {
  /** 按下 */
  press: 0.1,
  /** 松开回弹 */
  release: 0.18,
  /** 短淡入淡出（切换面板内容、状态图标） */
  fade: 0.14,
  /** 面板进入 */
  panelIn: 0.24,
  /** 面板退出 */
  panelOut: 0.16,
  /** 页面进入 */
  pageIn: 0.36,
  /** 上下文内容（选区条、提示条、选项展开） */
  contextual: 0.18,
  /** 菜单/气泡 */
  pop: 0.16,
  /** 进场先快后慢，退场 ”先慢后快 */
  easeOut: 'power3.out',
  easeIn: 'power2.in',
  /** 小控件释放的轻微过冲 */
  easeBack: 'back.out(1.2)',
  easeInOut: 'power2.inOut',
} as const

/**
 * 该不该跳过动画：OS 开了「减少动态效果」永远跳过（系统级设置，必须尊重）；
 * 应用内选了「减少」也跳过。应用内设置只能减、不能加 —— OS 要减少时它无权恢复动画。
 */
export function reducedMotion(): boolean {
  if (systemReducedMotion()) return true
  if (typeof window === 'undefined') return false
  return useUi.getState().motion === 'reduced'
}

/**
 * 从 from 动到 to。减少动态效果时一步落到终态 —— 动画和它的无障碍降级
 * 必须成对出现，所以包在一起。返回 tween（降级时是 set 的实例），调用方可以 kill。
 */
export function animate(
  el: Element | Element[],
  from: gsap.TweenVars,
  to: gsap.TweenVars,
): gsap.core.Tween {
  if (reducedMotion()) {
    return gsap.set(el, to)
  }
  gsap.killTweensOf(el)
  return gsap.fromTo(el, from, to)
}

export interface PresenceVars {
  /** 进入起点（from） */
  from: gsap.TweenVars
  /** 进入终点 / 静止态（to） */
  to: gsap.TweenVars
  /** 退出终点 */
  exit: gsap.TweenVars
  enterDuration?: number
  exitDuration?: number
}

/**
 * 统一的「挂载前播进入、卸载前播退出」。
 * store 里的 open 是目标状态，shown 才是当前该渲染的东西：
 *  - open→true：立刻渲染并播进入
 *  - open→false：立刻禁止交互（调用方靠 shown!==open 或自行 pointer-events-none），
 *    播退出，播完才卸载
 *  - 退出途中重新打开：kill 退出 tween，从当前状态播回进入，旧 onComplete 不会卸载重开的元素
 * 减少动态效果：不播，直接跟着 open 走（退出回调仍然执行，状态清理不丢）。
 */
export function usePresence<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  vars: PresenceVars,
): { ref: React.RefObject<T | null>; shown: boolean; exiting: boolean } {
  const [shown, setShown] = useState(open)
  const ref = useRef<T>(null)
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  // 用 ref 存最新 vars，避免调用方每次渲染传新对象导致 effect 重跑
  const varsRef = useRef(vars)
  useEffect(() => {
    varsRef.current = vars
  }, [vars])

  // 打开在渲染期间同步：留到 effect 里会白白多一帧空窗
  if (open && !shown) setShown(true)

  useEffect(() => {
    if (!shown) return
    const el = ref.current
    // 有些调用方（移动 sheet 分支）不用外框 ref：关闭时直接卸载，别等一场不会播的动画
    if (!el) {
      // 移动 sheet 没有外框 ref：异步卸载，避免 effect 内同步 setState 级联渲染
      if (!open) {
        const timer = setTimeout(() => setShown(false), 0)
        return () => clearTimeout(timer)
      }
      return
    }
    const v = varsRef.current
    tweenRef.current?.kill()
    tweenRef.current = null
    if (open) {
      if (reducedMotion()) {
        gsap.set(el, v.to)
      } else {
        tweenRef.current = gsap.fromTo(el, v.from, {
          ...v.to,
          duration: v.enterDuration ?? MOTION.panelIn,
          ease: MOTION.easeOut,
        })
      }
      return
    }
    // 退出
    if (reducedMotion()) {
      const timer = setTimeout(() => setShown(false), 0)
      return () => clearTimeout(timer)
    }
    tweenRef.current = gsap.to(el, {
      ...v.exit,
      duration: v.exitDuration ?? MOTION.panelOut,
      ease: MOTION.easeIn,
      onComplete: () => {
        tweenRef.current = null
        setShown(false)
      },
    })
    return () => {
      // 依赖变化/卸载时杀掉进行中的 tween；onComplete 不会在不存在的元素上触发
      tweenRef.current?.kill()
      tweenRef.current = null
    }
  }, [open, shown])

  return { ref, shown, exiting: shown && !open }
}

export { gsap }
