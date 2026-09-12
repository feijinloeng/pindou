import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { deriveGeometry } from '../domain/board'
import { createGrid } from '../domain/grid'
import { getPalette } from '../data/palettes'
import { buildExportBundle, estimateExport, type ExportContext, type ExportSelection } from './exporters'

function context(): ExportContext {
  const grid = createGrid(26, 26)
  for (let i = 0; i < grid.cells.length; i++) grid.cells[i] = i % 3
  return {
    grid,
    palette: getPalette('mard-291'),
    geom: deriveGeometry({ rows: [['mini26']], gapMm: 0 }),
    pitchMm: 5,
    name: '测试作品',
  }
}

const base: ExportSelection = {
  preview: false,
  screen: false,
  paper: false,
  csv: false,
  paperScope: 'boards',
  showCodes: false,
  screenCodes: true,
  screenBom: true,
  previewScale: 16,
}

describe('导出预估（P2-23/P2-24）', () => {
  it('预览图被上限压低时提前说清楚实际像素', () => {
    const ctx = context()
    // 500 万格选 32px/格：远超单张 16384px 与 1 亿像素的上限
    const big = createGrid(2236, 2236)
    const estimate = estimateExport({ ...ctx, grid: big }, { ...base, preview: true, previewScale: 32 })
    expect(estimate.previewClamped).toBe(true)
    expect(estimate.previewActual).toBeLessThan(32)
    expect(estimate.warnings.join(' ')).toContain('降到')
    expect(estimate.previewWidth).toBeLessThanOrEqual(16384)
  })

  it('小图不降级也不报警', () => {
    const estimate = estimateExport(context(), { ...base, preview: true, previewScale: 16 })
    expect(estimate.previewClamped).toBe(false)
    expect(estimate.previewWidth).toBe(26 * 16)
    expect(estimate.warnings).toEqual([])
  })

  it('页数在导出前就算得出来（屏幕版每页都有内容、按板导出页数 > 0）', () => {
    const estimate = estimateExport(context(), { ...base, screen: true, paper: true })
    expect(estimate.screenPages).toBe(1)
    expect(estimate.paperPages).toBe(1)
  })
})

describe('导出打包', () => {
  it('勾了一项就只下一个文件，不白套一层 zip', async () => {
    const bundle = await buildExportBundle(context(), { ...base, screen: true })
    expect(bundle.files).toBe(1)
    expect(bundle.filename).toBe('测试作品-屏幕版.pdf')
    expect(String.fromCharCode(...bundle.bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('勾了多项打成一个 zip：一次手势只触发一个下载，浏览器不会拦', async () => {
    const bundle = await buildExportBundle(context(), { ...base, screen: true, csv: true, paper: true })
    expect(bundle.files).toBe(3)
    expect(bundle.filename).toBe('测试作品.zip')
    expect(bundle.mime).toBe('application/zip')
    expect(String.fromCharCode(...bundle.bytes.slice(0, 2))).toBe('PK')
    const entries = Object.keys(unzipSync(bundle.bytes)).sort()
    expect(entries).toEqual(['测试作品-屏幕版.pdf', '测试作品-纸面版.pdf', '测试作品-用量.csv'].sort())
  })

  it('按板导出本来就是 zip：摊进总包，不套娃', async () => {
    const bundle = await buildExportBundle(context(), {
      ...base,
      paper: true,
      paperScope: 'zip',
      csv: true,
    })
    const entries = Object.keys(unzipSync(bundle.bytes))
    expect(entries.some((name) => name.endsWith('.zip'))).toBe(false)
    expect(entries).toContain('用量.csv')
    expect(entries.some((name) => name.endsWith('.pdf'))).toBe(true)
  })

  it('按板 zip 里有一份中文打印说明，且带 BOM（记事本不乱码）', async () => {
    const bundle = await buildExportBundle(context(), {
      ...base,
      paper: true,
      paperScope: 'zip',
      csv: true,
    })
    const files = unzipSync(bundle.bytes)
    const notes = files['打印说明.txt']
    expect(notes).toBeInstanceOf(Uint8Array)
    // UTF-8 BOM
    expect([...notes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(notes.slice(3))
    // 打印缩放这一条是 1:1 能不能成立的关键，必须写清楚
    expect(text).toContain('100%')
    expect(text).toContain('适合页面')
    expect(text).toContain('校准尺')
    // 总览也要 BOM
    expect([...files['总览.txt'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('一个都没勾就报错，不生成空文件', async () => {
    await expect(buildExportBundle(context(), base)).rejects.toThrow(/一个导出项都没勾/)
  })
})
