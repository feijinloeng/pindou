import { useEffect, useMemo, useRef, useState } from 'react'

import {
  BOARD_PROFILES,
  deriveLayoutGeometry,
  type BoardPlacement,
  type BoardTypeId,
} from '../domain/board'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'

const ORDER: BoardTypeId[] = ['mini26', 'mini52', 'mini78', 'mini104', 'midi29']
/** 同一针距的板都是这些钉数的整数倍，所以吸附用最小钉数 */
const SNAP: Record<number, number> = { 2.6: 26, 5: 29 }

interface Draft extends BoardPlacement {
  key: number
}

/**
 * 选板页：左边型号、中间台面、右边尺寸。
 * 自己在台面上随便拼 —— 不预设任何"几块几块"的组合。
 */
export default function BoardPicker() {
  const layout = useEditor((s) => s.layout)
  const applyLayout = useEditor((s) => s.applyLayout)
  const applyPreset = useEditor((s) => s.applyPreset)
  const setNotice = useEditor((s) => s.setNotice)
  const copy = t('picker')

  const [type, setType] = useState<BoardTypeId>(() => layout.placements[0]?.board ?? 'mini52')
  const [draft, setDraft] = useState<Draft[]>(() =>
    layout.placements.map((p, i) => ({ ...p, key: i })),
  )
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ key: number; col: number; row: number } | null>(null)
  const [zoomOverride, setZoomOverride] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const nextKey = useRef(draft.length)
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 })

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

  /** 台面范围：外接框 + 每边留一块板的余量，最小 6 块 */
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
      minCol: Math.min(0, ...draft.map((p) => p.col)),
      minRow: Math.min(0, ...draft.map((p) => p.row)),
    }
  }, [draft, snap])

  // 放不下就自动缩小；用户手动调过就听用户的
  const fitZoom = useMemo(() => {
    if (!wrapSize.width || !wrapSize.height) return 6
    const z = Math.min(wrapSize.width / extent.cols, wrapSize.height / extent.rows) * 0.92
    return Math.max(2, Math.min(28, z))
  }, [wrapSize, extent])
  const zoom = zoomOverride ?? fitZoom
  const step = snap * zoom

  const geometry = useMemo(() => {
    if (draft.length === 0) return null
    try {
      return deriveLayoutGeometry({ placements: draft, gapMm: layout.gapMm })
    } catch {
      return null
    }
  }, [draft, layout.gapMm])

  const overlaps = (candidate: BoardPlacement, skipKey?: number): boolean => {
    const size = BOARD_PROFILES[candidate.board].pegs
    return draft.some((p) => {
      if (p.key === skipKey) return false
      const other = BOARD_PROFILES[p.board].pegs
      return (
        candidate.col < p.col + other &&
        p.col < candidate.col + size &&
        candidate.row < p.row + other &&
        p.row < candidate.row + size
      )
    })
  }

  const addAt = (clientX: number, clientY: number, boardType: BoardTypeId) => {
    const surface = surfaceRef()
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const size = BOARD_PROFILES[boardType].pegs
    const stepBeads = SNAP[BOARD_PROFILES[boardType].pitchMm] ?? size
    const col = Math.max(0, Math.round((clientX - rect.left) / zoom / stepBeads) * stepBeads)
    const row = Math.max(0, Math.round((clientY - rect.top) / zoom / stepBeads) * stepBeads)
    const next: BoardPlacement = { board: boardType, col, row }
    if (overlaps(next)) {
      setError(copy.overlap)
      return
    }
    setError(null)
    setDraft((current) => [...current, { ...next, key: nextKey.current++ }])
  }

  const surfaceRef = () => wrapRef.current?.querySelector<HTMLElement>('[data-surface]') ?? null

  const sizeMm = geometry
    ? { w: geometry.cols * geometry.pitchMm, h: geometry.rows * geometry.pitchMm }
    : { w: 0, h: 0 }
  const filledCells = geometry ? geometry.placeable.reduce((a, b) => a + b, 0) : 0
  const holes = geometry ? geometry.cols * geometry.rows - filledCells : 0

  const confirm = () => {
    if (draft.length === 0) {
      setError(copy.needOne)
      return
    }
    const failure = applyLayout({ placements: draft, gapMm: layout.gapMm })
    if (failure) setError(failure)
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* 左：板型号 */}
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-white">
        <h3 className="border-b border-neutral-200 px-3 py-2 text-[11px] font-semibold tracking-wide text-neutral-500">
          {copy.models}
        </h3>
        <div className="flex flex-col gap-1 p-2">
          {ORDER.map((id) => {
            const profile = BOARD_PROFILES[id]
            const mm = profile.pegs * profile.pitchMm
            const active = id === type
            return (
              <button
                key={id}
                type="button"
                draggable
                onDragStart={(e) => {
                  setType(id)
                  e.dataTransfer.setData('text/pindou-board', id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => setType(id)}
                className={`flex cursor-grab items-center gap-2 rounded border px-2 py-1.5 text-left text-xs active:cursor-grabbing ${
                  active ? 'border-neutral-900 ring-1 ring-neutral-900' : 'border-neutral-200'
                }`}
              >
                <span
                  className="shrink-0 rounded-sm border border-neutral-400 bg-neutral-100"
                  style={{ width: 10 + Math.min(22, profile.pegs / 5), height: 10 + Math.min(22, profile.pegs / 5) }}
                />
                <span className="flex flex-col">
                  <span className="font-mono">{profile.pegs} × {profile.pegs}</span>
                  <span className="text-[10px] text-neutral-500">
                    {profile.pitchMm}mm · {mm.toFixed(1)}mm
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="px-3 pb-3 text-[11px] leading-relaxed text-neutral-500">{copy.dragHint}</p>
      </aside>

      {/* 中：台面 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 text-xs">
          <span className="font-semibold">{copy.title}</span>
          <span className="text-neutral-500">
            {copy.nowPicking} <span className="font-mono">{pegs}×{pegs}</span>
          </span>
          {draft.length > 0 && (
            <button
              type="button"
              className="rounded border border-neutral-300 px-2 py-1"
              onClick={() => {
                setDraft([])
                setError(null)
              }}
            >
              {copy.clear}
            </button>
          )}
          {draft.length > 0 && (
            <button
              type="button"
              className="rounded border border-neutral-300 px-2 py-1"
              onClick={() => {
                setDraft((current) => current.slice(0, -1))
                setError(null)
              }}
            >
              {copy.undoOne}
            </button>
          )}
          <span className="ml-auto flex items-center gap-1 text-neutral-500">
            {copy.zoom}
            <input
              type="range"
              min={2}
              max={28}
              step={0.5}
              value={zoom}
              onChange={(e) => setZoomOverride(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-10 tabular-nums">{zoom.toFixed(1)}</span>
          </span>
        </div>

        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 p-4">
          <div
            data-surface
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/pindou-board') as BoardTypeId
              if (!id || !BOARD_PROFILES[id]) return
              setType(id)
              addAt(e.clientX, e.clientY, id)
            }}
            onPointerDown={(e) => {
              // 点台面空白处 = 把手上这块放进最近的吸附位（拖拽之外的第二条路，触屏也好用）
              if (e.button !== 0 || dragging) return
              if ((e.target as HTMLElement).closest('div[title]')) return // 点到已放好的板上
              addAt(e.clientX, e.clientY, type)
            }}
            onPointerMove={(e) => {
              if (!dragging) return
              const surface = surfaceRef()
              if (!surface) return
              const rect = surface.getBoundingClientRect()
              const stepBeads = snap
              setDragging({
                key: dragging.key,
                col: Math.max(0, Math.round((e.clientX - rect.left) / zoom / stepBeads) * stepBeads),
                row: Math.max(0, Math.round((e.clientY - rect.top) / zoom / stepBeads) * stepBeads),
              })
            }}
            onPointerUp={() => {
              if (!dragging) return
              const { key, col, row } = dragging
              const target = draft.find((p) => p.key === key)
              setDragging(null)
              if (!target) return
              const candidate: BoardPlacement = { board: target.board, col, row }
              if (overlaps(candidate, key)) {
                setError(copy.overlap)
                return
              }
              setError(null)
              setDraft((current) => current.map((p) => (p.key === key ? { ...p, col, row } : p)))
            }}
            onPointerLeave={() => setDragging(null)}
            className="relative"
            style={{
              width: extent.cols * zoom,
              height: extent.rows * zoom,
              backgroundImage: `
                linear-gradient(to right, #d4d4d4 1px, transparent 1px),
                linear-gradient(to bottom, #d4d4d4 1px, transparent 1px),
                linear-gradient(to right, #a3a3a3 1px, transparent 1px),
                linear-gradient(to bottom, #a3a3a3 1px, transparent 1px)`,
              backgroundSize: `${step}px ${step}px, ${step}px ${step}px, ${step * 4}px ${step * 4}px, ${step * 4}px ${step * 4}px`,
            }}
          >
            {draft.map((p) => {
              const size = BOARD_PROFILES[p.board].pegs
              const live = dragging?.key === p.key ? dragging : p
              const px = size * zoom
              const active = p.board === type
              return (
                <div
                  key={p.key}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    setDragging({ key: p.key, col: live.col, row: live.row })
                    setType(p.board)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setDraft((current) => current.filter((item) => item.key !== p.key))
                  }}
                  title={`${size}×${size} · ${(size * BOARD_PROFILES[p.board].pitchMm).toFixed(1)}mm · ${copy.removeHint}`}
                  className={`absolute flex cursor-move items-center justify-center rounded-sm border-2 text-[10px] ${
                    active
                      ? 'border-sky-600 bg-sky-200/70 text-sky-900'
                      : 'border-neutral-500 bg-white/80 text-neutral-600'
                  }`}
                  style={{ left: live.col * zoom, top: live.row * zoom, width: px, height: px }}
                >
                  {px > 26 && `${size}`}
                </div>
              )
            })}
          </div>
          {draft.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="rounded bg-neutral-900/80 px-4 py-2 text-sm text-white">{copy.emptyHint}</p>
            </div>
          )}
        </div>
      </div>

      {/* 右：尺寸 */}
      <aside className="flex w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-white p-3 text-xs">
        <div className="flex flex-col gap-1">
          <h3 className="text-[11px] font-semibold tracking-wide text-neutral-500">{copy.info}</h3>
          <Row label={copy.boardCount} value={`${draft.length}`} />
          <Row label={copy.gridSize} value={geometry ? `${geometry.cols} × ${geometry.rows}` : '—'} />
          <Row
            label={copy.physical}
            value={geometry ? `${sizeMm.w.toFixed(1)} × ${sizeMm.h.toFixed(1)} mm` : '—'}
          />
          <Row label={copy.totalCells} value={geometry ? geometry.cols * geometry.rows : 0} />
          <Row label={copy.usableCells} value={filledCells} />
          {holes > 0 && <Row label={copy.holes} value={holes} warn />}
        </div>

        {error && <p className="rounded bg-red-50 p-2 text-red-700">{error}</p>}

        <button
          type="button"
          onClick={confirm}
          disabled={draft.length === 0}
          className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:bg-neutral-300"
        >
          {copy.confirm}
        </button>
        <p className="text-[11px] leading-relaxed text-neutral-500">{copy.confirmHint}</p>

        <div className="mt-auto flex flex-col gap-1 border-t border-neutral-200 pt-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-neutral-500">{copy.bench}</h3>
          {[
            { id: 'stress-26-44', label: '130 万格（44×44 个 26）' },
            { id: 'stress-26-86', label: '500 万格（86×86 个 26）' },
          ].map((b) => (
            <button
              key={b.id}
              type="button"
              className="rounded border border-neutral-300 px-2 py-1 text-left"
              onClick={() => {
                const failure = applyPreset(b.id)
                if (failure) setError(failure)
                else setNotice(null)
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span className={`tabular-nums ${warn ? 'text-amber-700' : ''}`}>{value}</span>
    </div>
  )
}
