import { unzipSync, zipSync } from 'fflate'

import type { BoardGeometry } from '../domain/board'
import type { CellGrid } from '../domain/grid'
import { PT_PER_MM } from '../domain/geometry'
import type { Palette } from '../domain/palette'
import { bomPageCount, bomToCsv, buildBom } from './bom'
import { paletteDisplayLabel } from '../domain/palette'
import { paperLayout, screenLayout } from './documentLayout'
import { renderPaperPdf } from './documentPaper'
import { renderScreenPdf } from './documentScreen'
import { createPdfSink } from './pdf'
import { drawPreview, planPreview } from './previewImage'
import { exportFilename, safeName } from './download'

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

async function createExportPdfSink(options: { widthPt: number; heightPt: number }) {
  const { PINDOU_BOM_CJK_FONT_BASE64 } = await import('./fonts/pindouBomCjk.ts')
  return createPdfSink({ ...options, cjkFontBase64: PINDOU_BOM_CJK_FONT_BASE64 })
}

export async function buildScreenPdf(ctx: ExportContext, options: ScreenExportOptions): Promise<Uint8Array> {
  const layout = screenLayout(ctx.grid, ctx.pitchMm, {
    showCodes: options.showCodes,
    includeBom: options.includeBom,
  })
  const sink = await createExportPdfSink({
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
  /** 兼容旧调用：多个板会合并成一个连续外接范围 */
  boards?: BoardGeometry['boards']
  marginMm?: number
  overlap?: number
  showCodes?: boolean
  includeBom?: boolean
  instructions?: boolean
}

export async function buildPaperPdf(ctx: ExportContext, options: PaperExportOptions): Promise<Uint8Array> {
  const renderOptions = {
    marginMm: options.marginMm,
    overlap: options.overlap,
    showCodes: options.showCodes ?? true,
    includeBom: options.includeBom ?? true,
    boards: options.boards,
  }
  const layout = paperLayout(ctx.grid, ctx.pitchMm, renderOptions)
  const sink = await createExportPdfSink({
    widthPt: layout.pageMm.w * PT_PER_MM,
    heightPt: layout.pageMm.h * PT_PER_MM,
  })
  renderPaperPdf(sink, {
    grid: ctx.grid,
    palette: ctx.palette,
    geom: ctx.geom,
    pitchMm: ctx.pitchMm,
    pitchLabel: ctx.pitchMm,
    ...renderOptions,
    instructions: options.instructions,
    projectName: ctx.name,
  })
  return sink.output()
}

/**
 * 整图打印资料包：一份连续分页的 A4 PDF，加上用量清单和中文说明文本。
 * 旧版本这里按板拆 PDF；现在必须按整张板阵分页，避免每块板旁边留下大量空白。
 */
export async function buildPaperZip(ctx: ExportContext, options: PaperExportOptions = {}): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  files['打印版.pdf'] = await buildPaperPdf(ctx, {
    ...options,
    boards: undefined,
    showCodes: options.showCodes ?? true,
    includeBom: true,
    instructions: true,
  })

  files['用量.csv'] = buildBomCsv(ctx)
  // 带 BOM：Windows 记事本不认没有 BOM 的 UTF-8，中文会变乱码
  files['总览.txt'] = utf8WithBom(overviewText(ctx, options))
  files['打印说明.txt'] = utf8WithBom(printNotes(ctx, options))

  return zipSync(files, { level: 6 })
}

function utf8WithBom(text: string): Uint8Array {
  const body = new TextEncoder().encode(text)
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}

/** 中文打印说明（资料包内的文字版，PDF 末页也有同一套说明）。 */
function printNotes(ctx: ExportContext, options: PaperExportOptions): string {
  const mm = (n: number) => n.toFixed(1)
  const layout = paperLayout(ctx.grid, ctx.pitchMm, {
    marginMm: options.marginMm,
    overlap: options.overlap,
    showCodes: options.showCodes ?? true,
    includeBom: true,
  })
  return [
    `《${ctx.name}》打印说明`,
    '',
    '一、打印设置',
    `  1. 纸张选 A4，方向按每页页眉标注（${layout.orientation === 'landscape' ? '横向' : '纵向'}）。`,
    '  2. 缩放必须选「100%」「实际大小」，或把缩放设为「无」。',
    '     绝对不要选「适合页面」「适应边框」——那样每格的针距就不是 1:1 了。',
    '  3. 打印完先量第一页页脚的 100 毫米校准尺。量出来不是 100.0 毫米就回去改缩放。',
    '',
    '二、拼接',
    `  1. 成品总尺寸约 ${mm(ctx.geom.cols * ctx.pitchMm)} × ${mm(ctx.geom.rows * ctx.pitchMm)} 毫米，`,
    `     共 ${ctx.geom.boards.length} 块底板、${ctx.geom.cols} × ${ctx.geom.rows} 格、针距 ${ctx.pitchMm} 毫米。`,
    `  2. 相邻两页有 ${layout.overlap} 格重叠内容。红色虚线围出的区域不要裁掉，先让相同颜色、格线和对位十字重合。`,
    '     对齐后从纸背面贴胶带；误差不会随着页数一直累积。',
    '  3. 按页码拼：先从左到右拼成一排，再把各排从上到下接起来。',
    '',
    '三、照着摆豆',
    '  1. 把打印稿垫在透明底板下面，从上往下、从左往右，一格一颗。',
    '  2. 每一格上的色号就是这一颗豆的色号；区域中间的大号字是那一片的主色。',
    '  3. 页边的数字是坐标，拼到一半走神了可以靠它找位置。',
    '  4. 色用量见最后的清单页，也会附一份「用量.csv」，可用表格软件打开。',
    '',
    `色板：${printPaletteLabel(ctx.palette)}`,
    `纸样：${layout.pages?.length ?? layout.sheets.length} 张 A4，1:1 矢量 PDF，放大不会糊。`,
  ].join('\n')
}

function overviewText(ctx: ExportContext, options: PaperExportOptions): string {
  const rows = buildBom(ctx.grid, ctx.palette)
  const total = rows.reduce((n, r) => n + r.count, 0)
  const layout = paperLayout(ctx.grid, ctx.pitchMm, {
    marginMm: options.marginMm,
    overlap: options.overlap,
  })
  return [
    `${ctx.name}`,
    `色板：${printPaletteLabel(ctx.palette)}`,
    `针距：${ctx.pitchMm} 毫米`,
    `板阵：${ctx.geom.boards.length} 块板，${ctx.geom.cols} × ${ctx.geom.rows} 格`,
    `成品尺寸：${(ctx.geom.cols * ctx.pitchMm).toFixed(1)} × ${(ctx.geom.rows * ctx.pitchMm).toFixed(1)} 毫米`,
    `豆数合计：${total}`,
    `色数：${rows.length}`,
    `纸样页数：${layout.pages?.length ?? layout.sheets.length} 张 A4（方向：${layout.orientation === 'landscape' ? '横向' : '纵向'}）`,
    `重叠带：${layout.overlap} 格；PDF 末尾另附 ${bomPageCount(rows.length, layout.pageMm.h * PT_PER_MM)} 页用量清单和 1 页使用说明`,
    '',
    '打印请选 100% / 实际大小，关闭"适合页面"。每页页脚都有 100 毫米校准尺，量一下必须是 100.0 毫米。',
    '拼接方法见打印 PDF 最后一页的中文使用说明。',
  ].join('\n')
}

function printPaletteLabel(palette: Palette): string {
  return paletteDisplayLabel(palette).replace(/\bmm\b/gi, '毫米')
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
    boards: ctx.geom.boards,
  })
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
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
  return new TextEncoder().encode(bomToCsv(buildBom(ctx.grid, ctx.palette), paletteDisplayLabel(ctx.palette)))
}

