import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Warning } from '@phosphor-icons/react'

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
import { useOverlayEscape } from './overlayState'
import { Btn, Disclosure } from './ui'

interface ExportFlags {
  preview: boolean
  screen: boolean
  paper: boolean
  csv: boolean
}

/**
 * 导出（spec 9）：左边真实预览，右边 380px 输出列。
 * 四个输出可一起选（至少留一个），选项只跟着被选的那行展开；
 * 预估和警告在导出按钮之前常显。多个输出仍然打包成一个 zip。
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

  // Escape = 返回编辑；导出进行中不让退（文件生成到一半走了会以为失败）
  useOverlayEscape(!busy, closeExport)

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
    const handle = setTimeout(() => setThumb(renderThumbnailDataUrl(grid, palette, 480)), 0)
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
      // 失败要常显：配置原样留着，重试就在按钮上
      useEditor
        .getState()
        .setNotice(
          error instanceof Error ? `${copy.exportFailed}：${error.message}` : copy.exportFailed,
          'error',
        )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* 左：真实预览，占足视觉空间 */}
          <section
            aria-label={copy.previewTitle}
            className="flex items-center justify-center rounded-xl border border-line bg-surface p-4"
          >
            {empty ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-ink-2">{copy.emptyDesign}</p>
                <Btn variant="primary" onClick={closeExport}>
                  {copy.backToEdit}
                </Btn>
              </div>
            ) : thumb ? (
              <img
                src={thumb}
                alt={copy.previewTitle}
                className="max-h-[60vh] max-w-full object-contain"
              />
            ) : (
              <p className="py-16 text-sm text-ink-2">…</p>
            )}
          </section>

          {/* 右：输出列 */}
          <div className="flex flex-col gap-3 self-start">
            <h3 className="text-base font-semibold">{copy.purposeTitle}</h3>

            <fieldset disabled={busy} className="flex flex-col gap-2">
              <OutputRow
                checked={flags.preview}
                onToggle={(v) => toggle('preview', v)}
                title={copy.purposeShare}
                hint={copy.purposeShareHint}
              >
                <select
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  value={previewScale}
                  aria-label={copy.preview}
                  onChange={(e) => setPreviewScale(Number(e.target.value))}
                >
                  <option value={8}>{copy.previewStandard}</option>
                  <option value={16}>{copy.previewHd}</option>
                  <option value={32}>{copy.previewPrint}</option>
                </select>
              </OutputRow>

              <OutputRow
                checked={flags.screen}
                onToggle={(v) => toggle('screen', v)}
                title={copy.purposeScreen}
                hint={copy.purposeScreenHint}
              >
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={screenCodes}
                    onChange={(e) => setScreenCodes(e.target.checked)}
                  />
                  {copy.screenCodes}
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={screenBom}
                    onChange={(e) => setScreenBom(e.target.checked)}
                  />
                  {copy.screenBom}
                </label>
              </OutputRow>

              <OutputRow
                checked={flags.paper}
                onToggle={(v) => toggle('paper', v)}
                title={copy.purposePrint}
                hint={copy.purposePrintHint}
              >
                <select
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  value={paperScope}
                  aria-label={copy.paper}
                  onChange={(e) => setPaperScope(e.target.value as 'boards' | 'zip')}
                >
                  <option value="boards">{copy.scopeBoards}</option>
                  <option value="zip">{copy.scopeZip}</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={showCodes}
                    onChange={(e) => setShowCodes(e.target.checked)}
                  />
                  {copy.paperCodes}
                </label>
              </OutputRow>

              <OutputRow
                checked={flags.csv}
                onToggle={(v) => toggle('csv', v)}
                title={copy.purposeMaterials}
                hint={copy.purposeMaterialsHint}
              />
            </fieldset>

            {/* 预估和警告：在导出按钮之前常显 */}
            <div className="rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink-2">
              <p className="font-semibold text-ink">{copy.estimateTitle}</p>
              <ul className="mt-1 flex flex-col gap-0.5 tabular">
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
                    <span className="text-warn-ink">（原文件名超过 60 字，已截断）</span>
                  )}
                </li>
              </ul>
              {estimate.warnings.map((warning) => (
                <p key={warning} role="status" className="mt-1 flex items-start gap-1 text-warn-ink">
                  <Warning size={13} className="mt-0.5 shrink-0" aria-hidden />
                  {warning}
                </p>
              ))}
            </div>

            <Btn variant="primary" onClick={() => void run()} disabled={busy || empty}>
              {busy ? copy.exporting : copy.run}
            </Btn>

            <Disclosure summary={copy.helpTitle}>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-line text-ink-2">
                {copy.help}
              </p>
            </Disclosure>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 一个输出 = 一整行可选；勾上才在这行底下展开它自己的选项 */
function OutputRow({
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
      className={`rounded-xl border bg-surface px-3 py-2.5 ${
        checked ? 'border-accent' : 'border-line'
      }`}
    >
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
            checked ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface'
          }`}
        >
          {checked && <Check size={12} weight="bold" />}
        </span>
        <span className="text-sm font-medium text-ink">
          {title}
          <span className="block text-xs font-normal text-ink-2">{hint}</span>
        </span>
      </label>
      {checked && children && <div className="mt-2 flex flex-col gap-2 pl-7">{children}</div>}
    </div>
  )
}
