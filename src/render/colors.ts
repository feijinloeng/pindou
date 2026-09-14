/**
 * 几个全局底色。单独一个模块是有原因的（P2-26）：
 * 缩略图只需要"底板什么颜色"，如果从 drawPattern 引，就会把
 * 整个画布渲染 + 色板数据拖进作品库的首屏。
 */
export const BOARD_BG = '#FAFAF8'
export const STAGE_BG = '#EFEFEC'
export const BOARD_GUIDE_COLOR = '#111111'
export const SELECTION_COLOR = '#1B6DE0'
export const CURSOR_COLOR = '#111111'
