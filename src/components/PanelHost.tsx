import ColorList from './ColorList'
import ConvertPanel from './ConvertPanel'
import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'

/**
 * 临时面板宿主：同一时间最多开一个，浮在画布右缘。
 * 用浮层而不是挤压画布宽度，开合面板就不会把用户的编辑目标推出视野、也不会重置缩放。
 */
export default function PanelHost() {
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const colorPinned = useEditor((s) => s.colorPinned)
  const setColorPinned = useEditor((s) => s.setColorPinned)
  const copy = t('editor')
  if (!panel) return null

  return (
    <aside
      aria-label={panel === 'color' ? copy.colors : t('convert').title}
      className="absolute top-0 right-0 z-20 flex h-full w-72 flex-col border-l border-neutral-200 bg-white shadow-xl"
    >
      <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <h2 className="text-xs font-semibold">
          {panel === 'color' ? copy.colors : t('convert').title}
        </h2>
        {panel === 'color' ? (
          <button
            type="button"
            aria-pressed={colorPinned}
            onClick={() => setColorPinned(!colorPinned)}
            title={copy.pinColorHint}
            className={`ml-auto rounded border px-2 py-0.5 text-[11px] ${
              colorPinned
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            {copy.pinColor}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => openPanel(null)}
          aria-label={copy.closePanel}
          title={copy.closePanel}
          className={`flex h-6 w-6 items-center justify-center rounded text-xs text-neutral-500 hover:bg-neutral-100 ${
            panel === 'color' ? '' : 'ml-auto'
          }`}
        >
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel === 'color' ? <ColorList /> : <ConvertPanel />}
      </div>
    </aside>
  )
}
