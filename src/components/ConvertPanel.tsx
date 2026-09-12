import { useEffect, useRef } from 'react'

import { resolveDither, STRATEGY_LIST } from '../conversion/strategies'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import type { SourceImage } from '../conversion/types'
import { Btn, Label, Panel } from './ui'

export default function ConvertPanel() {
  const sourceImage = useEditor((s) => s.sourceImage)
  const sourceName = useEditor((s) => s.sourceName)
  const conversion = useEditor((s) => s.conversion)
  const converting = useEditor((s) => s.converting)
  const progress = useEditor((s) => s.progress)
  const lastConvert = useEditor((s) => s.lastConvert)
  const grid = useEditor((s) => s.grid)
  const fileRef = useRef<HTMLInputElement>(null)
  // 显示"实际生效"的抖动，不是参数里的 null
  const dither = resolveDither(conversion.strategyId, conversion.dither)
  const a = useEditor.getState()
  const copy = t('convert')

  return (
    <Panel title={copy.title}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(ev) => {
          const file = ev.target.files?.[0]
          if (file) void a.importImage(file)
          ev.target.value = ''
        }}
      />
      <div className="flex gap-1">
        <Btn onClick={() => fileRef.current?.click()}>{copy.import}</Btn>
        {sourceName && (
          <Btn onClick={a.clearSourceImage} title="丢掉源图">
            移除
          </Btn>
        )}
      </div>
      {sourceImage && <SourceThumb image={sourceImage} />}
      <p className="truncate text-[11px] text-neutral-500" title={sourceName ?? ''}>
        {sourceName ? `${copy.imported}：${sourceName}` : copy.none} · 画布 {grid.cols}×
        {grid.rows}
      </p>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        {copy.strategy}
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
          value={conversion.strategyId}
          onChange={(e) => a.setConversion({ strategyId: e.target.value as never })}
        >
          {STRATEGY_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.description}
            </option>
          ))}
        </select>
      </label>

      <Label value={conversion.maxColors === 0 ? copy.unlimited : conversion.maxColors}>
        {copy.maxColors}
      </Label>
      <input
        type="range"
        min={0}
        max={64}
        step={1}
        value={conversion.maxColors}
        onChange={(e) => a.setConversion({ maxColors: Number(e.target.value) })}
      />

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={dither > 0}
          onChange={(e) =>
            // 关掉要写 0（明确关），不能写 null —— null 是"跟随内容类型默认值"
            a.setConversion({ dither: e.target.checked ? (dither > 0 ? dither : 0.55) : 0 })
          }
        />
        {copy.dither}
        {dither > 0 && (
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={dither}
            onChange={(e) => a.setConversion({ dither: Number(e.target.value) })}
            className="flex-1"
          />
        )}
      </label>
      <p className="text-[11px] text-neutral-500">
        {conversion.dither === null
          ? `「${STRATEGY_BY_ID(conversion.strategyId)}」默认${dither > 0 ? `抖动 ${dither}` : '不抖动'}`
          : dither > 0
            ? `手动抖动 ${dither}`
            : '已关掉抖动'}
      </p>

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={conversion.cropToSubject}
          onChange={(e) => a.setConversion({ cropToSubject: e.target.checked })}
        />
        {copy.crop}
      </label>
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={conversion.removeBackground}
          onChange={(e) => a.setConversion({ removeBackground: e.target.checked })}
        />
        {copy.background}
      </label>
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={conversion.clearExisting}
          onChange={(e) => a.setConversion({ clearExisting: e.target.checked })}
        />
        {copy.clear}
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        {copy.fit}
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
          value={conversion.fit}
          onChange={(e) => a.setConversion({ fit: e.target.value as never })}
        >
          <option value="cover">{copy.fitCover}</option>
          <option value="contain">{copy.fitContain}</option>
          <option value="stretch">{copy.fitStretch}</option>
        </select>
      </label>

      <Btn onClick={() => void a.runConvert()} disabled={converting || !sourceName}>
        {converting ? `${copy.running}…` : lastConvert ? copy.rerun : copy.run}
      </Btn>

      {progress && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-200">
          <div
            className="h-full bg-neutral-900 transition-all"
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
      )}
      {progress && <p className="text-[11px] text-neutral-500">{progress.stage}</p>}

      {lastConvert && (
        <div className="rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-600">
          {copy.result}：{lastConvert.used} 色 · {lastConvert.ms} ms ·{' '}
          {kindLabel(lastConvert.kind)}
          {lastConvert.cropped ? ' · 已裁到主体' : ''}
          {lastConvert.dropped > 0 ? ` · 限色并掉了 ${lastConvert.dropped} 色` : ''}
        </div>
      )}
    </Panel>
  )
}

/** 源图缩略图：光有文件名和4秒就消失的提示，等于没有反馈 */
function SourceThumb({ image }: { image: SourceImage }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const full = document.createElement('canvas')
    full.width = image.width
    full.height = image.height
    const fullCtx = full.getContext('2d')
    const ctx = canvas.getContext('2d')
    if (!fullCtx || !ctx) return
    // 同一个 buffer 建视图，不复制像素（源图可能有几十 MB）
    const pixels = new Uint8ClampedArray(image.data.buffer as ArrayBuffer)
    fullCtx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0)
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height)
    const w = Math.max(1, Math.round(image.width * scale))
    const h = Math.max(1, Math.round(image.height * scale))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(full, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
  }, [image])
  return (
    <canvas
      ref={ref}
      width={112}
      height={112}
      className="self-center rounded border border-neutral-300 bg-neutral-100"
      title={`${image.width}×${image.height}`}
    />
  )
}

function STRATEGY_BY_ID(id: string): string {
  return STRATEGY_LIST.find((s) => s.id === id)?.label ?? id
}

function kindLabel(kind: string): string {
  return (
    { lineart: '判为线稿', pixelart: '判为像素画', document: '判为文档', photo: '判为照片' }[kind] ??
    kind
  )
}
