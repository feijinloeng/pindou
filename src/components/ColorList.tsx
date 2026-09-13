import { useMemo, useState } from 'react'

import { usageByIndex } from '../domain/grid'
import { labelTextColor } from '../domain/palette'
import { DISCLAIMER, PALETTES, TRADEMARKS } from '../data/palettes'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'

/** 291 个色号平铺着找太费劲：给搜索 + 几个常用过滤 */
type Filter = 'all' | 'used' | 'free'

/**
 * 颜色面板临时打开时的内容。
 * 挑色是高频动作，所以默认就是「已用的颜色」；色板品牌、排除管理、版权说明
 * 这些低频内容收在「色彩库设置」里，不占画布旁边的位置。
 */
export default function ColorList() {
  const palette = useEditor((s) => s.palette)
  const paletteId = useEditor((s) => s.paletteId)
  const allowedCodes = useEditor((s) => s.allowedCodes)
  const grid = useEditor((s) => s.grid)
  const version = useEditor((s) => s.commitVersion)
  const colorIndex = useEditor((s) => s.colorIndex)
  // 动作是稳定引用，不需要订阅
  const a = useEditor.getState()
  const copy = t('editor')
  const [search, setSearch] = useState('')
  // 空画布上「只看已用」是零个色号，等于让人以为色板坏了：空图直接给全部
  const [filter, setFilter] = useState<Filter>(() =>
    usageByIndex(grid, palette.colors.length).some((n) => n > 0) ? 'used' : 'all',
  )

  // 只在提交层变化时重算用量：131 万格扫一遍不能每个 mousemove 都做
  const usage = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )
  const usedCount = usage.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
  const excluded = new Set(allowedCodes ?? [])
  const active = palette.colors[colorIndex]
  const activeUsage = usage[colorIndex] ?? 0

  const shown = palette.colors
    .map((color, i) => ({ color, i }))
    .filter(({ color, i }) => {
      if (filter === 'used' && usage[i] === 0) return false
      if (filter === 'free' && excluded.has(color.code)) return false
      const needle = search.trim().toLowerCase()
      if (!needle) return true
      return (
        color.code.toLowerCase().includes(needle) ||
        color.name.toLowerCase().includes(needle) ||
        color.hex.toLowerCase().includes(needle)
      )
    })

  return (
    <div className="flex flex-col">
      {active && (
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <span
            className="h-8 w-8 shrink-0 rounded border border-neutral-300"
            style={{ backgroundColor: active.hex }}
          />
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium">
              {copy.activeColor}：{active.code} · {active.name}
            </p>
            <p className="truncate text-[11px] tabular-nums text-neutral-500">
              {active.hex} · 已用 {activeUsage} 颗
              {excluded.size > 0 && excluded.has(active.code) && '（已排除）'}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 px-3 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={copy.colorSearch}
          aria-label={copy.colorSearch}
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
        />
        <div className="flex flex-wrap gap-1 text-[11px]">
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
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`rounded border px-2 py-0.5 ${
                filter === id
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 text-neutral-600'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto self-center text-neutral-400">
            {shown.length}/{palette.colors.length}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1 px-2 pb-2">
        {shown.map(({ color, i }) => {
          const isExcluded = excluded.has(color.code)
          return (
            <div key={color.code} className="group relative">
              <button
                type="button"
                title={`${color.code} ${color.name} · 已用 ${usage[i]} 颗`}
                aria-pressed={i === colorIndex}
                aria-label={`色号 ${color.code} ${color.name}，已用 ${usage[i]} 颗${
                  isExcluded ? '（已排除）' : ''
                }`}
                onClick={() => a.setColor(i)}
                className={`flex h-10 w-full items-center justify-center rounded border text-[10px] ${
                  isExcluded
                    ? 'border-dashed border-neutral-300 opacity-35'
                    : i === colorIndex
                      ? 'border-neutral-900 ring-2 ring-neutral-900'
                      : 'border-neutral-300'
                }`}
                style={{ backgroundColor: color.hex }}
              >
                <span
                  className={labelTextColor(color.hex) === 'black' ? 'text-black/90' : 'text-white/95'}
                >
                  {color.code}
                </span>
              </button>
              <button
                type="button"
                title={isExcluded ? `恢复 ${color.code}` : `排除 ${color.code}`}
                aria-label={isExcluded ? `恢复色号 ${color.code}` : `排除色号 ${color.code}`}
                aria-pressed={isExcluded}
                onClick={() => a.toggleCode(color.code)}
                className="absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] leading-none text-white group-hover:flex group-focus-within:flex focus:flex"
              >
                {isExcluded ? '+' : '×'}
              </button>
            </div>
          )
        })}
      </div>
      {shown.length === 0 && (
        <p className="px-3 pb-2 text-[11px] text-neutral-500">{copy.colorNone}</p>
      )}

      <details className="border-t border-neutral-200 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-neutral-500">
          {copy.colorLibrary}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <select
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
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
          <p className="text-xs text-neutral-500">
            用了 {usedCount}/{palette.colors.length} 色
            {allowedCodes && ` · 已排除 ${allowedCodes.length} 色`}
          </p>
          {allowedCodes && (
            <button
              type="button"
              onClick={a.restoreAllCodes}
              className="self-start text-[11px] text-blue-600 underline"
            >
              恢复全部色号
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-neutral-500">
            色块右上角的小 × 是排除这个色号；排除后用到它的格子会重映射到最近的可用色号。切换色板会把
            已有颜色重映射到新色板的最近色。
          </p>
          <p className="text-[10px] leading-relaxed text-neutral-400">
            {DISCLAIMER || t('disclaimer')}
            <br />
            {TRADEMARKS || t('trademarks')}
          </p>
        </div>
      </details>
    </div>
  )
}
