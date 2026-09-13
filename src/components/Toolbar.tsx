import { layoutSizeMm } from '../domain/board'
import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'
import { navigate } from '../router'
import { Dropdown, MenuItem, PrimaryBtn } from './ui'

/**
 * 一行表头：菜单 / 作品名 / 当前阶段 / 保存状态 / 主操作。
 * 板阵尺寸、缩放、客户信息这些都不常驻 —— 各自只有一个家在菜单和画布边上。
 */
export default function Toolbar() {
  const name = useEditor((s) => s.name)
  const setName = useEditor((s) => s.setName)
  const customer = useEditor((s) => s.customer)
  const setCustomer = useEditor((s) => s.setCustomer)
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const stage = useEditor((s) => s.stage)
  const savedAt = useEditor((s) => s.savedAt)
  const saving = useEditor((s) => s.saving)
  const saveError = useEditor((s) => s.saveError)
  const saveNow = useEditor((s) => s.saveNow)
  const openExport = useEditor((s) => s.openExport)
  const openPicker = useEditor((s) => s.openPicker)
  const openPanel = useEditor((s) => s.openPanel)
  const showCodes = useEditor((s) => s.showCodes)
  const setShowCodes = useEditor((s) => s.setShowCodes)
  const savedCommitVersion = useEditor((s) => s.savedCommitVersion)
  const commitVersion = useEditor((s) => s.commitVersion)
  const geom = useEditor((s) => s.geom)
  const layout = useEditor((s) => s.layout)
  const copy = t('editor')
  const size = layoutSizeMm(geom)

  // 保存门：保存成功后内容一变（commitVersion 变了）就重新关上
  const gateOpen = savedCommitVersion !== null && savedCommitVersion === commitVersion

  /** 整图操作：先清选区，镜像 / 旋转才是整张图的意思 */
  const whole = (run: (state: ReturnType<typeof useEditor.getState>) => void) => {
    const state = useEditor.getState()
    state.clearSel()
    run(state)
  }

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-2 py-1.5">
      <Dropdown label={copy.menu} title="项目菜单和整图操作" width="w-72">
        {(close) => (
          <>
            <p className="px-2 pt-1 text-[11px] font-semibold tracking-wide text-neutral-500">
              {copy.menuProject}
            </p>
            <label className="flex flex-col gap-1 px-2 pb-1 text-xs text-neutral-600">
              {copy.customer}
              <input
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                value={customer ?? ''}
                placeholder={copy.customerPlaceholder}
                onChange={(e) => setCustomer(e.target.value.trim() ? e.target.value : null)}
              />
            </label>
            <p className="px-2 pb-1 text-[11px] leading-relaxed text-neutral-500">
              {layout.placements.length} 块板 · {geom.cols}×{geom.rows} 格 ·{' '}
              {size.w.toFixed(0)}×{size.h.toFixed(0)}mm
            </p>
            <MenuItem
              onClick={() => {
                openPicker('edit')
                close()
              }}
            >
              {copy.adjustBoards}
            </MenuItem>

            <p className="mt-1 px-2 pt-1 text-[11px] font-semibold tracking-wide text-neutral-500">
              {copy.imageMenu}
            </p>
            <MenuItem
              onClick={() => {
                openPanel('image')
                close()
              }}
            >
              {copy.importImage}
            </MenuItem>
            <MenuItem
              onClick={() => {
                whole((s) => s.rotate(1))
                close()
              }}
            >
              {copy.rotateWholeCw}
            </MenuItem>
            <MenuItem
              onClick={() => {
                whole((s) => s.rotate(-1))
                close()
              }}
            >
              {copy.rotateWholeCcw}
            </MenuItem>
            <MenuItem
              onClick={() => {
                whole((s) => s.mirror('h'))
                close()
              }}
            >
              {copy.mirrorWholeH}
            </MenuItem>
            <MenuItem
              onClick={() => {
                whole((s) => s.mirror('v'))
                close()
              }}
            >
              {copy.mirrorWholeV}
            </MenuItem>
            <p className="px-2 pt-1 text-[11px] text-neutral-500">{copy.moveWhole}</p>
            <div className="flex gap-1 px-2 pb-1">
              {(
                [
                  ['←', -1, 0],
                  ['→', 1, 0],
                  ['↑', 0, -1],
                  ['↓', 0, 1],
                ] as const
              ).map(([arrow, dc, dr]) => (
                <button
                  key={arrow}
                  type="button"
                  aria-label={`${copy.moveWhole} ${arrow}`}
                  className="h-7 w-7 rounded border border-neutral-300 text-xs hover:bg-neutral-100"
                  onClick={() => whole((s) => s.translate(dc, dr))}
                >
                  {arrow}
                </button>
              ))}
            </div>

            <MenuItem onClick={() => setShowCodes(!showCodes)}>
              {showCodes ? `✓ ${copy.showCodes}` : copy.showCodes}
            </MenuItem>

            <div className="my-1 h-px bg-neutral-200" />
            <MenuItem onClick={() => navigate('library')}>{t('nav').library}</MenuItem>
            <MenuItem onClick={() => navigate('follow')}>{t('nav').follow}</MenuItem>
            <details className="px-2 py-1 text-[11px] leading-relaxed text-neutral-500">
              <summary className="cursor-pointer">{copy.shortcuts}</summary>
              <p className="mt-1">{copy.shortcutsBody}</p>
            </details>
          </>
        )}
      </Dropdown>

      <input
        className="w-40 rounded border border-neutral-300 px-2 py-1 text-xs"
        value={name}
        placeholder={t('library').namePlaceholder}
        aria-label={t('library').namePlaceholder}
        onChange={(e) => setName(e.target.value)}
      />

      <span className="rounded bg-neutral-100 px-2 py-1 text-[11px] text-neutral-500">
        {pickerOpen ? copy.stagePick : stage === 'export' ? copy.stageExport : copy.stageEdit}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <span
          aria-live="polite"
          className={`text-xs tabular-nums ${saveError ? 'text-red-600' : 'text-neutral-500'}`}
        >
          {saving
            ? copy.saving
            : saveError
              ? copy.saveRetry
              : gateOpen && savedAt
                ? `${copy.savedAt} ${savedTime(savedAt)}`
                : savedAt
                  ? `${copy.autoSaved} ${savedTime(savedAt)}·${copy.needSave}`
                  : copy.unsaved}
        </span>
        {stage === 'edit' && !pickerOpen && gateOpen && (
          <PrimaryBtn onClick={openExport} title="内容已保存，可以导出了">
            {copy.nextExport}
          </PrimaryBtn>
        )}
        <button
          type="button"
          onClick={() => void saveNow(true)}
          disabled={saving}
          title={copy.saveHint}
          className={`rounded border px-2 py-1 text-xs whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40 ${
            gateOpen
              ? 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
              : 'border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800'
          }`}
        >
          {copy.save}
        </button>
      </div>
    </div>
  )
}

/** ISO 时间 → 14:05（本地时区，只给用户看） */
function savedTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
