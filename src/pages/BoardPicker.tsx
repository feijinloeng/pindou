import { useEffect, useMemo, useRef, useState } from 'react'
import { DotsThree, Minus, SquaresFour } from '@phosphor-icons/react'

import {
  BOARD_PROFILES,
  deriveLayoutGeometry,
  type BoardGeometry,
  type BoardPlacement,
  type BoardTypeId,
} from '../domain/board'
import { lostCells } from '../domain/grid'
import { useEditor } from '../editor/store'
import { navigate } from '../router'
import { t } from '../i18n/zh'
import { useOverlayEscape } from '../components/overlayState'
import { Btn, Disclosure, Menu, MenuItem, Modal } from '../components/ui'
import { useMediaQuery } from '../components/media'
import { usePickerActions } from './pickerActions'

const ORDER: BoardTypeId[] = ['mini26', 'mini52', 'mini78', 'mini104', 'midi29']
/** 同一针距的板都是这些钉数的整数倍，所以吸附用最小钉数 */
const SNAP: Record<number, number> = { 2.6: 26, 5: 29 }

interface Draft extends BoardPlacement {
  key: number
}

/**
 * 底板排布（spec 8）：桌面 260px 配置侧栏 + 排列工作区。
 * 交互/校验沿用旧实现：吸附、拖放、键盘移动、右键/删除、重叠和针距校验、丢格警告。
 */
