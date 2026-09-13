import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowsOut, CaretLeft, Check, GearSix, List, Question, X } from '@phosphor-icons/react'

import { useEditor } from '../editor/store'
import { usageByIndex } from '../domain/grid'
import {
  findAllRegions,
  findRegionAt,
  isColorComplete,
  progressOf,
  recommendRegion,
} from '../follow/followMode'
import {
  clampViewport,
  fitViewport,
  fitViewportToRegion,
  panBy,
  screenToCell,
  zoomFromWheel,
  type Viewport,
} from '../render/canvasViewport'
import { drawPattern } from '../render/drawPattern'
import { GridBitmap } from '../render/gridBitmap'
import { t } from '../i18n/zh'
import { navigate } from '../router'
import NoticeHost from '../components/NoticeHost'
import { Btn, Modal, Popover } from '../components/ui'
import { useMediaQuery } from '../components/media'

const NO_REGIONS: never[] = []
const DRAG_THRESHOLD_PX = 4
const STRATEGIES = [
  { id: 'largest', label: '最大的区域' },
  { id: 'nearest', label: '离上次最近' },
  { id: 'edge-first', label: '从边缘开始' },
] as const

/**
 * 跟做模式（spec 10）：按色号完成连通区域。色号/进度是任务本身，桌面常驻侧栏；
 * 移动端收进底部 sheet。区域算法、完成记录、点击区域语义一律沿用原实现。
 */
