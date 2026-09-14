import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretDown, Check } from '@phosphor-icons/react'

import { usageByIndex } from '../domain/grid'
import { labelTextColor, type Palette } from '../domain/palette'
import { PALETTES } from '../data/palettes'
import { useEditor } from '../editor/store'
import { useUi, type ColorFilter, type ColorOrder } from '../editor/uiState'
import { t } from '../i18n/zh'
import { useOverlayEscape, Z } from './overlayState'

/** 色号面板：选择器固定在顶部，下面直接浏览和选择色号。 */
export default function ColorList() {
  return <ColorBrowse />
}

/* ---------- 浏览子视图 ---------- */

function ColorBrowse() {
  const palette = useEditor((s) => s.palette)
  const paletteId = useEditor((s) => s.paletteId)
  const allowedCodes = useEditor((s) => s.allowedCodes)
  const grid = useEditor((s) => s.grid)
  const version = useEditor((s) => s.commitVersion)
  const colorIndex = useEditor((s) => s.colorIndex)
  const filter = useUi((s) => s.colorFilter)
  const setFilter = useUi((s) => s.setColorFilter)
  const colorOrder = useUi((s) => s.colorOrder)
  const setColorOrder = useUi((s) => s.setColorOrder)
  // 动作是稳定引用，不需要订阅
  const a = useEditor.getState()
  const copy = t('editor')

  // 只在提交层变化时重算用量：131 万格扫一遍不能每个 mousemove 都做
  const usage: Uint32Array = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )
  const anyUsed = usage.some((n) => n > 0)
  // 空画布上「只看已用」是零个色号，等于让人以为色板坏了：空图默认全部
  const activeFilter: ColorFilter = filter ?? (anyUsed ? 'used' : 'all')

  const isExcluded = (code: string) => allowedCodes !== null && !allowedCodes.includes(code)

  const shown = palette.colors
    .map((color, i) => ({ color, i }))
    .filter(({ i }) => {
      if (activeFilter === 'used' && usage[i] === 0) return false
      return true
    })
    .sort((a, b) => compareColors(a.color, b.color, colorOrder))

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line px-3 py-2">
          <PalettePicker
            palette={palette}
            paletteId={paletteId}
            ariaLabel={copy.colors}
            onSelect={(id) => a.setPalette(id)}
          />
        </div>

        <div className="flex flex-wrap gap-1 px-3 py-2 text-xs">
          {(
            [
              ['all', copy.colorAll],
              ['used', copy.colorUsed],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeFilter === id}
              onClick={() => setFilter(id)}
              className={`rounded-lg border px-2 py-1 ${
                activeFilter === id
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-line text-ink-2 hover:bg-hover'
              }`}
            >
              {label}
            </button>
          ))}
          <ColorOrderPicker value={colorOrder} ariaLabel={copy.colorOrder} onSelect={setColorOrder} />
        </div>

        <SwatchGrid
          entries={shown}
          usage={usage}
          colorIndex={colorIndex}
          isExcluded={isExcluded}
          onPick={(i) => a.setColor(i)}
        />
        {shown.length === 0 && <p className="px-3 pb-3 text-xs text-ink-2">{copy.colorNone}</p>}
      </div>
    </>
  )
}

const COLOR_NAME_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
const NEUTRAL_CHROMA = 8

function compareColors(
  a: Palette['colors'][number],
  b: Palette['colors'][number],
  order: ColorOrder,
): number {
  if (order === 'name') {
    return COLOR_NAME_COLLATOR.compare(a.name, b.name) || COLOR_NAME_COLLATOR.compare(a.code, b.code)
  }

  const aChroma = Math.hypot(a.lab[1], a.lab[2])
  const bChroma = Math.hypot(b.lab[1], b.lab[2])
  const aNeutral = aChroma < NEUTRAL_CHROMA
  const bNeutral = bChroma < NEUTRAL_CHROMA
  if (aNeutral !== bNeutral) return aNeutral ? -1 : 1

  // 颜色模式按色相聚拢，组内再由深到浅，接近调色盘的连续色带。
  if (!aNeutral || !bNeutral) {
    const aHue = labHue(a.lab[1], a.lab[2])
    const bHue = labHue(b.lab[1], b.lab[2])
    const hue = aHue - bHue
    if (Math.abs(hue) > 0.001) return hue
  }

  return a.lab[0] - b.lab[0] || aChroma - bChroma || COLOR_NAME_COLLATOR.compare(a.code, b.code)
}