// ---------------------------------------------------------------------------
// 浏览器下载
// ---------------------------------------------------------------------------

/** 预览图 PNG 的降级警告：实际像素和用户以为的不一致时必须说出来（P2-24） */
export interface ExportEstimate {
  /** 预览图实际像素 */
  previewWidth: number
  previewHeight: number
  /** 用户选的 px/格 */
  previewRequested: number
  /** 实际生效的 px/格（可能因为上限被降） */
  previewActual: number
  previewClamped: boolean
  /** 预览图像素缓冲的粗略内存（字节） */
  previewBytes: number
  screenPages: number
  paperPages: number
  paperBomPages: number
  warnings: string[]
}

/** 超过这么多像素缓冲就先提醒一句：100MP × 4B = 400MB，真的会崩标签页 */
export const PREVIEW_WARN_BYTES = 150 * 1024 * 1024

/**
 * 导出前的估算：一次算完，界面直接显示。
 * 只算尺寸和页数，不碰像素，所以可以在渲染里同步调。
 */
export function estimateExport(
  ctx: ExportContext,
  selection: ExportSelection,
): ExportEstimate {
  const plan = planPreview(ctx.grid, selection.previewScale)
  const warnings: string[] = []
  if (selection.preview && plan.clamped) {
    warnings.push(
      `预览图超过单张上限，每格已从 ${selection.previewScale}px 降到 ${plan.pxPerCell.toFixed(2)}px（实际 ${plan.width}×${plan.height}）`,
    )
  }
  const previewBytes = plan.width * plan.height * 4
  if (selection.preview && previewBytes > PREVIEW_WARN_BYTES) {
    warnings.push(
      `预览图约 ${plan.width}×${plan.height}，需要大约 ${Math.round(previewBytes / 1024 / 1024)}MB 内存，导出时会卡一阵`,
    )
  }
  const screenPages = selection.screen
    ? screenLayout(ctx.grid, ctx.pitchMm, {
        showCodes: selection.screenCodes,
        includeBom: selection.screenBom,
      }).sheets.length
    : 0
  const paperPages = selection.paper
    ? paperLayout(ctx.grid, ctx.pitchMm, {
        overlap: selection.paperOverlap,
        showCodes: selection.showCodes,
        includeBom: true,
      })
    : null
  const paperBomPages = paperPages
    ? bomPageCount(buildBom(ctx.grid, ctx.palette).length, paperPages.pageMm.h * PT_PER_MM)
    : 0
  return {
    previewWidth: plan.width,
    previewHeight: plan.height,
    previewRequested: selection.previewScale,
    previewActual: plan.pxPerCell,
    previewClamped: plan.clamped,
    previewBytes,
    screenPages,
    paperPages: paperPages?.pages?.length ?? paperPages?.sheets.length ?? 0,
    paperBomPages,
    warnings,
  }
}

