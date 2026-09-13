import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { usedCells } from '../domain/grid'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { downloadBytes, safeName } from '../render/download'
import {
  buildExportBundle,
  estimateExport,
  type ExportContext,
  type ExportSelection,
} from '../render/exporters'
import { renderThumbnailDataUrl } from '../render/thumbnail'
import { PrimaryBtn } from './ui'

interface ExportFlags {
  preview: boolean
  screen: boolean
  paper: boolean
  csv: boolean
}

/**
 * 导出目的地：保存成功后才进得来，进来就是成品预览 + 按用途选输出。
 * 选项跟着用途展开，不要求用户先理解 PNG / PDF / CSV 各是什么。
 */
export default function ExportStage() {
  const grid = useEditor((s) => s.grid)
  const palette = useEditor((s) => s.palette)
  const geom = useEditor((s) => s.geom)
  const pitchMm = useEditor((s) => s.palette.pitchMm)
  const name = useEditor((s) => s.name)
  const closeExport = useEditor((s) => s.closeExport)
  const [flags, setFlags] = useState<ExportFlags>({
    preview: true,
    screen: true,
    paper: false,
    csv: false,
  })
  const [previewScale, setPreviewScale] = useState(16)
  const [paperScope, setPaperScope] = useState<'boards' | 'zip'>('boards')
  const [showCodes, setShowCodes] = useState(false)
  const [screenCodes, setScreenCodes] = useState(true)
  const [screenBom, setScreenBom] = useState(true)
  const [busy, setBusy] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const copy = t('export')

  const selection: ExportSelection = {
    ...flags,
    paperScope,
    showCodes,
    screenCodes,
    screenBom,
    previewScale,
  }

  // 成品预览：空画布直接说清楚，别让用户导出个空白
  const empty = useMemo(
    () => usedCells(grid) === 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid],
  )
  useEffect(() => {
    if (empty) {
      setThumb(null)
      return
    }
    const handle = setTimeout(() => setThumb(renderThumbnailDataUrl(grid, palette, 360)), 0)
    return () => clearTimeout(handle)
  }, [grid, palette, empty])

  // 导出前就把尺寸 / 页数 / 降级说出来，不能在导出完才发现不一样（P2-23/P2-24）
  const baseName = safeName(name)
  // safeName 超过 60 字会截断；用户看不到结果名就会以为文件丢了
  const truncatedName = name.trim().length > 60 ? `${baseName}.zip` : ''
  const estimate = useMemo(
    () => estimateExport({ grid, palette, geom, pitchMm, name }, selection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, palette, geom, pitchMm, name, flags, paperScope, showCodes, screenCodes, screenBom, previewScale],
  )

  const toggle = (key: keyof ExportFlags, value: boolean) => {
    const next = { ...flags, [key]: value }
    // 全不勾就等于没导出，留一个
    if (!next.preview && !next.screen && !next.paper && !next.csv) return
    setFlags(next)
  }

  const run = async () => {
    setBusy(true)
    try {
      const ctx: ExportContext = { grid, palette, geom, pitchMm, name }
      const bundle = await buildExportBundle(ctx, selection)
      // 只触发一次下载：多选已打包成 zip，浏览器不会拦
      downloadBytes(bundle.bytes, bundle.filename, bundle.mime)
      const head = bundle.files > 1 ? copy.exportBundled(bundle.files) : copy.exportDone
      useEditor
        .getState()
        .setNotice(bundle.warnings.length > 0 ? `${head}。${bundle.warnings.join('；')}` : head)
    } catch (error) {
      useEditor
        .getState()
        .setNotice(error instanceof Error ? `${copy.exportFailed}：${error.message}` : copy.exportFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
        <button
          type="button"
          onClick={closeExport}
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
        >
          {copy.backToEdit}
        </button>
        <h2 className="text-sm font-semibold">
          {copy.title}·{name}
        </h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex flex-col gap-4">
            <section className="rounded border border-neutral-200 bg-white p-3">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-neutral-500">
                {copy.previewTitle}
              </h3>
              {empty ? (
                <p className="text-xs text-neutral-500">{copy.emptyDesign}</p>
              ) : thumb ? (
                <img
                  src={thumb}
                  alt=""
                  className="max-h-72 max-w-full rounded border border-neutral-200 bg-neutral-50"
                />
              ) : (
                <p className="text-xs text-neutral-400">…</p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-neutral-500">
                {copy.purposeTitle}
              </h3>

              <Purpose
                checked={flags.preview}
                onToggle={(v) => toggle('preview', v)}
                title={copy.purposeShare}
                hint={copy.purposeShareHint}
              >
                <select
                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                  value={previewScale}
                  aria-label={copy.preview}
                  onChange={(e) => setPreviewScale(Number(e.target.value))}
                >
                  <option value={8}>{copy.previewStandard}</option>
                  <option value={16}>{copy.previewHd}</option>
                  <option value={32}>{copy.previewPrint}</option>
                </select>
              </Purpose>

              <Purpose
                checked={flags.screen}
                onToggle={(v) => toggle('screen', v)}
                title={copy.purposeScreen}
                hint={copy.purposeScreenHint}
              >
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={screenCodes}
                    onChange={(e) => setScreenCodes(e.target.checked)}
                  />
                  {copy.screenCodes}
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={screenBom}
                    onChange={(e) => setScreenBom(e.target.checked)}
                  />
                  {copy.screenBom}
                </label>
              </Purpose>

              <Purpose
                checked={flags.paper}
                onToggle={(v) => toggle('paper', v)}
                title={copy.purposePrint}
                hint={copy.purposePrintHint}
              >
                <select
                  className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                  value={paperScope}
                  aria-label={copy.paper}
                  onChange={(e) => setPaperScope(e.target.value as 'boards' | 'zip')}
                >
                  <option value="boards">{copy.scopeBoards}</option>
                  <option value="zip">{copy.scopeZip}</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={showCodes}
                    onChange={(e) => setShowCodes(e.target.checked)}
                  />
                  {copy.paperCodes}
                </label>
              </Purpose>

              <Purpose
                checked={flags.csv}
                onToggle={(v) => toggle('csv', v)}
                title={copy.purposeMaterials}
                hint={copy.purposeMaterialsHint}
              />
            </section>
          </div>

          <div className="flex flex-col gap-3 self-start lg:sticky lg:top-0">
            <div className="rounded border border-neutral-200 bg-white p-3 text-[11px] leading-relaxed text-neutral-600">
              <p className="font-semibold text-neutral-700">{copy.estimateTitle}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {flags.preview && (
                  <li>
                    {copy.estimatePreview}：{estimate.previewWidth} × {estimate.previewHeight} px
                    {estimate.previewClamped
                      ? `（每格 ${estimate.previewActual.toFixed(2)}px，已被上限压低）`
                      : `（每格 ${estimate.previewActual}px）`}
                  </li>
                )}
                {flags.screen && (
                  <li>
                    {copy.estimateScreen}：{estimate.screenPages} 页
                  </li>
                )}
                {flags.paper && (
                  <li>
                    {copy.estimatePaper}：{estimate.paperPages} 页
                  </li>
                )}
                <li>
                  {copy.estimateName}：{truncatedName || baseName}
                  {truncatedName && (
                    <span className="text-amber-700">（原文件名超过 60 字，已截断）</span>
                  )}
                </li>
              </ul>
              {estimate.warnings.map((warning) => (
                <p key={warning} role="status" className="mt-1 text-amber-700">
                  {warning}
                </p>
              ))}
            </div>

            <PrimaryBtn onClick={() => void run()} disabled={busy || empty}>
              {busy ? copy.exporting : copy.run}
            </PrimaryBtn>

            <details className="text-[11px] leading-relaxed text-neutral-500">
              <summary className="cursor-pointer">{copy.helpTitle}</summary>
              <p className="mt-1 whitespace-pre-line">{copy.help}</p>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 一个用途 = 一个勾 + 勾上才展开的选项 */
function Purpose({
  checked,
  onToggle,
  title,
  hint,
  children,
}: {
  checked: boolean
  onToggle: (value: boolean) => void
  title: string
  hint: string
  children?: ReactNode
}) {
  return (
    <div
      className={`rounded border bg-white p-3 ${
        checked ? 'border-neutral-900' : 'border-neutral-200'
      }`}
    >
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>
          {title}
          <span className="block text-[11px] text-neutral-500">{hint}</span>
        </span>
      </label>
      {checked && children && <div className="mt-2 flex flex-col gap-2 pl-6">{children}</div>}
    </div>
  )
}
