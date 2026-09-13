import {
  ArrowLeft,
  FloppyDisk,
} from '@phosphor-icons/react'

import { t } from '../i18n/zh'
import { useEditor } from '../editor/store'
import { Btn } from './ui'

/**
 * Excalidraw 式浮层文档头：导出时提供返回编辑，保存和输出在右。
 * 它不占用画布高度，只负责界面 chrome；画布始终铺满工作区。
 */
export default function Toolbar() {
  const stage = useEditor((s) => s.stage)
  const saving = useEditor((s) => s.saving)
  const saveNow = useEditor((s) => s.saveNow)
  const openExport = useEditor((s) => s.openExport)
  const closeExport = useEditor((s) => s.closeExport)
  const savedCommitVersion = useEditor((s) => s.savedCommitVersion)
  const commitVersion = useEditor((s) => s.commitVersion)
  const copy = t('editor')

  // 保存门：保存成功后内容一变（commitVersion 变了）就重新关上
  const gateOpen = savedCommitVersion !== null && savedCommitVersion === commitVersion

  return (
    <header className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-2 max-sm:inset-x-2">
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        {stage === 'export' ? (
          <button
            type="button"
            onClick={closeExport}
            aria-label={t('export').backToEdit}
            title={t('export').backToEdit}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-ink shadow-md hover:bg-hover"
          >
            <ArrowLeft size={14} aria-hidden />
          </button>
        ) : null}
      </div>

      {stage !== 'export' && (
        <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-md">
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
        </div>
      )}

    </header>
  )
}

