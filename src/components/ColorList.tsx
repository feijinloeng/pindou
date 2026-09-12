import { useMemo } from 'react'

import { usageByIndex } from '../domain/grid'
import { labelTextColor } from '../domain/palette'
import { DISCLAIMER, PALETTES, TRADEMARKS } from '../data/palettes'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'

export default function ColorList() {
  const palette = useEditor((s) => s.palette)
  const paletteId = useEditor((s) => s.paletteId)
  const allowedCodes = useEditor((s) => s.allowedCodes)
  const grid = useEditor((s) => s.grid)
  const version = useEditor((s) => s.commitVersion)
  const colorIndex = useEditor((s) => s.colorIndex)
  const a = useEditor.getState()
  const copy = t('editor')

  // 只在提交层变化时重算用量：131 万格扫一遍不能每个 mousemove 都做
  const usage = useMemo(
    () => usageByIndex(grid, palette.colors.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, version],
  )
  const usedCount = usage.reduce((n, v) => n + (v > 0 ? 1 : 0), 0)
  const excluded = new Set(allowedCodes ?? [])

  return (
    <section className="border-b border-neutral-200">
      <div className="px-3 py-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-neutral-500">
          {copy.colors}
        </h3>
        <select
          className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
          value={paletteId}
          onChange={(e) => a.setPalette(e.target.value)}
        >
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} · {p.colors.length} 色
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          用了 {usedCount}/{palette.colors.length} 色
          {allowedCodes && ` · 已排除 ${allowedCodes.length} 色`}
        </p>
        {allowedCodes && (
          <button
            type="button"
            onClick={a.restoreAllCodes}
            className="mt-1 text-[11px] text-blue-600 underline"
          >
            恢复全部色号
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1 p-2">
        {palette.colors.map((color, i) => {
          const isExcluded = excluded.has(color.code)
          return (
            <div key={color.code} className="group relative">
              <button
                type="button"
                title={`${color.code} ${color.name} · ${usage[i]} 颗`}
                onClick={() => a.setColor(i)}
                className={`flex h-11 w-full flex-col items-center justify-center rounded border text-[10px] ${
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
                {usage[i] > 0 && (
                  <span
                    className={`tabular-nums ${
                      labelTextColor(color.hex) === 'black' ? 'text-black/60' : 'text-white/70'
                    }`}
                  >
                    {usage[i]}
                  </span>
                )}
              </button>
              <button
                type="button"
                title={isExcluded ? `恢复 ${color.code}` : `排除 ${color.code}`}
                onClick={() => a.toggleCode(color.code)}
                className="absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] leading-none text-white group-hover:flex"
              >
                {isExcluded ? '+' : '×'}
              </button>
            </div>
          )
        })}
      </div>

      <p className="px-3 pb-3 text-[10px] leading-relaxed text-neutral-400">
        {DISCLAIMER || t('disclaimer')}
        <br />
        {TRADEMARKS || t('trademarks')}
      </p>
    </section>
  )
}
