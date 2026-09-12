import { beforeEach, describe, expect, it } from 'vitest'

import { EMPTY, usedCells } from '../domain/grid'
import { useEditor } from './store'

const store = () => useEditor.getState()

beforeEach(() => {
  // store 是单例，每个用例都起一份干净的作品（空画布 + 空撤销栈）
  store().newProject('测试')
  store().setTool('pencil')
  store().setPalette('mard-291')
  store().restoreAllCodes()
})

describe('编辑器 store', () => {
  it('新建板阵会重置画布和撤销栈', () => {
    const s = store()
    expect(s.grid.cols).toBe(52)
    expect(s.grid.rows).toBe(52)
    expect(usedCells(s.grid)).toBe(0)
    expect(s.canUndo).toBe(false)
    expect(s.selection).toEqual([])
  })

  it('画一笔 → 撤销 → 逐格回到原状（字节级相同）', () => {
    store().applyPreset('52-3x3')
    const before = store().grid.cells.slice()

    store().setColor(5)
    store().pointerDown(10, 10, 0, false)
    store().pointerMove(20, 20)
    store().pointerMove(20, 30)
    expect(store().pending?.size).toBeGreaterThan(0) // 拖拽期间只落在覆盖层
    expect(store().grid.cells).toEqual(before) // 提交前 grid 不动
    store().pointerUp()

    const after = store().grid.cells.slice()
    expect(after).not.toEqual(before)
    expect(store().pending).toBeNull()
    expect(store().canUndo).toBe(true)

    store().undo()
    expect(store().grid.cells).toEqual(before)

    store().redo()
    expect(store().grid.cells).toEqual(after)
  })

  it('橡皮把格子设回空格', () => {
    store().pointerDown(1, 1, 0, false)
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(1)
    store().setTool('eraser')
    store().pointerDown(1, 1, 0, false)
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(0)
  })

  it('右键取色不改画布', () => {
    store().setColor(9)
    store().pointerDown(3, 3, 0, false)
    store().pointerUp()
    const bytesBefore = store().undoBytes
    store().setColor(0)
    store().pointerDown(3, 3, 2, false)
    expect(store().colorIndex).toBe(9)
    expect(store().undoBytes).toBe(bytesBefore) // 取色不改画布，也不进撤销栈
  })

  it('油漆桶一次填满整块板，且可撤销', () => {
    store().setColor(3)
    store().setTool('bucket')
    store().pointerDown(0, 0, 0, false)
    expect(usedCells(store().grid)).toBe(52 * 52)
    store().undo()
    expect(usedCells(store().grid)).toBe(0)
  })

  it('点选工具只改一格（拖拽不连续落色）', () => {
    store().setTool('select')
    store().setColor(2)
    store().pointerDown(5, 5, 0, false)
    store().pointerMove(9, 9)
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(1)
  })

  it('框选 + 批量换色 / 清除', () => {
    store().setTool('rect')
    store().pointerDown(0, 0, 0, false)
    store().pointerMove(9, 9)
    store().pointerUp()
    expect(store().selection).toEqual([{ c0: 0, r0: 0, c1: 9, r1: 9 }])
    store().fillSel(7)
    expect(usedCells(store().grid)).toBe(100)
    store().eraseSel()
    expect(usedCells(store().grid)).toBe(0)
  })

  it('Shift 框选追加选区，反选得到补集', () => {
    store().setTool('rect')
    store().pointerDown(0, 0, 0, false)
    store().pointerMove(1, 1)
    store().pointerUp()
    store().pointerDown(5, 5, 0, true)
    store().pointerMove(6, 6)
    store().pointerUp()
    expect(store().selection).toHaveLength(2)
    // 两个矩形时反选给提示，不动选区（真正的布尔差集是 v2 的事）
    store().invertSel()
    expect(store().selection).toHaveLength(2)
    expect(store().notice).toBe('反选只支持单选区')
    // 单选区时反选 = 四条边
    store().clearSel()
    store().pointerDown(1, 1, 0, false)
    store().pointerMove(4, 4)
    store().pointerUp()
    store().invertSel()
    expect(store().selection).toHaveLength(4)
  })

  it('复制 → 粘贴走剪贴板并记账', () => {
    store().setTool('rect')
    store().pointerDown(0, 0, 0, false)
    store().pointerMove(2, 2)
    store().pointerUp()
    store().fillSel(4)
    store().copySel()
    expect(store().clipboard?.cols).toBe(3)
    // 换个位置再粘
    store().pointerDown(10, 10, 0, false)
    store().pointerMove(12, 12)
    store().pointerUp()
    store().pasteSel()
    expect(usedCells(store().grid)).toBe(18) // 原 9 格 + 粘到 (10,10) 的 9 格
    store().undo()
    expect(usedCells(store().grid)).toBe(9)
  })

  it('旋转非正方形选区时给出提示，不改画布', () => {
    store().setTool('rect')
    store().pointerDown(0, 0, 0, false)
    store().pointerMove(4, 1)
    store().pointerUp()
    store().rotate(1)
    expect(store().notice).toContain('正方形')
    expect(store().canUndo).toBe(false)
  })

  it('镜像 / 平移可撤销', () => {
    store().setColor(6)
    store().pointerDown(0, 0, 0, false)
    store().pointerUp()
    const before = store().grid.cells.slice()
    store().mirror('h')
    expect(store().grid.cells[51]).toBe(6)
    store().translate(0, 1)
    // 索引 = 行 × cols + 列：格 (列 51, 行 1) = 1 × 52 + 51
    expect(store().grid.cells[103]).toBe(6)
    expect(store().grid.cells[51]).toBe(EMPTY)
    store().undo()
    store().undo()
    expect(store().grid.cells).toEqual(before)
  })

  it('换色板时旧色板用到的色重映射到新色板的最近色', () => {
    store().setColor(0)
    store().pointerDown(0, 0, 0, false)
    store().pointerUp()
    const before = store().grid.cells[0]
    store().setPalette('perler')
    expect(store().palette.id).toBe('perler')
    const after = store().grid.cells[0]
    expect(after).not.toBe(0xffff)
    expect(after).not.toBe(before) // 索引空间换了，值必然要重算
    store().undo()
    expect(store().grid.cells[0]).toBe(before)
  })

  it('排除一个色号：用它画的格子全部重映射，且重映射后不再出现该色号', () => {
    store().setColor(0)
    store().pointerDown(5, 5, 0, false)
    store().pointerUp()
    const excludedCode = store().palette.colors[0].code
    store().toggleCode(excludedCode)
    expect(store().allowedCodes).not.toContain(excludedCode)
    expect(store().grid.cells[5 * store().grid.cols + 5]).not.toBe(0)
    expect([...store().grid.cells]).not.toContain(0)
    store().undo()
    expect(store().grid.cells[5 * store().grid.cols + 5]).toBe(0)
    store().restoreAllCodes()
    expect(store().allowedCodes).toBeNull()
  })

  it('133 万格的板阵建得起来，只提示板阵信息、不报警告', () => {
    store().applyPreset('stress-26-44')
    const s = store()
    expect(s.grid.cols).toBe(1144)
    expect(s.grid.cols * s.grid.rows).toBe(1_308_736)
    expect(s.notice).toContain('1144×1144')
    expect(s.notice).not.toContain('建议改用')
  })

  it('自由拼板：外接框里的空档不能画（没有板的地方不是格子）', () => {
    const failure = store().applyLayout({
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 156, row: 0 },
      ],
      gapMm: 0,
    })
    expect(failure).toBeNull()
    const { grid } = store()
    expect(grid.cols).toBe(208)
    expect(grid.rows).toBe(104)
    const withBoard = grid.placeable!.reduce((n, v) => n + v, 0)
    expect(withBoard).toBe(104 * 104 + 52 * 52)
    expect(grid.placeable!.length - withBoard).toBeGreaterThan(0)

    store().setColor(3)
    store().pointerDown(120, 60, 0, false) // 空档：104 和 156 之间
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(0)

    store().pointerDown(10, 10, 0, false) // 板子上
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(1)

    store().pointerDown(180, 20, 0, false) // 右边那块 52 板
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(2)
  })

  it('换板阵保留重叠位置上的内容', () => {
    store().setColor(5)
    store().pointerDown(3, 3, 0, false)
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(1)
    // 从 1 块 52 换到 2×2 个 52：原来的内容还在
    store().applyPreset('52-3x3')
    expect(usedCells(store().grid)).toBe(1)
    expect(store().grid.cells[3 * store().grid.cols + 3]).toBe(5)
  })

  it('空格数统计跟着提交层走', () => {
    store().setColor(1)
    store().pointerDown(0, 0, 0, false)
    store().pointerMove(10, 0)
    store().pointerUp()
    expect(usedCells(store().grid)).toBe(11)
    expect(store().grid.cells[0]).toBe(1)
    expect(store().grid.cells[11]).toBe(EMPTY)
  })
})
