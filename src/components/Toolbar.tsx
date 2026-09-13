import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  FloppyDisk,
  Info,
  List,
  Warning,
} from '@phosphor-icons/react'

import { layoutSizeMm } from '../domain/board'
import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'
import { useUi, type MotionPref, type ThemePref } from '../editor/uiState'
import { navigate } from '../router'
import { usePickerActions } from '../pages/pickerActions'
import NewProjectDialog from './NewProjectDialog'
import { Btn, Field, INPUT_CLS, Menu, MenuItem, Modal, Popover } from './ui'

/**
 * 文档头（spec 5.1）：产品/菜单 · 作品名+详情 · 保存状态 · 导航 · 保存/导出。
 * 编辑页只有这一行头；选板时保存/导出换成确认/取消；导出时换成返回编辑。
 */
export default function Toolbar() {
  const name = useEditor((s) => s.name)
  const setName = useEditor((s) => s.setName)
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const stage = useEditor((s) => s.stage)
  const savedAt = useEditor((s) => s.savedAt)
  const saving = useEditor((s) => s.saving)
  const saveError = useEditor((s) => s.saveError)
  const saveNow = useEditor((s) => s.saveNow)
  const openExport = useEditor((s) => s.openExport)
  const closeExport = useEditor((s) => s.closeExport)
  const savedCommitVersion = useEditor((s) => s.savedCommitVersion)
  const commitVersion = useEditor((s) => s.commitVersion)
  const pickerConfirm = usePickerActions((s) => s.confirm)
  const pickerCancel = usePickerActions((s) => s.cancel)
  const pickerCanConfirm = usePickerActions((s) => s.canConfirm)
  const [newOpen, setNewOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const copy = t('editor')

  // 保存门：保存成功后内容一变（commitVersion 变了）就重新关上
  const gateOpen = savedCommitVersion !== null && savedCommitVersion === commitVersion

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:h-16">
      <Menu label={<List size={18} aria-hidden />} title={copy.menu} width="w-60">
        {(close) => (
          <>
            <MenuItem
              onClick={() => {
                setNewOpen(true)
                close()
              }}
            >
              {copy.newProject}
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <MenuItem
              onClick={() => {
                navigate('library')
                close()
              }}
            >
              {t('nav').library}
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate('editor')
                close()
              }}
            >
              {t('nav').editor}
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate('follow')
                close()
              }}
            >
              {t('nav').follow}
            </MenuItem>
            <div className="my-1 h-px bg-line" />
            <ThemeItems />
            <MotionItems />
            <div className="my-1 h-px bg-line" />
            <MenuItem
              onClick={() => {
                setHelpOpen(true)
                close()
              }}
            >
              {copy.help}
            </MenuItem>
          </>
        )}
      </Menu>
      <span className="hidden text-sm font-semibold md:inline">{t('appName')}</span>

      {stage === 'export' && !pickerOpen ? (
        <>
          <Btn onClick={closeExport}>
            <ArrowLeft size={16} aria-hidden />
            {t('export').backToEdit}
          </Btn>
          <span className="ml-1 truncate text-sm text-ink-2">
            {t('export').title} · {name}
          </span>
          {savedAt && (
            <span className="ml-auto hidden items-center gap-1 text-xs text-ink-2 md:inline-flex">
              <Check size={14} aria-hidden /> {copy.savedAt} {savedTime(savedAt)}
            </span>
          )}
        </>
      ) : (
        <>
          <input
            className="w-[200px] min-w-[120px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-ink hover:border-line focus:border-line focus:bg-surface"
            value={name}
            placeholder={t('library').namePlaceholder}
            aria-label={t('library').namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
          <DetailsButton />

          <div className="ml-auto flex items-center gap-2">
            {pickerOpen ? (
              <>
                <Btn onClick={() => pickerCancel?.()}>{t('picker').cancel}</Btn>
                <Btn
                  variant="primary"
                  disabled={!pickerCanConfirm}
                  onClick={() => pickerConfirm?.()}
                >
                  {t('picker').confirmShort}
                </Btn>
              </>
            ) : (
              <>
                <SaveStatus
                  saving={saving}
                  saveError={saveError}
                  savedAt={savedAt}
                  gateOpen={gateOpen}
                  onRetry={() => void saveNow(true)}
                />
                <Btn onClick={() => navigate('library')} variant="ghost" title={t('nav').library}>
                  <span className="hidden lg:inline">{t('nav').library}</span>
                  <span className="lg:hidden">库</span>
                </Btn>
                <Btn onClick={() => navigate('follow')} variant="ghost" title={t('nav').follow}>
                  <span className="hidden lg:inline">{t('nav').follow}</span>
                  <span className="lg:hidden">跟</span>
                </Btn>
                <Btn
                  onClick={() => void saveNow(true)}
                  disabled={saving}
                  title={copy.saveHint}
                  variant={gateOpen ? 'secondary' : 'primary'}
                >
                  <FloppyDisk size={16} aria-hidden />
                  <span className="hidden sm:inline">{copy.save}</span>
                </Btn>
                <Btn
                  variant="primary"
                  onClick={openExport}
                  disabled={!gateOpen}
                  title={gateOpen ? copy.nextExport : copy.exportGate}
                >
                  {copy.export}
                </Btn>
              </>
            )}
          </div>
        </>
      )}

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={copy.help}>
        <p className="text-sm leading-relaxed text-ink-2">{copy.shortcutsBody}</p>
        <div className="mt-3 flex justify-end">
          <Btn onClick={() => setHelpOpen(false)}>{t('library').cancel}</Btn>
        </div>
      </Modal>
    </header>
  )
}

