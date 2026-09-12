/**
 * 三个坐标系的唯一换算入口：豆格 ↔ 毫米 ↔ PDF 点。
 * 其它任何文件都不许自己做跨坐标系算术（第 5 节）。
 */

/** 1pt = 1/72 inch，1 inch = 25.4mm。用精确值，不用四舍五入过的常量。 */
export const PT_PER_MM = 72 / 25.4
export const MM_PER_PT = 25.4 / 72

/** 豆格坐标 → 毫米（相对板阵左上角）。y 向下为正。 */
export function cellToMm(col: number, row: number, pitch: number) {
  return { x: col * pitch, y: row * pitch }
}

/**
 * 豆格 → 毫米宽度：n 格豆的针区宽度。
 * ⚠️ 是 n × pitch，不是 (n-1) × pitch —— 后者是首末钉中心距。52 × 2.6 = 135.2mm。
 */
export function spanMm(nCells: number, pitch: number) {
  return nCells * pitch
}
