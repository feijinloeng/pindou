import {
  ArrowsClockwise,
  Crosshair,
  Eye,
  Image as ImageIcon,
  Palette,
  SquaresFour,
  X,
} from '@phosphor-icons/react'

import { CODE_ZOOM } from '../render/canvasViewport'
import { t } from '../i18n/zh'
import { useEditor, type PanelId } from '../editor/store'
import { useUi } from '../editor/uiState'
import { Z } from './overlayState'
import { Popover } from './ui'

/**
 * 工作区控件（spec 5.2）：
 * 左上四个辅助入口（图片 / 色号 / 底板 / 整图变换），右上「显示」和「专注」。
 * 浮在画布上，不透明表面，不动画布坐标系。
 */
export default function WorkspaceControls() {
  const panel = useEditor((s) => s.panel)
  const openPanel = useEditor((s) => s.openPanel)
  const openPicker = useEditor((s) => s.openPicker)
  const showCodes = useEditor((s) => s.showCodes)
  const setShowCodes = useEditor((s) => s.setShowCodes)
  const vp = useEditor((s) => s.vp)
  const focusMode = useUi((s) => s.focusMode)
  const setFocusMode = useUi((s) => s.setFocusMode)
  const setPanelBeforeFocus = useUi((s) => s.setPanelBeforeFocus)
  const copy = t('editor')

  const launchers: Array<{
    id: PanelId | 'boards'
    label: string
    icon: React.ReactNode
    onClick: () => void
    expanded: boolean
  }> = [
    {
      id: 'image',
      label: copy.launchImage,
      icon: <ImageIcon size={18} aria-hidden />,
      onClick: () => openPanel(panel === 'image' ? null : 'image'),
      expanded: panel === 'image',
    },
    {
      id: 'color',
      label: copy.launchColors,
      icon: <Palette size={18} aria-hidden />,
      onClick: () => openPanel(panel === 'color' ? null : 'color'),
      expanded: panel === 'color',
    },
    {
      id: 'boards',
      label: copy.launchBoards,
      icon: <SquaresFour size={18} aria-hidden />,
      onClick: () => openPicker('edit'),
      expanded: false,
    },
    {
      id: 'transform',
      label: copy.launchTransform,
      icon: <ArrowsClockwise size={18} aria-hidden />,
      onClick: () => openPanel(panel === 'transform' ? null : 'transform'),
      expanded: panel === 'transform',
    },
  ]

  const toggleFocus = () => {
    if (focusMode) {
      // 退出专注：恢复进来前开着的面板，输入内容都还在
      setFocusMode(false)
      const before = useUi.getState().panelBeforeFocus
      if (before) openPanel(before as PanelId)
      setPanelBeforeFocus(null)
    } else {
      setPanelBeforeFocus(panel)
      if (panel) openPanel(null)
      setFocusMode(true)
    }
  }

  if (focusMode) {
    // 专注模式：只留退出按钮，其余 chrome 全部退场
    return (
      <button
        type="button"
        onClick={toggleFocus}
        style={{ zIndex: Z.controls }}
        className="absolute top-4 right-4 flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-sm hover:bg-hover"
      >
        <X size={16} aria-hidden />
        {copy.exitFocus}
      </button>
    )
  }

  return (
    <>
      {/* 左上：辅助入口 */}
      <div
        role="toolbar"
        aria-label={copy.launchImage}
        style={{ zIndex: Z.controls }}
        className="absolute top-4 left-4 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm"
      >
        {launchers.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-expanded={item.id === 'boards' ? undefined : item.expanded}
            onClick={item.onClick}
            className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm ${
              item.expanded ? 'bg-hover font-medium text-accent' : 'text-ink hover:bg-hover'
            }`}
          >
            {item.icon}
            <span className="hidden md:inline">{item.label}</span>
          </button>
        ))}
      </div>

      {/* 右上：显示 + 专注 */}
      <div
        style={{ zIndex: Z.controls }}
        className="absolute top-4 right-4 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm"
      >
        <Popover
          title={copy.view}
          width="w-56"
          align="right"
          trigger={(open, toggle) => (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={copy.view}
              title={copy.view}
              onClick={toggle}
              className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm ${
                open || showCodes ? 'bg-hover font-medium text-accent' : 'text-ink hover:bg-hover'
              }`}
            >
              <Eye size={18} aria-hidden />
              <span className="hidden md:inline">{copy.view}</span>
            </button>
          )}
        >
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={showCodes}
              onChange={(e) => setShowCodes(e.target.checked)}
            />
            {copy.viewShowCodes}
          </label>
          {showCodes && vp.zoom < CODE_ZOOM && (
            <p className="mt-2 text-xs text-ink-2">{copy.viewCodesZoomHint}</p>
          )}
        </Popover>
        <button
          type="button"
          aria-pressed={focusMode}
          aria-label={copy.focus}
          title={copy.focus}
          onClick={toggleFocus}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink hover:bg-hover"
        >
          <Crosshair size={18} aria-hidden />
          <span className="hidden md:inline">{copy.focus}</span>
        </button>
      </div>
    </>
  )
}