/** 保存状态：成功打勾不换宽度；失败常显 + 可点重试；门没开时给出「导出前请保存」 */
function SaveStatus({
  saving,
  saveError,
  savedAt,
  gateOpen,
  onRetry,
}: {
  saving: boolean
  saveError: string | null
  savedAt: string | null
  gateOpen: boolean
  onRetry: () => void
}) {
  const copy = t('editor')
  if (saving) {
    return <span className="text-xs text-ink-2 tabular">{copy.saving}</span>
  }
  if (saveError) {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-hover"
      >
        <Warning size={14} aria-hidden />
        {copy.saveRetry}
      </button>
    )
  }
  return (
    <span aria-live="polite" className="hidden items-center gap-1 text-xs text-ink-2 tabular sm:flex">
      {gateOpen && savedAt ? (
        <>
          <Check size={14} className="text-accent" aria-hidden />
          {copy.savedAt} {savedTime(savedAt)}
        </>
      ) : savedAt ? (
        <>
          {copy.autoSaved} {savedTime(savedAt)}
          <span className="text-danger">{copy.exportGate}</span>
        </>
      ) : (
        copy.unsaved
      )}
    </span>
  )
}

/** 项目详情气泡：客户/订单备注 + 只读板阵摘要 */
function DetailsButton() {
  const customer = useEditor((s) => s.customer)
  const setCustomer = useEditor((s) => s.setCustomer)
  const geom = useEditor((s) => s.geom)
  const layout = useEditor((s) => s.layout)
  const copy = t('editor')
  const size = layoutSizeMm(geom)

  return (
    <Popover
      title={copy.details}
      width="w-72"
      trigger={(open, toggle) => (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={copy.details}
          title={copy.details}
          onClick={toggle}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink ${
            open ? 'bg-hover text-ink' : ''
          }`}
        >
          <Info size={18} aria-hidden />
        </button>
      )}
    >
      <div className="flex flex-col gap-3">
        <Field label={copy.customer}>
          <input
            className={INPUT_CLS}
            value={customer ?? ''}
            placeholder={copy.customerPlaceholder}
            onChange={(e) => setCustomer(e.target.value.trim() ? e.target.value : null)}
          />
        </Field>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-2">
          <dt>{t('library').boards}</dt>
          <dd className="text-right tabular">{layout.placements.length}</dd>
          <dt>{t('library').cells}</dt>
          <dd className="text-right tabular">
            {geom.cols}×{geom.rows}
          </dd>
          <dt>{t('library').physicalSize}</dt>
          <dd className="text-right tabular">
            {size.w.toFixed(0)}×{size.h.toFixed(0)}mm
          </dd>
        </dl>
      </div>
    </Popover>
  )
}

function ThemeItems() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const copy = t('editor')
  const options: Array<[ThemePref, string]> = [
    ['system', copy.themeSystem],
    ['light', copy.themeLight],
    ['dark', copy.themeDark],
  ]
  return (
    <>
      <p className="px-2 pt-1 text-xs text-ink-2">{copy.theme}</p>
      {options.map(([id, label]) => (
        <MenuItem key={id} onClick={() => setTheme(id)}>
          {theme === id ? `✓ ${label}` : label}
        </MenuItem>
      ))}
    </>
  )
}

function MotionItems() {
  const motion = useUi((s) => s.motion)
  const setMotion = useUi((s) => s.setMotion)
  const copy = t('editor')
  const options: Array<[MotionPref, string]> = [
    ['system', copy.motionSystem],
    ['reduced', copy.motionReduced],
  ]
  return (
    <>
      <p className="px-2 pt-1 text-xs text-ink-2">{copy.motionPref}</p>
      {options.map(([id, label]) => (
        <MenuItem key={id} onClick={() => setMotion(id)}>
          {motion === id ? `✓ ${label}` : label}
        </MenuItem>
      ))}
    </>
  )
}

/** ISO 时间 → 14:05（本地时区，只给用户看） */
function savedTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}