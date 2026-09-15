import { useRef, useState } from 'react'
import { Image as ImageIcon } from '@phosphor-icons/react'

import { useEditor } from '../editor/store'
import { t } from '../i18n/zh'
import { Btn } from './ui'

/** Image import: accept a file, then convert it to the current board layout at its native aspect ratio. */
export default function ConvertPanel() {
  const converting = useEditor((s) => s.converting)
  const hasBoards = useEditor((s) => s.geom.boards.length > 0)
  const progress = useEditor((s) => s.progress)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const copy = t('convert')

  const importFile = (file: File | undefined) => {
    if (!file) return
    setDragging(false)
    void useEditor.getState().importImage(file)
  }

  return (
    <div
      aria-busy={converting}
      className={`flex min-h-[240px] w-[min(92vw,500px)] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-7 text-center shadow-lg ${
        dragging ? 'border-accent bg-hover' : 'border-line bg-surface'
      }`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        importFile(event.dataTransfer.files?.[0])
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          importFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <ImageIcon size={32} className="text-ink-2" aria-hidden />
      <Btn
        variant="primary"
        onClick={() => fileRef.current?.click()}
        disabled={converting || !hasBoards}
      >
        {converting ? `${copy.running}…` : copy.pickImage}
      </Btn>
      <p className="max-w-[380px] text-sm leading-relaxed text-ink-2">
        {hasBoards ? copy.pickHint : copy.noBoards}
      </p>
      {dragging && <p className="text-xs text-accent">{copy.dropActive}</p>}
      {progress && (
        <div className="w-full max-w-[320px]">
          <div className="h-1.5 w-full overflow-hidden rounded bg-line">
            <div
              className="h-full origin-left bg-accent transition-transform duration-150"
              style={{ transform: `scaleX(${progress.ratio})` }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-2">{progress.stage}</p>
        </div>
      )}
    </div>
  )
}