export default function BoardPicker() {
  const layout = useEditor((s) => s.layout)
  const applyLayout = useEditor((s) => s.applyLayout)
  const closePicker = useEditor((s) => s.closePicker)
  const pickerReturn = useEditor((s) => s.pickerReturn)
  const copy = t('picker')
  const mobile = useMediaQuery('(max-width: 767px)')

  const [type, setType] = useState<BoardTypeId>(() => layout.placements[0]?.board ?? 'mini52')
  const [draft, setDraft] = useState<Draft[]>(() => layout.placements.map((p, i) => ({ ...p, key: i })))
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ key: number; col: number; row: number } | null>(null)
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  const [zoomOverride, setZoomOverride] = useState<number | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const nextKey = useRef(draft.length)
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 })

  const dirty = useMemo(() => !samePlacements(draft, layout.placements), [draft, layout.placements])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const leave = () => {
    if (dirty && !window.confirm(copy.discard)) return
    closePicker()
    if (pickerReturn === 'library') navigate('library')
  }
  useOverlayEscape(true, leave)

  useEffect(() => {
    usePickerActions.setState({ confirm, cancel: leave, canConfirm: draft.length > 0 })
    return () => usePickerActions.setState({ confirm: null, cancel: null, canConfirm: false })
  })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWrapSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pegs = BOARD_PROFILES[type].pegs
  const snap = SNAP[BOARD_PROFILES[type].pitchMm] ?? pegs
  const extent = useMemo(() => {
    let cols = 0
    let rows = 0
    for (const p of draft) {
      const size = BOARD_PROFILES[p.board].pegs
      cols = Math.max(cols, p.col + size)
      rows = Math.max(rows, p.row + size)
    }
    const pad = Math.max(snap, ...draft.map((p) => BOARD_PROFILES[p.board].pegs), snap)
    return {
      cols: Math.max(cols + pad, snap * 6),
      rows: Math.max(rows + pad, snap * 6),
    }
  }, [draft, snap])
  const fitZoom = useMemo(() => {
    if (!wrapSize.width || !wrapSize.height) return 6
    return Math.max(2, Math.min(28, Math.min(wrapSize.width / extent.cols, wrapSize.height / extent.rows) * 0.92))
  }, [wrapSize, extent])
  const zoom = zoomOverride ?? fitZoom
  const step = snap * zoom

  const geometry = useMemo(() => {
    if (!draft.length) return null
    try {
      return deriveLayoutGeometry({ placements: draft, gapMm: layout.gapMm })
    } catch {
      return null
    }
  }, [draft, layout.gapMm])
  const sizeMm = geometry ? { w: geometry.cols * geometry.pitchMm, h: geometry.rows * geometry.pitchMm } : null
  const filledCells = geometry ? geometry.placeable.reduce((a, b) => a + b, 0) : 0
  const holes = geometry ? geometry.cols * geometry.rows - filledCells : 0

  const overlaps = (candidate: BoardPlacement, skipKey?: number): boolean => {
    const size = BOARD_PROFILES[candidate.board].pegs
    return draft.some((p) => {
      if (p.key === skipKey) return false
      const other = BOARD_PROFILES[p.board].pegs
      return candidate.col < p.col + other && p.col < candidate.col + size && candidate.row < p.row + other && p.row < candidate.row + size
    })
  }
  const moveBoard = (key: number, col: number, row: number) => {
    const target = draft.find((p) => p.key === key)
    if (!target) return
    const candidate = { board: target.board, col: Math.max(0, col), row: Math.max(0, row) }
    if (overlaps(candidate, key)) {
      setError(copy.overlap)
      return
    }
    setError(null)
    setDraft((current) => current.map((p) => (p.key === key ? { ...p, col: candidate.col, row: candidate.row } : p)))
  }
  const removeBoard = (key: number) => {
    setDraft((current) => current.filter((item) => item.key !== key))
    setSelectedKey((current) => (current === key ? null : current))
    setError(null)
  }
  const addBoard = () => {
    const stepBeads = SNAP[BOARD_PROFILES[type].pitchMm] ?? BOARD_PROFILES[type].pegs
    for (let row = 0; row <= 400; row += stepBeads) {
      for (let col = 0; col <= 400; col += stepBeads) {
        const candidate = { board: type, col, row }
        if (overlaps(candidate)) continue
        setError(null)
        setDraft((current) => [...current, { ...candidate, key: nextKey.current++ }])
        return
      }
    }
    setError(copy.overlap)
  }
  const surfaceRef = () => wrapRef.current?.querySelector<HTMLElement>('[data-surface]') ?? null
  const addAt = (clientX: number, clientY: number, boardType: BoardTypeId) => {
    const surface = surfaceRef()
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const stepBeads = SNAP[BOARD_PROFILES[boardType].pitchMm] ?? BOARD_PROFILES[boardType].pegs
    const candidate = {
      board: boardType,
      col: Math.max(0, Math.round((clientX - rect.left) / zoom / stepBeads) * stepBeads),
      row: Math.max(0, Math.round((clientY - rect.top) / zoom / stepBeads) * stepBeads),
    }
    if (overlaps(candidate)) {
      setError(copy.overlap)
      return
    }
    setError(null)
    setDraft((current) => [...current, { ...candidate, key: nextKey.current++ }])
  }
  function confirm() {
    if (!draft.length) {
      setError(copy.needOne)
      return
    }
    let next: BoardGeometry
    try {
      next = deriveLayoutGeometry({ placements: draft, gapMm: layout.gapMm })
    } catch (failure) {
      return setError(failure instanceof Error ? failure.message : copy.needOne)
    }
    const lost = lostCells(useEditor.getState().grid, next)
    if (lost > 0 && !window.confirm(copy.losesContent(lost))) return
    const failure = applyLayout({ placements: draft, gapMm: layout.gapMm })
    if (failure) setError(failure)
  }

  const summary = <Summary geometry={geometry} boards={draft.length} sizeMm={sizeMm} holes={holes} filledCells={filledCells} />
  const models = (
    <div className={mobile ? 'flex gap-2 overflow-x-auto px-3 pb-2' : 'flex flex-col gap-1'}>
      {[2.6, 5].map((pitch) => (
        <div key={pitch} className={mobile ? 'contents' : 'flex flex-col gap-1'}>
          {!mobile && <p className="mt-2 text-xs text-ink-2">{pitch === 2.6 ? copy.miniPitch : copy.midiPitch}</p>}
          {ORDER.filter((id) => BOARD_PROFILES[id].pitchMm === pitch).map((id) => {
            const profile = BOARD_PROFILES[id]
            const area = profile.pegs * profile.pitchMm
            const active = id === type
            return (
              <button
                key={id}
                type="button"
                draggable={!mobile}
                onDragStart={(e) => {
                  setType(id)
                  e.dataTransfer.setData('text/pindou-board', id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setType(id)}
                className={`flex shrink-0 items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm ${
                  active ? 'border-accent bg-hover text-ink' : 'border-line text-ink hover:bg-hover'
                }`}
              >
                <SquaresFour size={20} aria-hidden className="shrink-0 text-ink-2" />
                <span className="flex flex-col">
                  <span className="font-mono">{profile.pegs} × {profile.pegs}</span>
                  <span className="text-xs text-ink-2">{profile.pitchMm}mm · {area.toFixed(1)} × {area.toFixed(1)}mm</span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* 260px 配置侧栏；移动端变成顶部横排型号 */}
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface md:w-[260px] md:border-r md:border-b-0">
        <div className="px-3 pt-3"><h2 className="text-base font-semibold">{copy.models}</h2></div>
        {models}
        {!mobile && (
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
            <Btn onClick={addBoard} wide><span>＋</span>{copy.addBoard}</Btn>
            <div className="mt-4">{summary}</div>
            <div className="mt-auto pt-4">
              {error && <p role="alert" className="mb-2 rounded-lg bg-warn-bg p-2 text-xs text-warn-ink">{error}</p>}
              <Btn wide variant="primary" disabled={!draft.length} onClick={confirm}>{copy.confirm}</Btn>
            </div>
          </div>
        )}
      </aside>

      {/* 排列工作区 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 text-sm">
          <span className="font-medium">{copy.title}</span>
          <span className="hidden text-xs text-ink-2 md:inline">{copy.nowPicking} {pegs}×{pegs}</span>
          <Btn onClick={() => { setDraft((current) => current.slice(0, -1)); setError(null) }} disabled={!draft.length}>
            <Minus size={14} aria-hidden />{copy.undoOne}
          </Btn>
          <Menu label={<DotsThree size={18} aria-hidden />} title={copy.more} triggerVariant="ghost" width="w-40">
            {(close) => <MenuItem onClick={() => { setDraft([]); setSelectedKey(null); setError(null); close() }} disabled={!draft.length}>{copy.clear}</MenuItem>}
          </Menu>
          <label className="ml-auto flex items-center gap-1 text-xs text-ink-2">
            {copy.zoom}
            <input type="range" min={2} max={28} step={0.5} value={zoom} onChange={(e) => setZoomOverride(Number(e.target.value))} className="w-20 md:w-28" />
            <span className="w-8 tabular">{zoom.toFixed(1)}</span>
          </label>
        </div>
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-auto bg-workspace p-4">
          <div
            data-surface
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/pindou-board') as BoardTypeId; if (id && BOARD_PROFILES[id]) { setType(id); addAt(e.clientX, e.clientY, id) } }}
            onPointerDown={(e) => { if (e.button !== 0 || dragging || (e.target as HTMLElement).closest('[data-board]')) return; addAt(e.clientX, e.clientY, type) }}
            onPointerMove={(e) => {
              if (!dragging) return
              const surface = surfaceRef(); if (!surface) return
              const rect = surface.getBoundingClientRect()
              setDragging({ key: dragging.key, col: Math.max(0, Math.round((e.clientX - rect.left) / zoom / snap) * snap), row: Math.max(0, Math.round((e.clientY - rect.top) / zoom / snap) * snap) })
            }}
            onPointerUp={(e) => { e.currentTarget.releasePointerCapture?.(e.pointerId); if (!dragging) return; const { key, col, row } = dragging; setDragging(null); moveBoard(key, col, row) }}
            onPointerCancel={() => setDragging(null)} onLostPointerCapture={() => setDragging(null)} onPointerLeave={() => setDragging(null)}
            className="relative touch-none"
            style={{ width: extent.cols * zoom, height: extent.rows * zoom, touchAction: 'none', backgroundImage: 'linear-gradient(to right, #c4ccc7 1px, transparent 1px), linear-gradient(to bottom, #c4ccc7 1px, transparent 1px), linear-gradient(to right, #8b9691 1px, transparent 1px), linear-gradient(to bottom, #8b9691 1px, transparent 1px)', backgroundSize: `${step}px ${step}px, ${step}px ${step}px, ${step * 4}px ${step * 4}px, ${step * 4}px ${step * 4}px` }}
          >
            {draft.map((p) => {
              const size = BOARD_PROFILES[p.board].pegs
              const live = dragging?.key === p.key ? dragging : p
              const px = size * zoom
              const active = p.key === selectedKey
              return (
                <div key={p.key} className="absolute" style={{ left: live.col * zoom, top: live.row * zoom }}>
                  {active && <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => removeBoard(p.key)} className="absolute -top-8 left-0 z-10 h-7 rounded-lg border border-line bg-surface px-2 text-xs text-ink shadow-sm hover:bg-hover">{copy.removeThis}</button>}
                  <div
                    data-board role="button" tabIndex={0}
                    aria-label={`第 ${p.row / snap + 1} 行 第 ${p.col / snap + 1} 列的 ${size}×${size} 板（方向键移动，Delete 删除）`}
                    onKeyDown={(e) => { const stepBeads = SNAP[BOARD_PROFILES[p.board].pitchMm] ?? size; const jump = e.shiftKey ? size : stepBeads; if (e.key === 'ArrowLeft') moveBoard(p.key, live.col - jump, live.row); else if (e.key === 'ArrowRight') moveBoard(p.key, live.col + jump, live.row); else if (e.key === 'ArrowUp') moveBoard(p.key, live.col, live.row - jump); else if (e.key === 'ArrowDown') moveBoard(p.key, live.col, live.row + jump); else if (e.key === 'Delete' || e.key === 'Backspace') removeBoard(p.key); else return; e.preventDefault() }}
                    onFocus={() => { setSelectedKey(p.key); setType(p.board) }}
                    onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setSelectedKey(p.key); setDragging({ key: p.key, col: live.col, row: live.row }); setType(p.board) }}
                    onPointerCancel={() => setDragging(null)} onLostPointerCapture={() => setDragging(null)} onContextMenu={(e) => { e.preventDefault(); removeBoard(p.key) }}
                    title={`${size}×${size} · ${(size * BOARD_PROFILES[p.board].pitchMm).toFixed(1)}mm · ${copy.removeHint}`}
                    className={`flex cursor-move touch-none items-center justify-center rounded-sm border-2 text-[10px] ${active ? 'border-accent bg-hover text-ink' : 'border-line bg-surface/85 text-ink-2'}`}
                    style={{ width: px, height: px }}
                  >{px > 26 && size}</div>
                </div>
              )
            })}
          </div>
          {!draft.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><p className="rounded-xl bg-ink px-4 py-2 text-sm text-surface">{copy.emptyHint}</p></div>}
        </div>
      </section>

      {mobile && <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface p-2"><Btn onClick={() => setSummaryOpen(true)}>{copy.summaryOpen}</Btn><div className="ml-auto">{error && <span className="mr-2 text-xs text-danger">{error}</span>}<Btn variant="primary" disabled={!draft.length} onClick={confirm}>{copy.confirm}</Btn></div></div>}
      {mobile && <Modal open={summaryOpen} onClose={() => setSummaryOpen(false)} title={copy.summary} sheet>{summary}</Modal>}
    </div>
  )
}

function Summary({ geometry, boards, sizeMm, holes, filledCells }: { geometry: BoardGeometry | null; boards: number; sizeMm: { w: number; h: number } | null; holes: number; filledCells: number }) {
  const copy = t('picker')
  const pending = copy.pending
  return <div className="flex flex-col gap-1.5 text-sm"><h3 className="font-medium">{copy.summary}</h3><Row label={copy.boardCount} value={boards || pending} /><Row label={copy.gridSize} value={geometry ? `${geometry.cols} × ${geometry.rows}` : pending} /><Row label={copy.physical} value={sizeMm ? `${sizeMm.w.toFixed(1)} × ${sizeMm.h.toFixed(1)} mm` : pending} />{holes > 0 && <Row label={copy.holes} value={holes} warn />}<Disclosure summary={copy.details}><div className="mt-1 flex flex-col gap-1"><Row label={copy.totalCells} value={geometry ? geometry.cols * geometry.rows : pending} /><Row label={copy.usableCells} value={geometry ? filledCells : pending} /></div></Disclosure></div>
}
function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) { return <div className="flex justify-between gap-2"><span className="text-ink-2">{label}</span><span className={`tabular ${warn ? 'text-warn-ink' : 'text-ink'}`}>{value}</span></div> }
function samePlacements(a: BoardPlacement[], b: BoardPlacement[]): boolean { return a.length === b.length && a.every((p, i) => p.board === b[i].board && p.col === b[i].col && p.row === b[i].row) }
