import { jsPDF } from 'jspdf'

import type { Rgb } from '../conversion/colorDistance'
import { PT_PER_MM } from '../domain/geometry'

/**
 * PDF 写入的一层薄封装。
 *
 * 全项目只有这里碰 jsPDF。两套渲染（屏幕版 / 纸面版）都只对着 PdfSink 写，
 * 这样测试里可以换成一个记账用的假 sink，而真 PDF 里断言内容流即可。
 *
 * 坐标约定：**一律是 PDF 点、原点在左下角**（第 7 节那套数学算出来的就是这个）。
 * jsPDF 自己的 text() 收的是"从上面量"的 y，所以在 text() 里翻一次，别的地方不翻。
 */
export interface PdfSink {
  readonly pageWidth: number
  readonly pageHeight: number
  /** 按色分桶用：设一次填充色，追加一批 re，最后一次 fill */
  fillColor(rgb: Rgb): void
  /** 文字填充色必须走 jsPDF 自己的状态，裸 rg 会被它随后的 g 覆盖掉 */
  textColor(rgb: Rgb): void
  strokeColor(rgb: Rgb): void
  lineWidth(pt: number): void
  dash(pattern: number[]): void
  /** 透明度（重叠带底色用）。1 = 不透明 */
  opacity(value: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  text(str: string, x: number, baselineY: number, sizePt: number, mode: 'fill' | 'fillstroke'): void
  /** 一批同字号同颜色的文字：一条 BT/ET，每格一个显式 Tm；比逐次 text() 省一半样板 */
  textBatch(
    items: Array<{ text: string; x: number; baselineY: number }>,
    sizePt: number,
    fill: Rgb,
    mode: 'fill' | 'fillstroke',
  ): void
  addPage(widthPt: number, heightPt: number): void
  pageCount(): number
  /** 只要内容流（测试和体积估算用），索引从 0 开始 */
  contentStream(pageIndex: number): string
  output(): Uint8Array
}

export interface JsPdfOptions {
  widthPt: number
  heightPt: number
}

/**
 * 数字格式化：固定小数位、去掉多余的零，保证同样的输入产出同样的字节。
 *
 * 4 位小数改成 3 位是量过的：1.3M 个矩形的坐标从 "2974.4252" 变成 "2974.425"，
 * Flate 压缩率明显变好。3 位小数 = 0.001pt ≈ 0.00035mm，比打印精度高三个数量级。
 */
export function fmt(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function rgb01(rgb: Rgb): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]
}

/**
 * PDF 里的颜色串（0-1，四位小数）。
 * ⚠️ PdfSink 全线收 0-255 的 Rgb，别自己先除一遍 —— 除两次会让红色变成 0.0032。
 */
export function pdfRgb(rgb: Rgb): string {
  return rgb01(rgb).map(fmt).join(' ')
}

/** 灰度（0-1）转成 0-255，方便和 Rgb 混用 */
export function gray255(gray: number): Rgb {
  return [Math.round(gray * 255), Math.round(gray * 255), Math.round(gray * 255)]
}

