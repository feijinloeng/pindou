import { useState } from 'react'

import { useEditor } from '../editor/store'
import {
  buildBomCsv,
  buildPaperPdf,
  buildPaperZip,
  buildPreviewPng,
  buildScreenPdf,
  downloadBytes,
  safeName,
  type ExportContext,
} from '../render/exporters'
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
  const notice = useEditor((s) => s.notice)
  const [flags, setFlags] = useState<ExportFlags>({
    preview: true,
    screen: true,
    paper: false,
    csv: false,
  })
  const [previewScale, setPreviewScale] = useState(16)
  const [paperScope, setPaperScope] = useState<'boards' | 'zip'>('boards')
  const [showCodes, setShowCodes] = useState(false)
  const [busy, setBusy] = useState(false)
  const copy = t('export')

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
      const base = safeName(name)
      if (flags.preview) {
        const png = await buildPreviewPng(ctx, { pxPerCell: previewScale })
        downloadBytes(png, `${base}-预览图.png`, 'image/png')
      }
      if (flags.screen) {
        const pdf = buildScreenPdf(ctx, { showCodes: true, includeBom: true })
        downloadBytes(pdf, `${base}-屏幕版.pdf`, 'application/pdf')
      }
      if (flags.paper && paperScope === 'boards') {
        const pdf = buildPaperPdf(ctx, {
          boards: geom.boards,
          showCodes,
          includeBom: true,
          instructions: true,
        })
        downloadBytes(pdf, `${base}-纸面版.pdf`, 'application/pdf')
      }
      if (flags.paper && paperScope === 'zip') {
        const zip = buildPaperZip(ctx, { showCodes })
        downloadBytes(zip, `${base}-按板.zip`, 'application/zip')
      }
      if (flags.csv) {
        downloadBytes(buildBomCsv(ctx), `${base}-用量.csv`, 'text/csv;charset=utf-8')
      }
      useEditor.getState().setNotice('导出完成')
    } catch (error) {
      useEditor
        .getState()
        .setNotice(error instanceof Error ? `导出失败：${error.message}` : '导出失败')
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

      {notice && <p className="text-[11px] text-neutral-500">{notice}</p>}

      <details className="text-[11px] leading-relaxed text-neutral-500">
        <summary className="cursor-pointer">{copy.helpTitle}</summary>
        <p className="mt-1 whitespace-pre-line">{copy.help}</p>
      </details>
    </Panel>
  )
}
