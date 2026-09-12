import { zipSync } from 'fflate'

import type { BoardGeometry } from '../domain/board'
import type { CellGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { bomToCsv, buildBom } from './bom'
import { paperLayout, screenLayout } from './documentLayout'
import { renderPaperPdf } from './documentPaper'
import { renderScreenPdf } from './documentScreen'
import { createPdfSink } from './pdf'
import { drawPreview, planPreview } from './previewImage'

/**
 * 导出编排：只负责"调渲染 + 组装文件 + 触发下载"，不含任何排版数学。
 * 三种导出（预览图 PNG / 屏幕版 PDF / 纸面版 PDF）在 UI 上是可勾选的清单。
 */
export interface ExportContext {
  grid: CellGrid
  palette: Palette
  geom: BoardGeometry
  pitchMm: number
  name: string
}

export interface ScreenExportOptions {
  showCodes: boolean
  includeBom: boolean
}

export function buildScreenPdf(ctx: ExportContext, options: ScreenExportOptions): Uint8Array {
  const layout = screenLayout(ctx.grid, ctx.pitchMm, {
    showCodes: options.showCodes,
    includeBom: options.includeBom,
  })
  const sink = createPdfSink({
    widthPt: layout.pageMm.w * PT_PER_MM,
    heightPt: layout.pageMm.h * PT_PER_MM,
  })
  renderScreenPdf(sink, {
    grid: ctx.grid,
    palette: ctx.palette,
    geom: ctx.geom,
    pitchMm: ctx.pitchMm,
    pitchLabel: ctx.pitchMm,
    showCodes: options.showCodes,
    includeBom: options.includeBom,
  })
  return sink.output()
}

export interface PaperExportOptions {
  boards?: BoardGeometry['boards']
  marginMm?: number
  overlap?: number
  showCodes?: boolean
  includeBom?: boolean
  instructions?: boolean
}

export function buildPaperPdf(ctx: ExportContext, options: PaperExportOptions): Uint8Array {
  const sink = createPdfSink({ widthPt: 210 * PT_PER_MM, heightPt: 297 * PT_PER_MM })
  renderPaperPdf(sink, {
    grid: ctx.grid,
    palette: ctx.palette,
    geom: ctx.geom,
    pitchMm: ctx.pitchMm,
    pitchLabel: ctx.pitchMm,
    showCodes: options.showCodes,
    includeBom: options.includeBom,
    marginMm: options.marginMm,
    overlap: options.overlap,
    boards: options.boards,
    instructions: options.instructions,
  })
  return sink.output()
}

/**
 * 超大图整图导出：**zip，每块板一个单页 PDF** —— 拼完一块印一块。
 * 里面附一个总览图和用量 CSV。
 */
export function buildPaperZip(ctx: ExportContext, options: PaperExportOptions = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {}

  for (const board of ctx.geom.boards) {
    const sink = createPdfSink({ widthPt: 210 * PT_PER_MM, heightPt: 297 * PT_PER_MM })
    renderPaperPdf(sink, {
      grid: ctx.grid,
      palette: ctx.palette,
      geom: ctx.geom,
      pitchMm: ctx.pitchMm,
      pitchLabel: ctx.pitchMm,
      showCodes: options.showCodes,
      includeBom: false,
      marginMm: options.marginMm,
      overlap: options.overlap,
      boards: [board],
    })
    // 命名格式：板-r{行}c{列}-{板型}.pdf（第 11.3 节）
    const name = `板-r${board.row + 1}c${board.col + 1}-${board.cw}.pdf`
    files[name] = sink.output()
  }

  files['用量.csv'] = new TextEncoder().encode(
    bomToCsv(buildBom(ctx.grid, ctx.palette), ctx.palette.displayName),
  )
  files['总览.txt'] = new TextEncoder().encode(overviewText(ctx, options))

  return zipSync(files, { level: 6 })
}

function overviewText(ctx: ExportContext, options: PaperExportOptions): string {
  const rows = buildBom(ctx.grid, ctx.palette)
  const total = rows.reduce((n, r) => n + r.count, 0)
  const layout = paperLayout(ctx.grid, ctx.pitchMm, {
    marginMm: options.marginMm,
    overlap: options.overlap,
    boards: ctx.geom.boards,
  })
  return [
    `${ctx.name}`,
    `色板：${ctx.palette.displayName}`,
    `针距：${ctx.pitchMm}mm`,
    `板阵：${ctx.geom.boards.length} 块板，${ctx.geom.cols} × ${ctx.geom.rows} 格`,
    `成品尺寸：${(ctx.geom.cols * ctx.pitchMm).toFixed(1)} × ${(ctx.geom.rows * ctx.pitchMm).toFixed(1)} mm`,
    `豆数合计：${total}`,
    `色数：${rows.length}`,
    `打印页数：${layout.sheets.length}（每块板 1-2 张 A4）`,
    '',
    '打印请选 100% / 实际大小，关闭"适合页面"。每页页脚都有 100mm 校准尺，量一下必须是 100.0mm。',
    '拼接方法见每块板 PDF 里的说明页。',
  ].join('\n')
}

export interface PreviewExportOptions {
  pxPerCell: number
  showCoords?: boolean
}

/** 预览图 PNG：给客户看效果、确认像不像 */
export async function buildPreviewPng(
  ctx: ExportContext,
  options: PreviewExportOptions,
): Promise<Uint8Array> {
  const plan = planPreview(ctx.grid, options.pxPerCell)
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(plan.width, plan.height)
      : Object.assign(document.createElement('canvas'), {
          width: plan.width,
          height: plan.height,
        })
  const context = canvas.getContext('2d')
  if (!context) throw new Error('拿不到 2D 上下文，预览图导出失败')
  drawPreview(context as unknown as CanvasRenderingContext2D, {
    grid: ctx.grid,
    palette: ctx.palette,
    pxPerCell: options.pxPerCell,
    showCoords: options.showCoords,
  })
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error('预览图导出失败')
  return new Uint8Array(await blob.arrayBuffer())
}

export function buildBomCsv(ctx: ExportContext): Uint8Array {
  return new TextEncoder().encode(bomToCsv(buildBom(ctx.grid, ctx.palette), ctx.palette.displayName))
}

// ---------------------------------------------------------------------------
// 浏览器下载
// ---------------------------------------------------------------------------

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeName(name: string): string {
  return (name || '作品').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
}
