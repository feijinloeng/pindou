import { useState } from 'react'
import {
  ArrowLeft,
  FloppyDisk,
  List,
} from '@phosphor-icons/react'

import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'
import { useUi, type MotionPref, type ThemePref } from '../editor/uiState'
import { navigate } from '../router'
import { usePickerActions } from '../pages/pickerActions'
import NewProjectDialog from './NewProjectDialog'
import { Btn, Menu, MenuItem, Modal } from './ui'

/**
 * Excalidraw 式浮层文档头：菜单在左，保存和输出在右。
 * 它不占用画布高度，只负责界面 chrome；画布始终铺满工作区。
 */
export default function Toolbar() {
  const name = useEditor((s) => s.name)
  const pickerOpen = useEditor((s) => s.pickerOpen)
  const stage = useEditor((s) => s.stage)
  const saving = useEditor((s) => s.saving)
  const saveNow = useEditor((s) => s.saveNow)
  const openExport = useEditor((s) => s.openExport)
  const closeExport = useEditor((s) => s.closeExport)
  const savedCommitVersion = useEditor((s) => s.savedCommitVersion)
  const commitVersion = useEditor((s) => s.commitVersion)
  const pickerCancel = usePickerActions((s) => s.cancel)
  const [newOpen, setNewOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const copy = t('editor')

  // 保存门：保存成功后内容一变（commitVersion 变了）就重新关上
  const gateOpen = savedCommitVersion !== null && savedCommitVersion === commitVersion

  return (
    <header className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-2 max-sm:inset-x-2">
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <Menu label={<List size={17} aria-hidden />} title={copy.menu} width="w-60">
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

        {pickerOpen ? (
          <div className="flex h-9 min-w-0 items-center rounded-xl border border-line bg-surface px-2 shadow-md">
            <span className="px-1 text-sm font-medium">{copy.chooseBoard}</span>
          </div>
        ) : stage === 'export' ? (
          <div className="flex h-9 min-w-0 items-center gap-1 rounded-xl border border-line bg-surface px-1 shadow-md">
            <Btn onClick={closeExport} variant="ghost" title={t('export').backToEdit}>
              <ArrowLeft size={14} aria-hidden />
              <span className="hidden sm:inline">{t('export').backToEdit}</span>
            </Btn>
            <span className="max-w-[min(221px,28vw)] truncate px-2 text-sm text-ink-2">
              {t('export').title} · {name}
            </span>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-md">
        {pickerOpen ? (
          <Btn onClick={() => pickerCancel?.()}>{t('picker').cancel}</Btn>
        ) : stage === 'export' ? null : (
          <>
            <Btn
              onClick={() => void saveNow(true)}
              disabled={saving}
              title={copy.saveHint}
              variant={gateOpen ? 'secondary' : 'ghost'}
            >
              <FloppyDisk size={14} aria-hidden />
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
