import { useMemo, useState } from 'react'
import { ArrowLeft, Check, GearSix, MagnifyingGlass, X } from '@phosphor-icons/react'

import { usageByIndex } from '../domain/grid'
import { labelTextColor } from '../domain/palette'
import { DISCLAIMER, PALETTES, TRADEMARKS } from '../data/palettes'
import { useEditor } from '../editor/store'
import { useUi, type ColorFilter } from '../editor/uiState'
import { t } from '../i18n/zh'

/**
 * 色号面板（spec 5.7）：浏览 / 设置两个子视图。
 *
 * 白名单语义（spec 2.3.1）：allowedCodes 是「允许使用的色号」，null = 全部可用。
 * 被排除 = 白名单存在且不含它。旧代码把名单里的条目当成被排除的，正好反了。
 */
export default function ColorList() {
  const settingsOpen = useUi((s) => s.colorSettingsOpen)
  return settingsOpen ? <ColorSettings /> : <ColorBrowse />
}

/* ---------- 浏览子视图 ---------- */

function ColorBrowse() {
  const palette = useEditor((s) => s.palette)
  const allowedCodes = useEditor((s) => s.allowedCodes)
  const grid = useEditor((s) => s.grid)
  const version = useEditor((s) => s.commitVersion)
  const colorIndex = useEditor((s) => s.colorIndex)
  const query = useUi((s) => s.colorQuery)
  const setQuery = useUi((s) => s.setColorQuery)
  const filter = useUi((s) => s.colorFilter)
  const setFilter = useUi((s) => s.setColorFilter)
  const setSettingsOpen = useUi((s) => s.setColorSettingsOpen)
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
  const active = palette.colors[colorIndex]
  const activeUsage = usage[colorIndex] ?? 0

  const shown = palette.colors
    .map((color, i) => ({ color, i }))
    .filter(({ color, i }) => {
      if (activeFilter === 'used' && usage[i] === 0) return false
      if (activeFilter === 'free' && isExcluded(color.code)) return false
      const needle = query.trim().toLowerCase()
      if (!needle) return true
      return (
        color.code.toLowerCase().includes(needle) ||
        color.name.toLowerCase().includes(needle) ||
        color.hex.toLowerCase().includes(needle)
      )
    })

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span
              className="h-9 w-9 shrink-0 rounded-lg border border-line"
              style={{ backgroundColor: active.hex }}
            />
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">
                {active.code} · {active.name}
              </p>
              <p className="truncate text-xs text-ink-2 tabular">
                {active.hex} · {copy.colorUsedCount} {activeUsage} 颗
                {isExcluded(active.code) && `（${copy.colorExcluded}）`}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 px-3 py-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              aria-hidden
              className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-2"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={copy.colorSearch}
              aria-label={copy.colorSearch}
              className="w-full rounded-lg border border-line bg-surface py-1.5 pr-7 pl-7 text-sm text-ink placeholder:text-ink-2/60"
            />
            {query && (
              <button
                type="button"
                aria-label={copy.clearQuery}
                onClick={() => setQuery('')}
                className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-2 hover:bg-hover"
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {(
              [
                ['used', copy.colorUsed],
                ['all', copy.colorAll],
                ['free', copy.colorFree],
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
            <span className="ml-auto self-center text-ink-2 tabular">
              {shown.length}/{palette.colors.length}
            </span>
          </div>
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

      <footer className="shrink-0 border-t border-line p-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm text-ink hover:bg-hover"
        >
          <GearSix size={16} aria-hidden />
          {copy.colorLibrary}
        </button>
      </footer>
    </>
  )
}

/* ---------- 设置子视图 ---------- */

function ColorSettings() {
  const palette = useEditor((s) => s.palette)
  const paletteId = useEditor((s) => s.paletteId)
  const allowedCodes = useEditor((s) => s.allowedCodes)
  const grid = useEditor((s) => s.grid)
  const version = useEditor((s) => s.commitVersion)
  const setSettingsOpen = useUi((s) => s.setColorSettingsOpen)
  const a = useEditor.getState()
  const copy = t('editor')
  const [managing, setManaging] = useState(false)

  const usage = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )
  const usedCount = usage.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
  const isExcluded = (code: string) => allowedCodes !== null && !allowedCodes.includes(code)
  const excludedCount = allowedCodes === null ? 0 : palette.colors.length - allowedCodes.length
  const availableCount = palette.colors.length - excludedCount

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="flex items-center gap-1 self-start text-sm text-ink-2 hover:text-ink"
          >
            <ArrowLeft size={14} aria-hidden />
            {copy.colorBack}
          </button>

          <label className="flex flex-col gap-1 text-sm text-ink-2">
            {copy.colors}
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              value={paletteId}
              aria-label={copy.colors}
              onChange={(e) => a.setPalette(e.target.value)}
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} · {p.colors.length} 色
                </option>
              ))}
            </select>
          </label>

          <p className="text-sm text-ink-2 tabular">
            {copy.colorUsedCount} {usedCount} · {copy.colorAvailable} {availableCount} ·{' '}
            {copy.colorExcluded} {excludedCount}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={managing}
              onClick={() => setManaging(!managing)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                managing
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-line text-ink hover:bg-hover'
              }`}
            >
              {managing ? copy.colorManageOn : copy.colorManage}
            </button>
            {allowedCodes !== null && (
              <button
                type="button"
                onClick={a.restoreAllCodes}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-hover"
              >
                {copy.colorRestoreAll}
              </button>
            )}
          </div>

          <p className="text-xs leading-relaxed text-ink-2">
            {copy.colorManageHint}
            <br />
            排除色号后，用到它的格子会重映射到最近的可用色号；切换色板也会重映射。
            {copy.colorRestoreNote}
          </p>

          {managing && (
            <SwatchGrid
              entries={palette.colors.map((color, i) => ({ color, i }))}
              usage={usage}
              colorIndex={-1}
              isExcluded={isExcluded}
              managing
              onToggle={(code) => a.toggleCode(code)}
            />
          )}

          <p className="text-[11px] leading-relaxed text-ink-2/80">
            {DISCLAIMER || t('disclaimer')}
            <br />
            {TRADEMARKS || t('trademarks')}
          </p>
        </div>
      </div>
    </>
  )
}

/* ---------- 共用色块网格 ---------- */

function SwatchGrid({
  entries,
  usage,
  colorIndex,
  isExcluded,
  onPick,
  managing,
  onToggle,
}: {
  entries: Array<{ color: { code: string; name: string; hex: string }; i: number }>
  usage: Uint32Array
  colorIndex: number
  isExcluded: (code: string) => boolean
  onPick?: (index: number) => void
  /** 管理模式：每个色块带常显的排除/恢复按钮（触屏和键盘都够得着，不靠悬停） */
  managing?: boolean
  onToggle?: (code: string) => void
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
              aria-pressed={managing ? excluded : selected}
              aria-label={`色号 ${color.code} ${color.name}，${t('editor').colorUsedCount} ${usage[i]} 颗${
                excluded ? `（${t('editor').colorExcluded}）` : ''
              }`}
              onClick={() => {
                if (managing) onToggle?.(color.code)
                else onPick?.(i)
              }}
              className={`flex h-11 w-full items-center justify-center rounded-lg border text-[10px] ${
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
              {selected && !managing && (
                <Check
                  size={12}
                  weight="bold"
                  aria-hidden
                  className={`absolute right-0.5 bottom-0.5 ${
                    labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'
                  }`}
                />
              )}
            </button>
            {managing && (
              <span
                aria-hidden
                className={`pointer-events-none absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none ${
                  excluded ? 'bg-line text-ink' : 'bg-ink text-surface'
                }`}
              >
                {excluded ? '+' : '×'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
