import { useMemo, useState } from 'react'

import { useEditor } from '../editor/store'
import {
  buildExportBundle,
  estimateExport,
  type ExportContext,
  type ExportSelection,
} from '../render/exporters'
import { downloadBytes, safeName } from '../render/download'
import { t } from '../i18n/zh'
import { Btn, Panel } from './ui'

interface ExportFlags {
  preview: boolean
  screen: boolean
  paper: boolean
  csv: boolean
}

export default function ExportPanel() {
  const grid = useEditor((s) => s.grid)
  const palette = useEditor((s) => s.palette)
  const geom = useEditor((s) => s.geom)
  const pitchMm = useEditor((s) => s.palette.pitchMm)
  const name = useEditor((s) => s.name)
  const setName = useEditor((s) => s.setName)
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
  const copy = t('export')

  const selection: ExportSelection = {
    ...flags,
    paperScope,
    showCodes,
    screenCodes,
    screenBom,
    previewScale,
  }

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
        .setNotice(
          bundle.warnings.length > 0 ? `${head}。${bundle.warnings.join('；')}` : head,
        )
    } catch (error) {
      useEditor
        .getState()
        .setNotice(error instanceof Error ? `${copy.exportFailed}：${error.message}` : copy.exportFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={copy.title}>
      <input
        className="rounded border border-neutral-300 px-2 py-1 text-xs"
        value={name}
        placeholder={copy.namePlaceholder}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={flags.preview}
          onChange={(e) => toggle('preview', e.target.checked)}
        />
        {copy.preview}
      </label>
      {flags.preview && (
        <select
          className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
          value={previewScale}
          onChange={(e) => setPreviewScale(Number(e.target.value))}
        >
          <option value={8}>{copy.previewStandard}</option>
          <option value={16}>{copy.previewHd}</option>
          <option value={32}>{copy.previewPrint}</option>
        </select>
      )}

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={flags.screen}
          onChange={(e) => toggle('screen', e.target.checked)}
        />
        {copy.screen}
      </label>
      {flags.screen && (
        <div className="flex flex-col gap-1 pl-5 text-xs text-neutral-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={screenCodes}
              onChange={(e) => setScreenCodes(e.target.checked)}
            />
            {copy.screenCodes}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={screenBom}
              onChange={(e) => setScreenBom(e.target.checked)}
            />
            {copy.screenBom}
          </label>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={flags.paper}
          onChange={(e) => toggle('paper', e.target.checked)}
        />
        {copy.paper}
      </label>
      {flags.paper && (
        <>
          <select
            className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
            value={paperScope}
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
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input
          type="checkbox"
          checked={flags.csv}
          onChange={(e) => toggle('csv', e.target.checked)}
        />
        {copy.csv}
      </label>

      <Btn onClick={() => void run()} disabled={busy}>
        {busy ? copy.exporting : copy.run}
      </Btn>

      <div className="rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-600">
        <p>{copy.estimateTitle}</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {flags.preview && (
            <li>
              {copy.estimatePreview}：{estimate.previewWidth} × {estimate.previewHeight} px
              {estimate.previewClamped ?
                `（每格 ${estimate.previewActual.toFixed(2)}px，已被上限压低）` :
                `（每格 ${estimate.previewActual}px）`}
            </li>
          )}
          {flags.screen && <li>{copy.estimateScreen}：{estimate.screenPages} 页</li>}
          {flags.paper && <li>{copy.estimatePaper}：{estimate.paperPages} 页</li>}
          <li>
            {copy.estimateName}：{truncatedName || baseName}
            {truncatedName && <span className="text-amber-700">（原文件名超过 60 字，已截断）</span>}
          </li>
        </ul>
        {estimate.warnings.map((warning) => (
          <p key={warning} role="status" className="mt-1 text-amber-700">
            {warning}
          </p>
        ))}
      </div>

      <details className="text-[11px] leading-relaxed text-neutral-500">
        <summary className="cursor-pointer">{copy.helpTitle}</summary>
        <p className="mt-1 whitespace-pre-line">{copy.help}</p>
      </details>
    </Panel>
  )
}