export default function Follow() {
  const grid = useEditor((s) => s.grid)
  const palette = useEditor((s) => s.palette)
  const geom = useEditor((s) => s.geom)
  const making = useEditor((s) => s.making)
  const strategy = useEditor((s) => s.recommendStrategy)
  const version = useEditor((s) => s.commitVersion)
  const name = useEditor((s) => s.name)
  const a = useEditor.getState()
  const copy = t('follow')
  const mobile = useMediaQuery('(max-width: 767px)')

  const [focusCode, setFocusCode] = useState<string | null>(making.focusCode)
  const [lastPoint, setLastPoint] = useState<{ col: number; row: number } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [colorSheet, setColorSheet] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [dpr] = useState(() => (typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const bitmap = useMemo(() => new GridBitmap(), [])
  const [vp, setVp] = useState<Viewport>(() => fitViewport(grid.cols, grid.rows, 900, 700, 1))
  const [size, setSize] = useState({ width: 0, height: 0 })
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const panRef = useRef<{ x: number; y: number } | null>(null)

  const usage = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )
  const focusIndex = focusCode ? palette.colors.findIndex((c) => c.code === focusCode) : -1
  const allRegions = useMemo(
    () => findAllRegions(grid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version],
  )
  const regions = useMemo(() => (focusIndex >= 0 ? (allRegions.byColor[focusIndex] ?? NO_REGIONS) : NO_REGIONS), [allRegions, focusIndex])
  const completed = useMemo(() => new Set(focusCode ? making.completedRegions[focusCode] ?? [] : []), [focusCode, making])
  const progress = progressOf(regions, completed)
  const completedMask = useMemo(() => {
    const mask = new Uint8Array(grid.cols * grid.rows)
    for (const region of regions) if (completed.has(region.id)) for (const index of region.cells) mask[index] = 1
    return mask
  }, [regions, completed, grid.cols, grid.rows])

  useEffect(() => { if (focusCode) useEditor.getState().setFocusCode(focusCode) }, [focusCode])
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure(); const observer = new ResizeObserver(measure); observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!size.width) return
    setVp((current) => current.panX === 0 && current.panY === 0 ? fitViewport(grid.cols, grid.rows, size.width, size.height, dpr) : current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, grid.cols, grid.rows])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const zoomBy = (deltaY: number, pinch: boolean, x: number, y: number) => setVp((current) => clampViewport(zoomFromWheel(current, deltaY, pinch, x, y), grid.cols, grid.rows, size.width, size.height))
    const onWheel = (e: WheelEvent) => {
      const inside = wrapRef.current?.contains(e.target as Node) ?? false
      const pinch = e.ctrlKey || e.metaKey
      if (!inside && !pinch) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomBy(e.deltaY, pinch, inside ? e.clientX - rect.left : rect.width / 2, inside ? e.clientY - rect.top : rect.height / 2)
    }
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => document.removeEventListener('wheel', onWheel)
  }, [grid.cols, grid.rows, size.width, size.height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.width) return
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr)
    canvas.style.width = `${size.width}px`; canvas.style.height = `${size.height}px`
    const ctx = canvas.getContext('2d'); if (!ctx) return
    drawPattern(ctx, { grid, palette, vp: { ...vp, dpr }, width: size.width, height: size.height, showCodes: vp.zoom >= 14, version: 0, boards: geom.boards, placeable: grid.placeable, bitmap, focus: { colorIndex: focusIndex >= 0 ? focusIndex : null, completed: completedMask }, seamColor: '#8B9691' })
  }, [grid, palette, vp, size, dpr, geom, bitmap, focusIndex, completedMask, version])

  const overall = useMemo(() => {
    let total = 0, done = 0
    for (let index = 0; index < palette.colors.length; index++) {
      const list = allRegions.byColor[index]; if (!list) continue
      const finished = new Set(making.completedRegions[palette.colors[index].code] ?? [])
      for (const region of list) { total += region.size; if (finished.has(region.id)) done += region.size }
    }
    return total === 0 ? null : done / total
  }, [allRegions, palette, making])

  const recommend = () => {
    const next = recommendRegion(regions, completed, strategy, lastPoint)
    if (!next) return
    // F 包会把这里换为可中断的数值 viewport tween；当前保留既有的即时定位，不改核心渲染循环
    setVp((current) => fitViewportToRegion(current, next.bbox, size.width, size.height, grid.cols, grid.rows))
  }
  const markAll = () => {
    if (!focusCode) return
    for (const region of regions) if (!completed.has(region.id)) a.toggleRegion(focusCode, region.id)
  }
  const reset = () => {
    if (!window.confirm(copy.resetConfirm)) return
    a.resetMaking(); setFocusCode(null); setLastPoint(null)
  }

  const colorList = <ColorList palette={palette} usage={usage} regions={allRegions.byColor} making={making} focusCode={focusCode} onPick={(code) => { setFocusCode(code); setColorSheet(false) }} />

  return (
    <div ref={fullscreenRef} className="relative flex h-full flex-col bg-workspace text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:h-16">
        <Btn onClick={() => navigate('editor')}><ArrowLeft size={16} aria-hidden />{copy.backToEdit}</Btn>
        <span className="truncate text-sm text-ink-2">{name}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        {!mobile && sidebarOpen && <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-surface"><Progress overall={overall} /><div className="min-h-0 flex-1 overflow-y-auto p-2">{colorList}</div></aside>}
        {!mobile && <button type="button" aria-label={sidebarOpen ? '收起色号栏' : '展开色号栏'} onClick={() => setSidebarOpen(!sidebarOpen)} className="z-10 flex w-7 items-center justify-center border-r border-line bg-surface text-ink-2 hover:bg-hover"><CaretLeft size={16} className={sidebarOpen ? '' : 'rotate-180'} /></button>}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-sm">
            <span className="font-mono font-medium">{focusCode ?? copy.pickColor}</span>
            {focusCode && <span className="text-xs text-ink-2 tabular">{copy.leftBeads} {progress.total - progress.done} {copy.beads} · {progress.regionsLeft}/{progress.regionsTotal} {copy.regions}</span>}
            <Btn variant="primary" onClick={recommend} disabled={!focusCode || progress.regionsLeft === 0}>{copy.recommend}</Btn>
            <Btn onClick={markAll} disabled={!focusCode || progress.regionsLeft === 0}>{copy.markAll}</Btn>
            <div className="ml-auto flex items-center gap-1">
              {mobile && <Btn onClick={() => setColorSheet(true)}><List size={16} aria-hidden />{copy.colors}</Btn>}
              <Popover title={copy.options} label={<><GearSix size={16} aria-hidden />{copy.options}</>} align="right" width="w-52"><label className="flex flex-col gap-1 text-sm text-ink-2">{copy.strategy}<select className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink" value={strategy} onChange={(e) => a.setRecommendStrategy(e.target.value as never)}>{STRATEGIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></Popover>
              <Btn onClick={reset} disabled={overall === null} title={copy.reset}><X size={16} aria-hidden /></Btn>
              <Btn onClick={() => { if (!document.fullscreenElement) void fullscreenRef.current?.requestFullscreen?.(); else void document.exitFullscreen?.() }} disabled={overall === null} title={copy.fullscreen}><ArrowsOut size={16} aria-hidden /></Btn>
              <Btn onClick={() => setHelpOpen(true)} title={copy.whatIsIt}><Question size={16} aria-hidden /></Btn>
            </div>
          </div>
          <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
            {!focusCode && <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center"><p className="inline-block rounded-xl bg-ink px-4 py-2 text-sm text-surface">{copy.pickColor}</p></div>}
            <canvas ref={canvasRef} className="absolute left-0 top-0 touch-none" onPointerDown={(e) => { const rect = e.currentTarget.getBoundingClientRect(); downRef.current = { x: e.clientX, y: e.clientY }; const cell = screenToCell(vp, e.clientX - rect.left, e.clientY - rect.top); if (focusCode && e.button === 0) { const region = findRegionAt(regions, cell.row * grid.cols + cell.col); if (region) { a.toggleRegion(focusCode, region.id); setLastPoint({ col: cell.col, row: cell.row }); downRef.current = null } } }} onPointerMove={(e) => { const down = downRef.current; if (!down) return; if (!panRef.current) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_THRESHOLD_PX) return; panRef.current = { x: e.clientX, y: e.clientY }; return } const dx = e.clientX - panRef.current.x, dy = e.clientY - panRef.current.y; panRef.current = { x: e.clientX, y: e.clientY }; setVp((current) => clampViewport(panBy(current, dx, dy), grid.cols, grid.rows, size.width, size.height)) }} onPointerUp={() => { downRef.current = null; panRef.current = null }} onContextMenu={(e) => e.preventDefault()} />
          </div>
        </main>
      </div>
      <NoticeHost />
      <Modal open={colorSheet} onClose={() => setColorSheet(false)} title={copy.colors} sheet><Progress overall={overall} /><div className="min-h-0 flex-1 overflow-y-auto p-2">{colorList}</div></Modal>
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={copy.whatIsIt}><ol className="list-decimal space-y-1 pl-4 text-sm text-ink-2"><li>{copy.howto1}</li><li>{copy.howto2}</li><li>{copy.howto3}</li><li>{copy.howto4}</li></ol><div className="mt-3 flex justify-end"><Btn onClick={() => setHelpOpen(false)}>关闭</Btn></div></Modal>
    </div>
  )
}

