import { describe, expect, it } from 'vitest'

import { deriveGeometry, type BoardArray } from './board'
import { EMPTY, createGrid, gridEquals } from './grid'
import { createProject, parseProject, projectSummary, serializeProject } from './project'

function sampleProject(index = 0) {
  const boardArray: BoardArray = { rows: [['mini52']], gapMm: 0 }
  const geometry = deriveGeometry(boardArray)
  const grid = createGrid(geometry.cols, geometry.rows)
  for (let i = 0; i < 300; i++) grid.cells[i * 7] = (i + index) % 16
  return createProject({
    name: `客户 ${index}`,
    boardArray,
    paletteId: 'mard-291',
    grid,
  })
}

describe('工程序列化', () => {
  it('往返转换逐格相同', () => {
    const project = sampleProject()
    const text = serializeProject(project)
    const result = parseProject(text)
    expect(result.error).toBeNull()
    expect(result.project).not.toBeNull()
    expect(result.project!.name).toBe('客户 0')
    expect(result.project!.paletteId).toBe('mard-291')
    expect(gridEquals(result.project!.grid, project.grid)).toBe(true)
    expect(result.project!.grid.cells).toHaveLength(project.grid.cells.length)
  })

  it('压缩后体积远小于 JSON 数组', () => {
    const project = sampleProject()
    const text = serializeProject(project)
    const asArray = JSON.stringify({ cells: [...project.grid.cells] })
    expect(text.length).toBeLessThan(asArray.length / 2)
  })

  it('大色块图压得特别狠（500 万格也不怕）', () => {
    const boardArray: BoardArray = { rows: [['mini104']], gapMm: 0 }
    const geometry = deriveGeometry(boardArray)
    const grid = createGrid(geometry.cols, geometry.rows, 3)
    const project = createProject({ name: '整片', boardArray, paletteId: 'mard-291', grid })
    const text = serializeProject(project)
    // 10816 格纯色：压缩后应该只有几 KB
    expect(text.length).toBeLessThan(20_000)
    expect(gridEquals(parseProject(text).project!.grid, grid)).toBe(true)
  })

  it('截断的 JSON 明确报错，不静默修', () => {
    const text = serializeProject(sampleProject())
    const result = parseProject(text.slice(0, text.length - 40))
    expect(result.project).toBeNull()
    expect(result.error?.kind).toBe('fatal')
  })

  it('格子数据被改坏时报错', () => {
    const project = sampleProject()
    const parsed = JSON.parse(serializeProject(project))
    parsed.grid.data = 'bm90LXpsaWI='
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('解压失败')
  })

  it('格子长度和画布尺寸对不上时报错', () => {
    const project = sampleProject()
    const parsed = JSON.parse(serializeProject(project))
    parsed.grid.cols = parsed.grid.cols + 1
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toMatch(/长度不对|对不上/)
  })

  it('板阵和格子尺寸不一致时报错', () => {
    const project = sampleProject()
    const parsed = JSON.parse(serializeProject(project))
    parsed.layout = { placements: [{ board: 'mini104', col: 0, row: 0 }], gapMm: 0 }
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('对不上')
  })

  it('老工程只写了 boardArray（固定矩阵）也能读，会自动转成自由摆放', () => {
    const project = sampleProject()
    const parsed = JSON.parse(serializeProject(project))
    delete parsed.layout
    parsed.boardArray = { rows: [['mini52']], gapMm: 0 }
    parsed.grid.cols = 52
    parsed.grid.rows = 52
    const result = parseProject(JSON.stringify(parsed), 291)
    expect(result.error).toBeNull()
    expect(result.project?.layout.placements).toEqual([{ board: 'mini52', col: 0, row: 0 }])
  })

  it('自由摆放的 L 形板阵能存能读，空档位置不进作品', () => {
    const project = sampleProject()
    project.layout = {
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    }
    project.grid = { cols: 156, rows: 104, cells: new Uint16Array(156 * 104).fill(EMPTY) }
    const result = parseProject(serializeProject(project), 291)
    expect(result.error).toBeNull()
    expect(result.project?.layout.placements).toHaveLength(2)
  })

  it('格数超上限时报错', () => {
    const project = sampleProject()
    const parsed = JSON.parse(serializeProject(project))
    parsed.grid.cols = 4000
    parsed.grid.rows = 4000
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toMatch(/超出范围|长度不对/)
  })

  it('格子里引用了不存在的色号时拒绝导入', () => {
    const project = sampleProject()
    project.grid.cells[0] = 999
    const result = parseProject(serializeProject(project), 291)
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('不存在的色号')
  })

  it('给了色板大小但格子都在范围内就放行', () => {
    const project = sampleProject()
    expect(parseProject(serializeProject(project), 291).project).not.toBeNull()
  })

  it('schemaVersion 比程序新时拒绝导入', () => {
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.schemaVersion = 99
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('更新版本')
  })

  it('旧版本（v0）会被迁移并给出提示', () => {
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.schemaVersion = 0
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).not.toBeNull()
    expect(result.error?.kind).toBe('recovered')
    expect(result.project!.schemaVersion).toBe(1)
  })

  it('不是 JSON 时不崩', () => {
    expect(parseProject('{').error?.kind).toBe('fatal')
    expect(parseProject('[]').error?.kind).toBe('fatal')
    expect(parseProject('null').error?.kind).toBe('fatal')
  })
})

describe('工程摘要', () => {
  it('算出豆数、色数、板数和成品尺寸', () => {
    const project = sampleProject()
    const summary = projectSummary(project)
    expect(summary.cells).toBe(52 * 52)
    expect(summary.beads).toBe(300)
    expect(summary.colorCount).toBeGreaterThan(1)
    expect(summary.boardCount).toBe(1)
    expect(summary.sizeMm.w).toBeCloseTo(135.2, 6)
    expect(summary.sizeMm.h).toBeCloseTo(135.2, 6)
  })

  it('空格不算豆', () => {
    const grid = createGrid(4, 4)
    grid.cells[0] = 1
    const project = createProject({
      name: 'x',
      boardArray: { rows: [['mini26']], gapMm: 0 },
      paletteId: 'mard-291',
      grid,
    })
    expect(projectSummary(project).beads).toBe(1)
    expect(project.grid.cells.filter((v) => v === EMPTY)).toHaveLength(15)
  })
})
