import { describe, expect, it } from 'vitest'

import { EMPTY, createGrid } from '../domain/grid'
import { DEMO_PALETTE } from '../domain/palette'
import { BOARD_BG, STAGE_BG, drawPattern } from './drawPattern'
import type { Viewport } from './canvasViewport'

interface Rect {
  x: number
  y: number
  w: number
  h: number
  fill: string
}

/** 只记 fillRect / fillText 的假 ctx，用来断言画了什么、画了多少 */
function fakeCtx() {
  const rects: Rect[] = []
  const texts: Array<{ text: string; x: number; y: number; fill: string }> = []
  const strokes: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    rects,
    texts,
    strokes,
    setTransform() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      strokes.push(String(this.strokeStyle))
    },
    strokeRect() {},
    rect() {},
    setLineDash() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: String(this.fillStyle) })
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fill: String(this.fillStyle) })
    },
    strokeText() {},
  }
  return ctx
}

type Ctx = ReturnType<typeof fakeCtx>

function vpOf(zoom: number, panX = 0, panY = 0): Viewport {
  return { zoom, panX, panY, dpr: 1 }
}

function draw(o: Partial<Parameters<typeof drawPattern>[1]> = {}) {
  const ctx = fakeCtx()
  const grid = o.grid ?? createGrid(100, 100)
  drawPattern(ctx as unknown as CanvasRenderingContext2D, {
    grid,
    palette: DEMO_PALETTE,
    vp: vpOf(10),
    width: 100,
    height: 100,
    showCodes: false,
    version: 0,
    ...o,
  })
  return ctx
}

/** 只取逐格填充：头两块是舞台底色和板面底色 */
function cells(ctx: Ctx): Rect[] {
  return ctx.rects.slice(2)
}

function filledGrid(cols: number, rows: number, color = 0) {
  return createGrid(cols, rows, color)
}

describe('drawPattern', () => {
  it('先铺舞台底色和板面底色', () => {
    const ctx = draw()
    expect(ctx.rects[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 100, fill: STAGE_BG })
    expect(ctx.rects[1].fill).toBe(BOARD_BG)
  })

  it('只画可见的一屏（视口裁剪）', () => {
    const ctx = draw({ grid: filledGrid(1000, 1000) })
    // 10px/格、100×100 画布 → 10 × 10 格
    expect(cells(ctx)).toHaveLength(100)
    for (const r of cells(ctx)) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x).toBeLessThan(100)
      expect(r.y).toBeLessThan(100)
    }
  })

  it('133 万格也只画一屏，不是全图', () => {
    const ctx = draw({
      grid: filledGrid(1144, 1144),
      vp: vpOf(20),
      width: 1440,
      height: 900,
    })
    expect(cells(ctx)).toHaveLength(72 * 45)
  })

  it('空格不画，透出板面底色', () => {
    const grid = createGrid(10, 10)
    grid.cells[0] = EMPTY
    grid.cells[1] = 3
    const ctx = draw({ grid, width: 100, height: 100 })
    expect(cells(ctx)).toHaveLength(1)
    expect(cells(ctx)[0].fill).toBe(DEMO_PALETTE.colors[3].hex)
  })

  it('分数缩放时相邻格不出现缝隙（各自取整再算宽）', () => {
    const ctx = draw({ grid: filledGrid(50, 1), vp: vpOf(3.7, 10, 0), width: 200, height: 10 })
    const line = cells(ctx).sort((a, b) => a.x - b.x)
    expect(line.length).toBeGreaterThan(40)
    for (let i = 1; i < line.length; i++) {
      expect(line[i].x).toBe(line[i - 1].x + line[i - 1].w)
    }
  })

  it('色号只在 zoom ≥ 14 且开关打开时画', () => {
    const grid = filledGrid(10, 10)
    expect(draw({ grid, vp: vpOf(10), showCodes: true }).texts).toHaveLength(0)
    expect(draw({ grid, vp: vpOf(20), showCodes: false }).texts).toHaveLength(0)
    const shown = draw({ grid, vp: vpOf(20), showCodes: true })
    expect(shown.texts.length).toBeGreaterThan(0)
    expect(shown.texts[0].text).toBe(DEMO_PALETTE.colors[0].code)
  })

  it('深底用白字、浅底用黑字（防止深色区域上的字看不见）', () => {
    const grid = createGrid(4, 1)
    grid.cells[0] = 0 // H01 黑
    grid.cells[1] = 1 // H02 白
    const ctx = draw({ grid, vp: vpOf(20), showCodes: true, width: 100, height: 100 })
    expect(ctx.texts[0].fill).toBe('#FFFFFF')
    expect(ctx.texts[1].fill).toBe('#000000')
  })

  it('进行中的笔画覆盖在格子值之上', () => {
    const grid = createGrid(10, 10)
    const ctx = draw({
      grid,
      width: 100,
      height: 100,
      pending: new Map([[0, 4]]),
    })
    expect(cells(ctx)).toHaveLength(1)
    expect(cells(ctx)[0].fill).toBe(DEMO_PALETTE.colors[4].hex)
    expect(cells(ctx)[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('板框画成红色，能跟网格线区分', () => {
    const ctx = fakeCtx()
    drawPattern(ctx as unknown as CanvasRenderingContext2D, {
      grid: filledGrid(100, 100),
      palette: DEMO_PALETTE,
      vp: vpOf(4),
      width: 400,
      height: 400,
      showCodes: false,
      version: 0,
      boards: [
        { c0: 0, r0: 0, cw: 52, rh: 52 },
        { c0: 52, r0: 0, cw: 48, rh: 52 },
      ],
    })
    expect(ctx.strokes).toContain('#D22B2B')
    expect(ctx.strokes).toContain('rgba(0,0,0,0.10)') // 细网格线是另一种颜色
  })

  it('外接框空档画成暗色（自由拼板时那里没有板）', () => {
    const ctx = fakeCtx()
    const placeable = new Uint8Array(100 * 100).fill(1)
    // 右下角 20×20 是空档
    for (let r = 80; r < 100; r++) for (let c = 80; c < 100; c++) placeable[r * 100 + c] = 0
    drawPattern(ctx as unknown as CanvasRenderingContext2D, {
      grid: filledGrid(100, 100),
      palette: DEMO_PALETTE,
      vp: vpOf(4),
      width: 400,
      height: 400,
      showCodes: false,
      version: 0,
      placeable,
    })
    expect(ctx.rects.some((r) => r.fill === '#c9c9cf')).toBe(true)
  })
})