function Progress({ overall }: { overall: number | null }) { const copy = t('follow'); return <div className="border-b border-line p-3"><h2 className="text-sm font-semibold">{copy.colors}</h2><p className="mt-1 text-sm text-ink-2 tabular">{overall === null ? copy.empty : `${copy.overallProgress} ${(overall * 100).toFixed(1)}%`}</p><div className="mt-2 h-1.5 overflow-hidden rounded bg-line"><div className="h-full origin-left bg-accent" style={{ transform: `scaleX(${overall ?? 0})` }} /></div></div> }

function ColorList({ palette, usage, regions, making, focusCode, onPick }: { palette: ReturnType<typeof useEditor.getState>['palette']; usage: Uint32Array; regions: ReturnType<typeof findAllRegions>['byColor']; making: ReturnType<typeof useEditor.getState>['making']; focusCode: string | null; onPick: (code: string) => void }) {
  return <div className="flex flex-col gap-1">{palette.colors.map((color, index) => { const list = regions[index]; if (!list || usage[index] === 0) return null; const finished = making.completedRegions[color.code]; let total = 0, done = 0; for (const region of list) { total += region.size; if (finished?.includes(region.id)) done += region.size } const complete = isColorComplete(list, new Set(finished ?? [])); return <button key={color.code} type="button" onClick={() => onPick(color.code)} className={`flex min-h-11 items-center gap-2 rounded-lg border px-2 text-left text-sm ${focusCode === color.code ? 'border-accent bg-hover' : 'border-line hover:bg-hover'}`}><span className="h-7 w-7 shrink-0 rounded-md border border-line" style={{ backgroundColor: color.hex }} /><span className="w-14 shrink-0 font-mono">{color.code}</span><span className="text-xs text-ink-2 tabular">{total - done}/{total}</span>{complete && <Check size={16} weight="bold" className="ml-auto text-accent" aria-label="已完成" />}</button> })}</div>
}
