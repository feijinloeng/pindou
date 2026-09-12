import { describe, expect, it } from 'vitest'
import { unzlibSync, zlibSync } from 'fflate'

import { getPalette } from '../data/palettes'
import { deriveGeometry, deriveLayoutGeometry, type BoardArray } from './board'
import { EMPTY, createGrid, gridEquals } from './grid'
import {
  createProject,
  parseProject,
  projectSummary,
  serializeProject,
  validateProject,
} from './project'

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
    const geometry = deriveLayoutGeometry(project.layout)
    project.grid = createGrid(geometry.cols, geometry.rows, EMPTY, geometry.placeable)
    project.grid.cells[0] = 7
    // 模拟旧版本误把空档写成了豆，导出再导入后必须清掉。
    project.grid.cells[60 * geometry.cols + 120] = 8
    const result = parseProject(serializeProject(project), 291)
    expect(result.error).toBeNull()
    expect(result.project?.layout.placements).toHaveLength(2)
    expect(result.project?.grid.placeable).toEqual(geometry.placeable)
    expect(result.project?.grid.cells[0]).toBe(7)
    expect(result.project?.grid.cells[60 * geometry.cols + 120]).toBe(EMPTY)
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

  it('不认识色板时不静默回退：换到默认色板并明确告知', () => {
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.paletteId = 'no-such-palette'
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).not.toBeNull()
    expect(result.project!.paletteId).toBe('mard-291')
    expect(result.error?.kind).toBe('recovered')
    expect(result.error?.message).toContain('找不到色板')
  })

  it('不写色板大小也能自己查出色板并校验色号', () => {
    const project = sampleProject()
    project.grid.cells[0] = 5000
    const result = parseProject(serializeProject(project))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('不存在的色号')
  })

  it('画布尺寸必须是正整数（小数 / 0 / 负数都拒绝）', () => {
    for (const size of [0, -52, 52.5]) {
      const parsed = JSON.parse(serializeProject(sampleProject()))
      parsed.grid.cols = size
      const result = parseProject(JSON.stringify(parsed))
      expect(result.project).toBeNull()
      expect(result.error?.message).toMatch(/正整数|长度不对|对不上/)
    }
  })

  it('不支持的格子编码直接拒绝', () => {
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.grid.encoding = 'raw-binary'
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('不支持的格子编码')
  })

  it('未知板型报结构化错误，不是 TypeError', () => {
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.layout = { placements: [{ board: 'mini99', col: 0, row: 0 }], gapMm: 0 }
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).toBeNull()
    expect(result.error?.message).toContain('不认识这个板型')
  })

  it('视图 / 跟做进度 / 白名单坏数据就地修好并告知', () => {
    const firstCode = getPalette('mard-291').colors[0].code
    const parsed = JSON.parse(serializeProject(sampleProject()))
    parsed.view = { zoom: -3, panX: 'x', panY: null, showCodes: 'yes' }
    parsed.making = { completedCodes: 'nope', completedRegions: 5, focusCode: 7 }
    parsed.allowedCodes = [firstCode, '不存在的色号']
    const result = parseProject(JSON.stringify(parsed))
    expect(result.project).not.toBeNull()
    expect(result.error?.kind).toBe('recovered')
    expect(result.project!.view.zoom).toBe(8)
    expect(result.project!.view.showCodes).toBe(true)
    expect(result.project!.making.completedCodes).toEqual([])
    expect(result.project!.making.focusCode).toBeNull()
    expect(result.project!.allowedCodes).toEqual([firstCode])
  })

  it('板外空档里的脏数据会清掉，并且明确告知清了几格', () => {
    const project = sampleProject()
    project.layout = {
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    }
    const geometry = deriveLayoutGeometry(project.layout)
    project.grid = createGrid(geometry.cols, geometry.rows, EMPTY, geometry.placeable)
    // 序列化会顺手清干净，所以直接改压缩数据造一份“坏文件”
    const hole = 60 * geometry.cols + 120
    const result = parseProject(patchCell(serializeProject(project), hole, 8))
    expect(result.error?.kind).toBe('recovered')
    expect(result.error?.message).toContain('空档')
    expect(result.project!.grid.cells[hole]).toBe(EMPTY)
  })

  it('空档里的脏数据不会拉高豆数与色数', () => {
    const project = sampleProject()
    project.layout = {
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    }
    const geometry = deriveLayoutGeometry(project.layout)
    project.grid = createGrid(geometry.cols, geometry.rows, EMPTY, geometry.placeable)
    project.grid.cells[0] = 3
    const parsed = parseProject(patchCell(serializeProject(project), 60 * geometry.cols + 120, 8))
    expect(parsed.project!.grid.cells[0]).toBe(3)
    expect(projectSummary(parsed.project!).beads).toBe(1)
  })

  it('IndexedDB 形状（未压缩的 Uint16Array）走同一套校验', () => {
    const project = sampleProject()
    expect(validateProject(project)?.project).not.toBeNull()
    const result = validateProject(project)!
    expect(result.error).toBeNull()
    expect(gridEquals(result.project!.grid, project.grid)).toBe(true)
  })

  it('IndexedDB 形状的坏数据也会被拦住', () => {
    const project = sampleProject()
    expect(validateProject({ ...project, grid: { cols: 0, rows: 0, cells: new Uint16Array(0) } })).toMatchObject({
      project: null,
    })
    expect(validateProject({ ...project, grid: { cols: 52, rows: 52, cells: 'x' } }).error?.kind).toBe(
      'fatal',
    )
  })
})

/** 往导出的工程文件里手工改一格：用来造“空档里有脏数据”的坏文件 */
function patchCell(text: string, index: number, value: number): string {
  const parsed = JSON.parse(text) as { grid: { data: string } }
  const raw = Uint8Array.from(atob(parsed.grid.data), (ch) => ch.charCodeAt(0))
  const cells = new Uint16Array(unzlibSync(raw).buffer)
  cells[index] = value
  let out = ''
  for (const byte of zlibSync(new Uint8Array(cells.buffer), { level: 6 })) {
    out += String.fromCharCode(byte)
  }
  parsed.grid.data = btoa(out)
  return JSON.stringify(parsed)
}

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

  it('板外空档里的脏数据不算豆、不算色', () => {
    const project = sampleProject()
    project.layout = {
      placements: [
        { board: 'mini104', col: 0, row: 0 },
        { board: 'mini52', col: 104, row: 0 },
      ],
      gapMm: 0,
    }
    const geometry = deriveLayoutGeometry(project.layout)
    project.grid = createGrid(geometry.cols, geometry.rows, EMPTY, geometry.placeable)
    project.grid.cells[0] = 3
    project.grid.cells[60 * geometry.cols + 120] = 8
    const summary = projectSummary(project)
    expect(summary.beads).toBe(1)
    expect(summary.colorCount).toBe(1)
  })

  it('gapMm 进入成品尺寸', () => {
    const project = sampleProject()
    project.layout = {
      placements: [
        { board: 'mini52', col: 0, row: 0 },
        { board: 'mini52', col: 52, row: 0 },
      ],
      gapMm: 1.5,
    }
    expect(projectSummary(project).sizeMm.w).toBeCloseTo(104 * 2.6 + 1.5, 6)
  })
})