function escapeText(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

class JsPdfSink implements PdfSink {
  private doc: jsPDF
  readonly pageWidth: number
  readonly pageHeight: number

  constructor(options: JsPdfOptions) {
    this.pageWidth = options.widthPt
    this.pageHeight = options.heightPt
    this.doc = new jsPDF({
      unit: 'pt',
      format: [options.widthPt, options.heightPt],
      orientation: options.widthPt > options.heightPt ? 'landscape' : 'portrait',
      compress: true,
    })
    this.doc.setFont('helvetica', 'normal')
  }

  /**
   * 直接往内容流里写 PDF 操作符。
   * jsPDF 的高级方法一次只能画一个矩形（每格一次填充），按色分桶必须走裸操作符。
   * `internal.out` 没进类型定义，这里断言一次并用 `scripts/verify-pdf.mjs` 盯着产物。
   */
  private raw(op: string): void {
    const internal = this.doc.internal as unknown as { out: (chunk: string) => void }
    internal.out(op)
  }

  fillColor(rgb: Rgb): void {
    this.raw(`${pdfRgb(rgb)} rg`)
  }

  textColor(rgb: Rgb): void {
    this.doc.setTextColor(rgb[0], rgb[1], rgb[2])
  }

  strokeColor(rgb: Rgb): void {
    this.raw(`${pdfRgb(rgb)} RG`)
  }

  lineWidth(pt: number): void {
    this.raw(`${fmt(pt)} w`)
  }

  dash(pattern: number[]): void {
    this.raw(`[${pattern.map(fmt).join(' ')}] 0 d`)
  }

  opacity(value: number): void {
    const api = this.doc as unknown as {
      GState: new (options: { opacity: number }) => unknown
      setGState: (state: unknown) => void
    }
    api.setGState(new api.GState({ opacity: value }))
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.raw(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`)
  }

  fill(): void {
    this.raw('f')
  }

  moveTo(x: number, y: number): void {
    this.raw(`${fmt(x)} ${fmt(y)} m`)
  }

  lineTo(x: number, y: number): void {
    this.raw(`${fmt(x)} ${fmt(y)} l`)
  }

  stroke(): void {
    this.raw('S')
  }

  /**
   * 一批同字号同颜色的文字：一条 BT/ET，每格一个**显式 Tm**。
   * 比逐次调用 jsPDF 的 text() 省掉一半样板（53 万个对象时是几 MB 的差别），
   * 而且绝不用 `'` 操作符 —— 那玩意会先换行再显示，逐格定位必然偏行（第 11.2 节踩过的坑）。
   */
  textBatch(
    items: Array<{ text: string; x: number; baselineY: number }>,
    sizePt: number,
    fill: Rgb,
    mode: 'fill' | 'fillstroke',
  ): void {
    if (items.length === 0) return
    const font = (this.doc.internal as unknown as { getFont: () => { id?: string } }).getFont()
    const fontId = `/${font?.id ?? 'F1'}`
    this.raw('BT')
    this.raw(`${fontId} ${fmt(Math.round(sizePt * 100) / 100)} Tf`)
    this.raw(`${pdfRgb(fill)} rg`)
    if (mode === 'fillstroke') this.raw('2 Tr')
    for (const item of items) {
      // 绝对定位：用 Tm，不用 Td（Td 相对上一次行矩阵，会累积）
      this.raw(`1 0 0 1 ${fmt(item.x)} ${fmt(item.baselineY)} Tm (${escapeText(item.text)}) Tj`)
    }
    this.raw('ET')
  }

  text(str: string, x: number, baselineY: number, sizePt: number, mode: 'fill' | 'fillstroke'): void {
    this.doc.setFontSize(sizePt)
    if (mode === 'fillstroke') {
      // 中间调的光环：先设描边色和线宽，再让 jsPDF 出 2 Tr
      this.doc.text(escapeText(str), x, this.pageHeight - baselineY, {
        renderingMode: 'fillThenStroke',
      })
    } else {
      this.doc.text(escapeText(str), x, this.pageHeight - baselineY)
    }
  }

  addPage(widthPt: number, heightPt: number): void {
    this.doc.addPage([widthPt, heightPt], widthPt > heightPt ? 'landscape' : 'portrait')
  }

  pageCount(): number {
    return this.doc.getNumberOfPages()
  }

  /**
   * 内容流（未压缩）。jsPDF 内部把每页存成"块的数组"，直接 String() 会得到逗号拼接的
   * 垃圾，必须 join('') 才是真正的 PDF 操作符流。
   */
  contentStream(pageIndex: number): string {
    const page = this.doc.internal.pages[pageIndex + 1] as unknown
    // jsPDF 写出真正的 PDF 时是用 \n 把块拼起来的（解压产物验证过），这里保持一致
    if (Array.isArray(page)) return page.join('\n')
    return String(page ?? '')
  }

  output(): Uint8Array {
    return new Uint8Array(this.doc.output('arraybuffer'))
  }
}

export function createPdfSink(options: JsPdfOptions): PdfSink {
  return new JsPdfSink(options)
}

/** 记账用的假 sink：只为了断言"画了什么"，不产生真 PDF */
export class RecordingSink implements PdfSink {
  ops: Array<{ op: string; args: Array<number | string> }> = []
  readonly pageWidth: number
  readonly pageHeight: number
  pages = 1
  private currentFill: Rgb = [0, 0, 0]
  private currentStroke: Rgb = [0, 0, 0]

  constructor(widthPt: number, heightPt: number) {
    this.pageWidth = widthPt
    this.pageHeight = heightPt
  }

  fillColor(rgb: Rgb): void {
    this.currentFill = rgb
    this.ops.push({ op: 'fillColor', args: [...rgb] })
  }
  textColor(rgb: Rgb): void {
    this.ops.push({ op: 'textColor', args: [...rgb] })
  }
  strokeColor(rgb: Rgb): void {
    this.currentStroke = rgb
    this.ops.push({ op: 'strokeColor', args: [...rgb] })
  }
  lineWidth(pt: number): void {
    this.ops.push({ op: 'lineWidth', args: [pt] })
  }
  dash(pattern: number[]): void {
    this.ops.push({ op: 'dash', args: [...pattern] })
  }
  opacity(value: number): void {
    this.ops.push({ op: 'opacity', args: [value] })
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ op: 'rect', args: [x, y, w, h] })
  }
  fill(): void {
    this.ops.push({ op: 'fill', args: [...this.currentFill] })
  }
  moveTo(x: number, y: number): void {
    this.ops.push({ op: 'moveTo', args: [x, y] })
  }
  lineTo(x: number, y: number): void {
    this.ops.push({ op: 'lineTo', args: [x, y] })
  }
  stroke(): void {
    this.ops.push({ op: 'stroke', args: [...this.currentStroke] })
  }
  text(str: string, x: number, y: number, sizePt: number, mode: 'fill' | 'fillstroke'): void {
    this.ops.push({ op: 'text', args: [str, x, y, sizePt, mode] })
  }
  textBatch(
    items: Array<{ text: string; x: number; baselineY: number }>,
    sizePt: number,
    fill: Rgb,
    mode: 'fill' | 'fillstroke',
  ): void {
    this.ops.push({ op: 'textBatch', args: [String(items.length), sizePt, mode, ...fill] })
  }
  addPage(): void {
    this.pages++
    this.ops.push({ op: 'addPage', args: [] })
  }
  pageCount(): number {
    return this.pages
  }
  contentStream(): string {
    return ''
  }
  output(): Uint8Array {
    return new Uint8Array(0)
  }
}

/** 内容流统计：验收里那些"填充操作数 / 文字对象数"就是数这个 */
export function countStreamOps(stream: string) {
  const count = (re: RegExp) => (stream.match(re) ?? []).length
  return {
    // 各自锚定行首，别把同一行算两遍（jsPDF 每个操作符独占一行）
    fillOps: count(/^f[\s\n]/gm),
    strokeOps: count(/^S[\s\n]/gm),
    rectOps: count(/ re[\s\n]/g),
    textObjects: count(/Tj/g),
    textMoves: count(/ Td[\s\n]/g) + count(/ Tm[\s\n]/g),
    images: count(/\/XObject/g) + count(/\/Image/g),
    bytes: stream.length,
  }
}

export { PT_PER_MM }
