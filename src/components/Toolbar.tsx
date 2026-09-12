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

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
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

      <label className="ml-auto flex items-center gap-2 text-xs text-neutral-600">
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