function labHue(a: number, b: number): number {
  const degrees = (Math.atan2(b, a) * 180) / Math.PI
  return degrees < 0 ? degrees + 360 : degrees
}

function ColorOrderPicker({
  value,
  ariaLabel,
  onSelect,
}: {
  value: ColorOrder
  ariaLabel: string
  onSelect: (order: ColorOrder) => void
}) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const copy = t('editor')
  const options: Array<{ id: ColorOrder; label: string }> = [
    { id: 'name', label: copy.colorOrderByName },
    { id: 'color', label: copy.colorOrderByColor },
  ]
  const currentLabel = options.find((option) => option.id === value)?.label ?? options[0].label

  useOverlayEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !pickerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', closeWhenOutside)
    return () => window.removeEventListener('pointerdown', closeWhenOutside)
  }, [open])

  return (
    <div ref={pickerRef} className="relative ml-auto min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 max-w-28 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <span className="min-w-0 flex-1 truncate">{currentLabel}</span>
        <CaretDown
          size={13}
          weight="bold"
          aria-hidden
          className={`shrink-0 text-ink transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full right-0 z-30 mt-1 min-w-28 rounded-xl border border-line bg-surface p-1 shadow-lg"
          style={{ zIndex: Z.menu }}
        >
          {options.map((option) => {
            const selected = option.id === value
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(option.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                className={`flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs whitespace-nowrap hover:bg-hover ${
                  selected ? 'bg-hover text-ink' : 'text-ink-2'
                }`}
              >
                <span className="flex-1">{option.label}</span>
                {selected && <Check size={13} weight="bold" aria-hidden className="shrink-0 text-accent" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PalettePicker({
  palette,
  paletteId,
  ariaLabel,
  onSelect,
}: {
  palette: Palette
  paletteId: string
  ariaLabel: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useOverlayEscape(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !pickerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', closeWhenOutside)
    return () => window.removeEventListener('pointerdown', closeWhenOutside)
  }, [open])

  return (
    <div ref={pickerRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-sm text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <span className="min-w-0 flex-1 truncate">{paletteLabel(palette)}</span>
        <span className="shrink-0 text-xs text-ink-2 tabular">{palette.colors.length}</span>
        <CaretDown
          size={16}
          weight="bold"
          aria-hidden
          className={`shrink-0 text-ink transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full right-0 left-0 mt-1 max-h-[min(60vh,20rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
          style={{ zIndex: Z.menu }}
        >
          {PALETTES.map((option) => {
            const selected = option.id === paletteId
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(option.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-hover ${
                  selected ? 'bg-hover text-ink' : 'text-ink-2'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{paletteLabel(option)}</span>
                <span className="shrink-0 text-xs text-ink-2 tabular">{option.colors.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function paletteLabel(palette: Palette): string {
  const brand = palette.brand === 'MARD' ? 'MARD（曼德）' : palette.brand
  return palette.beadMm === 5 ? `${brand}（5mm）` : brand
}

/* ---------- 共用色块网格 ---------- */

function SwatchGrid({
  entries,
  usage,
  colorIndex,
  isExcluded,
  onPick,
}: {
  entries: Array<{ color: { code: string; name: string; hex: string }; i: number }>
  usage: Uint32Array
  colorIndex: number
  isExcluded: (code: string) => boolean
  onPick?: (index: number) => void
}) {
  return (
    <div className="grid grid-cols-5 gap-1 px-2 pb-2">
      {entries.map(({ color, i }) => {
        const excluded = isExcluded(color.code)
        const selected = i === colorIndex
        return (
          <div key={color.code} className="relative">
            <button
              type="button"
              title={`${color.code} ${color.name} · ${t('editor').colorUsedCount} ${usage[i]} 颗`}
              aria-pressed={selected}
              aria-label={`色号 ${color.code} ${color.name}，${t('editor').colorUsedCount} ${usage[i]} 颗${
                excluded ? `（${t('editor').colorExcluded}）` : ''
              }`}
              onClick={() => {
                onPick?.(i)
              }}
              className={`flex h-11 w-full items-center justify-center rounded-lg border text-[8.5px] ${
                excluded
                  ? 'border-dashed border-line opacity-40'
                  : selected
                    ? 'border-accent ring-2 ring-accent'
                    : 'border-line'
              }`}
              style={{ backgroundColor: color.hex }}
            >
              <span
                className={labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'}
              >
                {color.code}
              </span>
              {selected && (
                <Check
                  size={10}
                  weight="bold"
                  aria-hidden
                  className={`absolute right-0.5 bottom-0.5 ${
                    labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'
                  }`}
                />
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}
