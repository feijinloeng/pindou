import { useRef, useState } from 'react'

import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
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
  const busyRef = useRef(false)
  const close = () => { if (!busyRef.current) onClose() }

  const create = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      useEditor.getState().pointerUp()
      const editor = useEditor.getState()
      await editor.saveNow()
      const current = useEditor.getState()
      if (current.projectId !== editor.projectId || current.commitVersion !== editor.commitVersion) {
        throw new Error(t('storage').changedDuringOperation)
      }
      editor.newProject(name.trim() || copy.untitled)
      // 新工程也走 Store 的正式保存，保存状态与导出权限保持同步。
      await useEditor.getState().saveNow(true)
      setName('')
      onClose()
    } catch (cause) {
      window.alert(`${copy.writeFailed}：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title={copy.newDialogTitle} dismissable={!busy}>
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
          <Btn onClick={close} disabled={busy}>{copy.cancel}</Btn>
          <Btn type="submit" variant="primary" disabled={busy}>
            {copy.create}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
