#!/usr/bin/env node
/**
 * lostCells 的自检：换板阵前的"会丢多少格"算错就等于悄悄丢内容。
 * `npm run check` 直接跑（Node 24 跑 TS，不装任何测试框架）。
 */
import assert from 'node:assert/strict'

import { EMPTY, lostCells } from '../../src/domain/grid.ts'

/** 全板可用（placeable 省略）或按遮罩给 */
function grid(cols: number, rows: number, placeable?: Uint8Array) {
  return { cols, rows, cells: new Uint16Array(cols * rows).fill(EMPTY), placeable }
}

function fill(g: ReturnType<typeof grid>, index: number, value = 0) {
  g.cells[index] = value
}

// 1. 内容全在新板阵里面：一格都不丢
{
  const g = grid(4, 4)
  fill(g, 0)
  fill(g, 15)
  assert.equal(lostCells(g, { cols: 4, rows: 4, placeable: new Uint8Array(16).fill(1) }), 0)
}

// 2. 新板阵变小：外面的格子算丢
{
  const g = grid(4, 4)
  fill(g, 0) // 第 0 行第 0 列，留着
  fill(g, 3 * 4 + 3) // 第 3 行第 3 列，新板阵只有 2×2，丢掉
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable: new Uint8Array(4).fill(1) }), 1)
}

// 3. 新的空档（外接矩形里没有板的地方）：落在空档里的格子算丢
{
  const g = grid(2, 2)
  fill(g, 1) // 第 0 行第 1 列
  const placeable = new Uint8Array([1, 0, 1, 1]) // 右上角是空档
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable }), 1)
}

// 4. 现在的空档里的脏数据不算内容，丢了也不算丢
{
  const g = grid(2, 2, new Uint8Array([1, 0, 1, 1]))
  fill(g, 1) // 在空档里，本来就不算作品
  assert.equal(lostCells(g, { cols: 2, rows: 2, placeable: new Uint8Array(4) }), 0)
}

console.log('lostCells 自检通过（4 条）')
