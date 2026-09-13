import { useEffect, useMemo, useState } from 'react'
import { Check } from '@phosphor-icons/react'

import { usedCells } from '../domain/grid'
import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { downloadBytes } from '../render/download'
import { buildExportBundle, type ExportContext, type ExportSelection } from '../render/exporters'
import { PREVIEW_SCALES } from '../render/previewImage'
import { renderThumbnailDataUrl } from '../render/thumbnail'
import { useOverlayEscape } from './overlayState'
import { Btn } from './ui'

interface ExportFlags {
  preview: boolean
  screen: boolean
  paper: boolean
}

/**
 * 导出（spec 9）：左边真实预览，右边 323px 输出列。
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
  })
  const [busy, setBusy] = useState(false)
  const [thumb, setThumb] = useState<string | null>(null)
  const copy = t('export')

  // Escape = 返回编辑；导出进行中不让退（文件生成到一半走了会以为失败）
  useOverlayEscape(!busy, closeExport)

  const selection: ExportSelection = {
    ...flags,
    csv: false,
    paperScope: 'boards',
    showCodes: false,
    screenCodes: true,
    screenBom: true,
    previewScale: PREVIEW_SCALES.print,
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
    const handle = setTimeout(() => setThumb(renderThumbnailDataUrl(grid, palette, 480, geom.boards)), 0)
    return () => clearTimeout(handle)
  }, [grid, palette, geom, empty])

  const toggle = (key: keyof ExportFlags, value: boolean) => {
    const next = { ...flags, [key]: value }
    // 全不勾就等于没导出，留一个
    if (!next.preview && !next.screen && !next.paper) return
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
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4">
          {/* 左：真实预览，占足视觉空间 */}
          <section
            aria-label={copy.previewTitle}
            className="flex items-center justify-center rounded-xl border border-line bg-surface p-4"
          >
            {empty ? (
              <div className="py-16 text-center">
                <p className="text-sm text-ink-2">{copy.emptyDesign}</p>
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

          <div className="flex w-full flex-col items-center gap-4">
            <fieldset disabled={busy} className="flex flex-wrap items-center justify-center gap-2 border-0 p-0">
              <OutputRow
                checked={flags.preview}
                onToggle={(v) => toggle('preview', v)}
                title={copy.optionPreview}
              />
              <OutputRow
                checked={flags.screen}
                onToggle={(v) => toggle('screen', v)}
                title={copy.optionVector}
              />
              <OutputRow
                checked={flags.paper}
                onToggle={(v) => toggle('paper', v)}
                title={copy.optionPrint}
              />
              <Btn variant="primary" onClick={() => void run()} disabled={busy || empty}>
                {busy ? copy.exporting : copy.title}
              </Btn>
            </fieldset>

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
}: {
  checked: boolean
  onToggle: (value: boolean) => void
  title: string
}) {
  return (
    <div
      className={`w-fit shrink-0 rounded-xl border bg-surface px-3 py-2.5 ${
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
          {checked && <Check size={10} weight="bold" />}
        </span>
        <span className="text-sm font-medium text-ink">{title}</span>
      </label>
    </div>
  )
}