export interface ExportSelection {
  preview: boolean
  screen: boolean
  paper: boolean
  /** `boards` is retained as a legacy alias; both non-zip modes export the whole layout. */
  paperScope: 'whole' | 'boards' | 'zip'
  showCodes: boolean
  /** 相邻 A4 纸页共享的格数，默认 3 格 */
  paperOverlap?: number
  /** 屏幕版的色号（默认开）与末页用量清单 */
  screenCodes: boolean
  screenBom: boolean
  previewScale: number
}

export interface ExportBundle {
  bytes: Uint8Array
  filename: string
  mime: string
  /** 包了几个文件（1 = 没打包，直接就是那个文件） */
  files: number
  /** 降级 / 风险提示，界面要把它们说出来 */
  warnings: string[]
}

/**
 * 一次用户手势只能可靠地触发**一个**下载：勾了多个格式就打包成一个 zip。
 * 以前一个 run() 里连发 3-5 个下载，浏览器会拦截、只放行第一个，或者弹一堆权限提示。
 */
export async function buildExportBundle(
  ctx: ExportContext,
  selection: ExportSelection,
): Promise<ExportBundle> {
  const base = safeName(ctx.name)
  const files: Record<string, Uint8Array> = {}
  const warnings = estimateExport(ctx, selection).warnings
  if (selection.preview) {
    files[exportFilename(1, base, '预览图', 'png')] = await buildPreviewPng(ctx, {
      pxPerCell: selection.previewScale,
    })
  }
  if (selection.screen) {
    files[exportFilename(2, base, '矢量版', 'pdf')] = await buildScreenPdf(ctx, {
      showCodes: selection.screenCodes,
      includeBom: selection.screenBom,
    })
  }
  if (selection.paper && selection.paperScope !== 'zip') {
    files[exportFilename(3, base, '打印版', 'pdf')] = await buildPaperPdf(ctx, {
      showCodes: selection.showCodes,
      overlap: selection.paperOverlap,
      includeBom: true,
      instructions: true,
    })
  }
  if (selection.paper && selection.paperScope === 'zip') {
    // 按板导出本身就是 zip：摊开合进总包，不套娃
    Object.assign(
      files,
      unzipSync(
        await buildPaperZip(ctx, {
          showCodes: selection.showCodes,
          overlap: selection.paperOverlap,
        }),
      ),
    )
  }
  const names = Object.keys(files)
  if (names.length === 0) throw new Error('一个导出项都没勾')
  if (names.length === 1) {
    const only = names[0]
    return { bytes: files[only], filename: only, mime: mimeOf(only), files: 1, warnings }
  }
  return {
    bytes: zipSync(files, { level: 6 }),
    filename: `${base}.zip`,
    mime: 'application/zip',
    files: names.length,
    warnings,
  }
}

function mimeOf(filename: string): string {
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.pdf')) return 'application/pdf'
  if (filename.endsWith('.csv')) return 'text/csv;charset=utf-8'
  return 'application/octet-stream'
}
