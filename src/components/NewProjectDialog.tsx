import { useState } from 'react'

import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { putProject } from '../storage/db'
import { Btn, Field, INPUT_CLS, Modal } from './ui'

/**
 * 新建作品的唯一入口（作品库的主操作和应用菜单都走这里）：
 * 名字可空（回退「未命名作品」）→ 先把上一个工程冲掉 → 建一个空白工程。
 */
export default function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const copy = t('library')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const editor = useEditor.getState()
      // 旧工程先落盘，别让上一个作品的 pending 改动被新工程盖掉
      await editor.saveNow()
      editor.newProject(name.trim() || copy.untitled)
      await putProject(useEditor.getState().toProject())
      setName('')
      onClose()
    } catch (cause) {
      window.alert(`${copy.writeFailed}：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={copy.newDialogTitle}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field label={copy.namePlaceholder} hint={copy.newDialogHint}>
          <input
            className={INPUT_CLS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.untitled}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={onClose}>{copy.cancel}</Btn>
          <Btn type="submit" variant="primary" disabled={busy}>
            {copy.create}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
