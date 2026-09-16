import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon } from '@phosphor-icons/react'

import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { Btn } from './ui'

/** 图片导入：先生成一次，再在同一面板里调整大小、位置和边缘透明。 */
export default function ConvertPanel() {
  const converting = useEditor((s) => s.converting)
  const hasBoards = useEditor((s) => s.geom.boards.length > 0)
  const progress = useEditor((s) => s.progress)
  const sourceImage = useEditor((s) => s.sourceImage)
  const sourceName = useEditor((s) => s.sourceName)
  const conversion = useEditor((s) => s.conversion)
  const setConversion = useEditor((s) => s.setConversion)
  const fileRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const copy = t('convert')

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const scheduleConvert = (patch: Parameters<typeof setConversion>[0]) => {
    setConversion(patch)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void useEditor.getState().runConvert()
    }, 180)
  }

  const importFile = (file: File | undefined) => {
    if (!file) return
    setDragging(false)
    void useEditor.getState().importImage(file)
  }

  return (
    <div
      aria-busy={converting}
      className={`flex max-h-[min(88vh,680px)] w-[min(92vw,440px)] flex-col gap-4 overflow-hidden rounded-2xl border-2 border-dashed px-5 py-5 text-left shadow-lg ${
        dragging ? 'border-accent bg-hover' : 'border-line bg-surface'
      }`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        importFile(event.dataTransfer.files?.[0])
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          importFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {sourceImage ? (
        <>
          <div className="flex items-center gap-3">
            <ImageIcon size={28} className="shrink-0 text-ink-2" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{copy.currentImage}</p>
              <p className="truncate text-xs text-ink-2" title={sourceName ?? undefined}>
                {sourceName ?? `${sourceImage.width}×${sourceImage.height}`}
              </p>
            </div>
            <Btn variant="secondary" onClick={() => fileRef.current?.click()} disabled={converting || !hasBoards}>
              {copy.changeImage}
            </Btn>
          </div>

          <div className="min-h-0 overflow-y-auto pr-1">
            <label className="flex flex-col gap-1 text-sm text-ink-2">
              <span className="flex justify-between gap-2">
                <span>{copy.scale}</span>
                <output className="tabular-nums text-ink">{Math.round(conversion.scale * 100)}%</output>
              </span>
              <input
                type="range"
                min="25"
                max="300"
                step="5"
                value={Math.round(conversion.scale * 100)}
                onChange={(event) => scheduleConvert({ scale: Number(event.target.value) / 100 })}
              />
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
              <span className="flex justify-between gap-2">
                <span>{copy.horizontal}</span>
                <output className="tabular-nums text-ink">{formatPercent(conversion.offsetX)}</output>
              </span>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={Math.round(conversion.offsetX * 100)}
                onChange={(event) => scheduleConvert({ offsetX: Number(event.target.value) / 100 })}
              />
            </label>

            <label className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
              <span className="flex justify-between gap-2">
                <span>{copy.vertical}</span>
                <output className="tabular-nums text-ink">{formatPercent(conversion.offsetY)}</output>
              </span>
              <input
                type="range"
                min="-100"
                max="100"
                step="1"
                value={Math.round(conversion.offsetY * 100)}
                onChange={(event) => scheduleConvert({ offsetY: Number(event.target.value) / 100 })}
              />
            </label>

            <label className="mt-4 flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={conversion.removeBackground}
                onChange={(event) => scheduleConvert({ removeBackground: event.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>{copy.transparentEdge}</span>
            </label>

            {conversion.removeBackground && (
              <label className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
                <span className="flex justify-between gap-2">
                  <span>{copy.transparentThreshold}</span>
                  <output className="tabular-nums text-ink">{Math.round(conversion.backgroundThreshold)}</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(conversion.backgroundThreshold)}
                  onChange={(event) => scheduleConvert({ backgroundThreshold: Number(event.target.value) })}
                />
                <span className="text-xs">{copy.transparentThresholdHint}</span>
              </label>
            )}

            <p className="mt-4 text-xs leading-relaxed text-ink-2">{copy.adjusting}</p>
          </div>

          {progress && <ProgressBar stage={progress.stage} ratio={progress.ratio} />}
          <Btn variant="primary" onClick={() => void useEditor.getState().runConvert()} disabled={converting} wide>
            {converting ? `${copy.running}…` : copy.rerun}
          </Btn>
        </>
      ) : (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
          <ImageIcon size={32} className="text-ink-2" aria-hidden />
          <Btn
            variant="primary"
            onClick={() => fileRef.current?.click()}
            disabled={converting || !hasBoards}
          >
            {converting ? `${copy.running}…` : copy.pickImage}
          </Btn>
          <p className="max-w-[380px] text-sm leading-relaxed text-ink-2">
            {hasBoards ? copy.pickHint : copy.noBoards}
          </p>
          {dragging && <p className="text-xs text-accent">{copy.dropActive}</p>}
          {progress && <ProgressBar stage={progress.stage} ratio={progress.ratio} />}
        </div>
      )}
    </div>
  )
}

function formatPercent(value: number): string {
  const percent = Math.round(value * 100)
  return percent === 0 ? '0%' : `${percent > 0 ? '+' : ''}${percent}%`
}

function ProgressBar({ stage, ratio }: { stage: string; ratio: number }) {
  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded bg-line">
        <div
          className="h-full origin-left bg-accent transition-transform duration-150"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <p className="mt-1 text-xs text-ink-2">{stage}</p>
    </div>
  )
}
