import { layoutSizeMm } from '../domain/board'
import { t } from '../i18n/zh'
import { useEditor, type ToolId } from '../editor/store'
import { clampZoom, snapZoom } from '../render/canvasViewport'
import { Btn } from './ui'

const TOOLS: Array<{ id: ToolId; label: string; hint: string; key: string }> = [
  { id: 'select', label: t('editor').tools.select, hint: '点一格改成当前色号', key: 'V' },
  { id: 'pencil', label: t('editor').tools.pencil, hint: '拖拽连续落色', key: 'B' },
  { id: 'eraser', label: t('editor').tools.eraser, hint: '把格子设回空格', key: 'E' },
  { id: 'picker', label: t('editor').tools.picker, hint: '吸取某格色号', key: 'I' },
  { id: 'bucket', label: t('editor').tools.bucket, hint: '4 邻域同色连通块填充', key: 'G' },
  { id: 'rect', label: t('editor').tools.rect, hint: '拖框选区，Shift 追加', key: 'M' },
]

export default function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const vp = useEditor((s) => s.vp)
  const setVp = useEditor((s) => s.setVp)
  const showCodes = useEditor((s) => s.showCodes)
  const setShowCodes = useEditor((s) => s.setShowCodes)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const geom = useEditor((s) => s.geom)
  const layout = useEditor((s) => s.layout)
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const openPicker = useEditor((s) => s.openPicker)
  const savedAt = useEditor((s) => s.savedAt)
  const saving = useEditor((s) => s.saving)
  const saveError = useEditor((s) => s.saveError)
  const saveNow = useEditor((s) => s.saveNow)
  const name = useEditor((s) => s.name)
  const setName = useEditor((s) => s.setName)
  const customer = useEditor((s) => s.customer)
  const setCustomer = useEditor((s) => s.setCustomer)
  const panelsOpen = useEditor((s) => s.panelsOpen)
  const togglePanels = useEditor((s) => s.togglePanels)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      <input
        className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs"
        value={name}
        placeholder={t('library').namePlaceholder}
        aria-label={t('library').namePlaceholder}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs"
        value={customer ?? ''}
        placeholder={t('editor').customerPlaceholder}
        aria-label={t('editor').customer}
        onChange={(e) => setCustomer(e.target.value.trim() ? e.target.value : null)}
      />
      <Btn active={pickerOpen} onClick={openPicker} title="重新拼台面（会保留重叠位置上的内容）">
        {t('editor').chooseBoard}
      </Btn>
      <span className="text-xs text-neutral-500 tabular-nums">
        {layout.placements.length} 块 · {geom.cols}×{geom.rows} ·{' '}
        {layoutSizeMm(geom).w.toFixed(0)}×{layoutSizeMm(geom).h.toFixed(0)}mm
      </span>

      <div className="flex gap-1">
        {TOOLS.map((toolDef) => (
          <Btn
            key={toolDef.id}
            active={tool === toolDef.id}
            title={`${toolDef.hint}（快捷键 ${toolDef.key}）`}
            onClick={() => setTool(toolDef.id)}
          >
            {toolDef.label}
          </Btn>
        ))}
      </div>

      <div className="flex gap-1">
        <Btn disabled={!canUndo} onClick={undo} title="Cmd/Ctrl+Z">
          {t('editor').undo}
        </Btn>
        <Btn disabled={!canRedo} onClick={redo} title="Shift+Cmd/Ctrl+Z">
          {t('editor').redo}
        </Btn>
      </div>

      <Btn active={showCodes} onClick={() => setShowCodes(!showCodes)}>
        {t('editor').showCodes}
      </Btn>

      <button
        type="button"
        onClick={togglePanels}
        aria-pressed={panelsOpen}
        title={t('editor').panelsHint}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
      >
        {panelsOpen ? t('editor').panelsHide : t('editor').panelsShow}
      </button>

      <span
        aria-live="polite"
        className={`ml-auto text-xs tabular-nums ${saveError ? 'text-red-600' : 'text-neutral-500'}`}
      >
        {saving
          ? t('editor').saving
          : saveError
            ? t('editor').saveRetry
            : savedAt
              ? `${t('editor').savedAt} ${savedTime(savedAt)}`
              : t('editor').save}
      </span>
      <button
        type="button"
        onClick={() => void saveNow()}
        disabled={saving}
        title={t('editor').saveHint}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
      >
        {t('editor').save}
      </button>

      <label className="flex items-center gap-2 text-xs text-neutral-600">
        {t('editor').zoom}
        <input
          type="range"
          min={-6}
          max={30}
          step={0.1}
          value={Math.log2(vp.zoom)}
          onChange={(e) => {
            const z = clampZoom(snapZoom(Math.pow(2, Number(e.target.value))))
            setVp({ ...vp, zoom: z })
          }}
          className="w-40"
        />
        <span className="w-12 tabular-nums">{Math.round(vp.zoom * 100)}%</span>
      </label>
    </div>
  )
}

/** ISO 时间 → 14:05（本地时区，只给用户看） */
function savedTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
