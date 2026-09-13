import { labelTextColor } from '../domain/palette'
import { t } from '../i18n/zh'
import { useEditor, type ToolId } from '../editor/store'

/** 常用工具就这么几个，竖着排一条窄轨：画布占到窗口 90% 以上靠的就是这里的窄 */
const TOOLS: Array<{ id: ToolId; label: string; hint: string; key: string }> = [
  { id: 'pencil', label: '画', hint: '画笔：拖拽连续落色', key: 'B' },
  { id: 'eraser', label: '擦', hint: '橡皮：把格子设回空格', key: 'E' },
  { id: 'bucket', label: '桶', hint: '油漆桶：4 邻域同色连通块填充', key: 'G' },
  { id: 'picker', label: '吸', hint: '取色：吸取某格色号', key: 'I' },
  { id: 'select', label: '点', hint: '点选：点一格改成当前色号', key: 'V' },
  { id: 'rect', label: '框', hint: '框选：拖框选区，Shift 追加', key: 'M' },
]

export default function ToolRail() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const palette = useEditor((s) => s.palette)
  const colorIndex = useEditor((s) => s.colorIndex)
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const copy = t('editor')
  const color = palette.colors[colorIndex]
  const onColor = color ? labelTextColor(color.hex) : 'white'

  const cell =
    'flex h-9 w-9 items-center justify-center rounded border text-xs transition disabled:cursor-not-allowed disabled:opacity-30'
  const idle = 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'

  return (
    <nav
      aria-label={copy.tool}
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-neutral-200 bg-white py-2"
    >
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.hint}
          aria-pressed={tool === item.id}
          title={`${item.hint}（快捷键 ${item.key}）`}
          onClick={() => setTool(item.id)}
          className={`${cell} ${
            tool === item.id ? 'border-neutral-900 bg-neutral-900 text-white' : idle
          }`}
        >
          {item.label}
        </button>
      ))}

      <div className="my-1 h-px w-8 bg-neutral-200" />

      {color && (
        <button
          type="button"
          aria-pressed={panel === 'color'}
          aria-label={`${copy.activeColor} ${color.code} ${color.name}，点一下打开颜色面板`}
          title={`${copy.activeColor} ${color.code} ${color.name}`}
          onClick={() => openPanel(panel === 'color' ? null : 'color')}
          className={`flex h-9 w-9 flex-col items-center justify-center rounded border text-[9px] leading-tight ${
            panel === 'color' ? 'border-neutral-900 ring-2 ring-neutral-900' : 'border-neutral-300'
          }`}
          style={{ backgroundColor: color.hex }}
        >
          <span className={onColor === 'black' ? 'text-black/90' : 'text-white/95'}>
            {color.code}
          </span>
        </button>
      )}

      <div className="my-1 h-px w-8 bg-neutral-200" />

      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label={copy.undo}
        title={`${copy.undo}（Cmd/Ctrl+Z）`}
        className={`${cell} ${idle}`}
      >
        ↶
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label={copy.redo}
        title={`${copy.redo}（Shift+Cmd/Ctrl+Z）`}
        className={`${cell} ${idle}`}
      >
        ↷
      </button>
    </nav>
  )
}
