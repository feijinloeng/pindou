import { useEffect, useRef } from 'react'
import { Image as ImageIcon, Warning } from '@phosphor-icons/react'

import { AUTO_OPTION, resolveDither, STRATEGY_LIST } from '../conversion/strategies'
import { EMPTY } from '../domain/grid'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import type { SourceImage } from '../conversion/types'
import { Btn, Disclosure, Field } from './ui'

/**
 * 图片面板（spec 5.6）：选图 → 基本参数 → 更多调整 → 结果 → 固定底部的应用按钮。
 * 参数改动绝不自动触发转换；「应用到画布」只跑一次 runConvert()。
 */
export default function ConvertPanel() {
  const sourceImage = useEditor((s) => s.sourceImage)
  const sourceName = useEditor((s) => s.sourceName)
  const sourceCached = useEditor((s) => s.sourceCached)
  const conversion = useEditor((s) => s.conversion)
  const converting = useEditor((s) => s.converting)
  const progress = useEditor((s) => s.progress)
  const lastConvert = useEditor((s) => s.lastConvert)
  const fileRef = useRef<HTMLInputElement>(null)
  // 显示"实际生效"的抖动，不是参数里的 null。选了“自动”时实际值要转换完才知道
  const auto = conversion.strategyId === 'auto'
  const dither = resolveDither(conversion.strategyId, conversion.dither)
  const a = useEditor.getState()
  const copy = t('convert')

  /** 画布上有东西就先问一句：转换会覆盖它（这一步本身可以撤销） */
  const apply = () => {
    const grid = useEditor.getState().grid
    let occupied = false
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== EMPTY) {
        occupied = true
        break
      }
    }
    if (occupied && !window.confirm(copy.replaceConfirm)) return
    void a.runConvert()
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
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

        {/* 选图区：空 = 一个明确的选择按钮；有图 = 缩略图 + 文件名 + 尺寸 + 替换/移除 */}
        {sourceImage ? (
          <div className="flex items-start gap-2">
            <SourceThumb image={sourceImage} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="truncate text-sm text-ink" title={sourceName ?? ''}>
                {sourceName}
              </p>
              <p className="text-xs text-ink-2 tabular">
                {sourceImage.width}×{sourceImage.height}
              </p>
              <div className="flex gap-1">
                <Btn onClick={() => fileRef.current?.click()}>{copy.replace}</Btn>
                <Btn onClick={a.clearSourceImage} title={copy.removeSource}>
                  {copy.remove}
                </Btn>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-4 text-center">
            <ImageIcon size={24} className="text-ink-2" aria-hidden />
            <Btn variant="primary" onClick={() => fileRef.current?.click()}>
              {copy.pickImage}
            </Btn>
            <p className="text-xs text-ink-2">{copy.pickHint}</p>
          </div>
        )}

        {sourceCached && (
          <p role="note" className="flex items-start gap-1.5 rounded-lg bg-warn-bg p-2 text-xs text-warn-ink">
            <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
            {copy.cachedSource}
          </p>
        )}

        <Field label={`${copy.maxColors}：${conversion.maxColors === 0 ? copy.unlimited : conversion.maxColors}`}>
          <input
            type="range"
            min={0}
            max={64}
            step={1}
            value={conversion.maxColors}
            aria-label={copy.maxColors}
            onChange={(e) => a.setConversion({ maxColors: Number(e.target.value) })}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={conversion.removeBackground}
            onChange={(e) => a.setConversion({ removeBackground: e.target.checked })}
          />
          {copy.background}
        </label>

        <Field label={copy.fit}>
          <select
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            value={conversion.fit}
            onChange={(e) => a.setConversion({ fit: e.target.value as never })}
          >
            <option value="cover">{copy.fitCover}</option>
            <option value="contain">{copy.fitContain}</option>
            <option value="stretch">{copy.fitStretch}</option>
          </select>
        </Field>

        <Disclosure summary={copy.more}>
          <div className="flex flex-col gap-3">
            <Field label={copy.strategy}>
              <select
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                value={conversion.strategyId}
                onChange={(e) => a.setConversion({ strategyId: e.target.value as never })}
              >
                <option value={AUTO_OPTION.id}>
                  {AUTO_OPTION.label} · {AUTO_OPTION.description}
                </option>
                {STRATEGY_LIST.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {s.description}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm text-ink">
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
                  aria-label={copy.dither}
                  onChange={(e) => a.setConversion({ dither: Number(e.target.value) })}
                  className="flex-1"
                />
              )}
            </label>
            <p className="text-xs leading-relaxed text-ink-2">
              {copy.ditherHint}
              <br />
              {conversion.dither !== null
                ? dither > 0
                  ? `手动抖动 ${dither}`
                  : '已关掉抖动'
                : auto
                  ? '抖动跟随自动选定的档位（转换后显示实际值）'
                  : `「${STRATEGY_BY_ID(conversion.strategyId)}」默认${dither > 0 ? `抖动 ${dither}` : '不抖动'}`}
            </p>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={conversion.cropToSubject}
                onChange={(e) => a.setConversion({ cropToSubject: e.target.checked })}
              />
              {copy.crop}
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={conversion.clearExisting}
                onChange={(e) => a.setConversion({ clearExisting: e.target.checked })}
              />
              {copy.clear}
            </label>
          </div>
        </Disclosure>

        {lastConvert && (
          <div className="rounded-lg bg-hover p-2 text-xs leading-relaxed text-ink-2">
            <p className="font-medium text-ink">
              {copy.result}：{lastConvert.used} 色 ·{' '}
              {auto ? `自动选了「${STRATEGY_BY_ID(lastConvert.strategy)}」` : STRATEGY_BY_ID(lastConvert.strategy)}
            </p>
            <Disclosure summary={copy.resultDetails}>
              <ul className="mt-1 flex flex-col gap-0.5">
                <li>
                  {lastConvert.ms} ms · {kindLabel(lastConvert.kind)}
                </li>
                {lastConvert.dropped > 0 && <li>限色并掉了 {lastConvert.dropped} 色</li>}
                {lastConvert.cropped && <li>已裁到主体</li>}
                {lastConvert.cropSkipped && <li>背景色不确定，已跳过自动裁切</li>}
              </ul>
            </Disclosure>
          </div>
        )}
      </div>

      {/* 固定底部：应用按钮 + 真实进度。没有源图时禁用，说明原因 */}
      <footer className="shrink-0 border-t border-line p-3">
        <Btn
          variant="primary"
          wide
          onClick={apply}
          disabled={converting || !sourceName}
          title={!sourceName ? copy.none : undefined}
        >
          {converting ? `${copy.running}…` : lastConvert ? copy.rerun : copy.apply}
        </Btn>
        {progress && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded bg-line">
              {/* scaleX 左原点：真实进度，不编百分比 */}
              <div
                className="h-full origin-left bg-accent transition-transform duration-150"
                style={{ transform: `scaleX(${progress.ratio})` }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-2">{progress.stage}</p>
          </div>
        )}
      </footer>
    </>
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
      width={96}
      height={96}
      className="shrink-0 rounded-lg border border-line bg-hover"
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
