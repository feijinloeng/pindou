import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getPalette } from '../data/palettes'

import { deriveLayoutGeometry } from '../domain/board'


import {
  createProject,
  normalizeGridForLayout,
  parseProject,
  projectSummary,
  serializeProject,
  type Project,
} from '../domain/project'
import { useEditor } from '../editor/store'
import { navigate } from '../router'
import { downloadBytes, safeName } from '../render/download'
import { renderThumbnailDataUrl } from '../render/thumbnail'
import {
  clearDraft,
  getDraft,
  listProjectEntries,
  purgeProject,
  putProject,
  restoreProject,
  trashProject,
  type LibraryEntry,
} from '../storage/db'
import { t } from '../i18n/zh'
import { Btn } from '../components/ui'

export default function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const copy = t('library')

  const refresh = useCallback(() => {
    // 读失败 ≠ 没有作品：直接清空列表会让用户以为作品丢了
    const fail = (cause: unknown) => setError(`${t('library').readFailed}：${message(cause)}`)
    return listProjectEntries()
      .then((listing) => {
        setEntries(listing.entries)
        setIssues(listing.issues)
        setError(null)
      })
      .catch(fail)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 所有写盘操作都从这过：busy 挡住重复点击，失败一定在界面上说清楚 */
  const runWrite = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (cause) {
      setError(`${copy.writeFailed}：${message(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const newProject = () =>
    runWrite(async () => {
      const editor = useEditor.getState()
      // 不预设板阵：进编辑器先让人自己拼台面（选板页）
      editor.newProject(name.trim() || copy.untitled)
      await putProject(editor.toProject())
      navigate('editor')
    })

  const openProject = async (id: string) => {
    try {
      // 优先打开草稿（可能比正式保存的更新）
      const draft = await getDraft(id)
      const target = draft ?? entries.find((e) => e.project.id === id)?.project
      if (!target) return
      useEditor.getState().loadProject(target)
      setError(null)
      navigate('editor')
    } catch (cause) {
      setError(`打开失败：${message(cause)}`)
    }
  }

  const duplicate = (project: Project) =>
    runWrite(async () => {
      const clone = createProject({
        name: `${project.name} 副本`,
        layout: project.layout,
        paletteId: project.paletteId,
        grid: normalizeGridForLayout(project.grid, deriveLayoutGeometry(project.layout)).grid,
      })
      // 副本是“完整副本”：客户、色号白名单、转换参数都跟着走
      await putProject({
        ...clone,
        customer: project.customer,
        allowedCodes: project.allowedCodes,
        conversion: project.conversion,
        making: project.making,
      })
      await refresh()
    })

  const rename = (project: Project) =>
    runWrite(async () => {
      const next = window.prompt(copy.renamePrompt, project.name)
      if (!next) return
      await putProject({ ...project, name: next, updatedAt: new Date().toISOString() })
      await refresh()
    })

  const remove = (project: Project) =>
    runWrite(async () => {
      await trashProject(project.id)
      await clearDraft(project.id)
      await refresh()
    })

  const restore = (project: Project) =>
    runWrite(async () => {
      await restoreProject(project.id)
      await refresh()
    })

  const exportProject = (project: Project) => {
    const text = serializeProject(project)
    downloadBytes(
      new TextEncoder().encode(text),
      `${safeName(project.name)}.pindou.json`,
      'application/json',
    )
  }

  const importProject = async (file: File) => {
    try {
      const text = await file.text()
      // 色板大小不再由调用方猜：validateProject 自己会查色板 id
      const result = parseProject(text)
      if (!result.project) {
        window.alert(`${copy.importFailed}\n${result.error?.message ?? ''}`)
        return
      }
      await putProject(result.project)
      await refresh()
      if (result.error) window.alert(result.error.message)
    } catch (cause) {
      setError(`${copy.importFailed}：${message(cause)}`)
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{copy.title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
            placeholder={copy.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Btn onClick={() => void newProject()} disabled={busy}>
            {copy.new}
          </Btn>
          <Btn onClick={() => fileRef.current?.click()} disabled={busy}>
            {copy.import}
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importProject(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700"
        >
          {error}
          <Btn onClick={() => void refresh()}>{copy.retry}</Btn>
        </p>
      )}

      {issues.length > 0 && (
        <ul role="status" className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {loading && <p className="text-sm text-neutral-500">{copy.loading}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-neutral-500">{copy.empty}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <ProjectCard
            key={entry.project.id}
            entry={entry}
            onOpen={() => void openProject(entry.project.id)}
            onDuplicate={() => void duplicate(entry.project)}
            onRename={() => void rename(entry.project)}
            onDelete={() => void remove(entry.project)}
            onRestore={() => void restore(entry.project)}
            onPurge={() => {
              if (window.confirm(copy.purgeConfirm)) {
                void runWrite(async () => {
                  await purgeProject(entry.project.id)
                  await refresh()
                })
              }
            }}
            onExport={() => exportProject(entry.project)}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  entry,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onRestore,
  onPurge,
  onExport,
}: {
  entry: LibraryEntry
  onOpen: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
  onExport: () => void
}) {
  const project = entry.project
  const [thumb, setThumb] = useState<string | null>(null)
  const deleted = project.name.startsWith('[已删除] ')
  const copy = t('library')
  // 摘要要扫完整张画布，几百个 130 万格工程不能每次渲染都算
  const summary = useMemo(() => projectSummary(project), [project])

  useEffect(() => {
    // 缩略图也是整幅扫描：先让卡片画出来，空闲时再逐张补图
    return onIdle(() => setThumb(renderThumbnailDataUrl(project.grid, getPalette(project.paletteId))))
  }, [project])

  return (
    <div
      className={`flex flex-col gap-2 rounded border p-3 ${
        deleted ? 'border-dashed border-neutral-300 bg-neutral-50' : 'border-neutral-200 bg-white'
      }`}
    >
      <button type="button" onClick={onOpen} className="flex items-center gap-3 text-left">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-neutral-50">
          {thumb ? (
            <img src={thumb} alt="" className="max-h-full max-w-full" />
          ) : (
            <span className="text-[10px] text-neutral-400">…</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          {project.customer && (
            <p className="truncate text-[11px] text-neutral-500">
              {copy.customerLabel}：{project.customer}
            </p>
          )}
          {entry.hasNewerDraft && (
            <p className="text-[11px] text-amber-600">{copy.hasDraft}</p>
          )}
          <p className="text-xs text-neutral-500">
            {summary.cells.toLocaleString()} 格 · {summary.beads.toLocaleString()} 颗 ·{' '}
            {summary.colorCount} 色
          </p>
          <p className="text-xs text-neutral-500">
            {summary.boardCount} 块板 · {summary.sizeMm.w.toFixed(0)}×{summary.sizeMm.h.toFixed(0)}mm
          </p>
          <p className="text-[11px] text-neutral-400">
            {copy.updatedAt} {formatStamp(project.updatedAt)}
          </p>
        </div>
      </button>
      <div className="flex flex-wrap gap-1">
        <Btn onClick={onOpen}>{copy.open}</Btn>
        <Btn onClick={onDuplicate}>{copy.duplicate}</Btn>
        <Btn onClick={onRename}>{copy.rename}</Btn>
        <Btn onClick={onExport}>{copy.exportProject}</Btn>
        {deleted ? (
          <>
            <Btn onClick={onRestore}>{copy.restore}</Btn>
            <Btn onClick={onPurge}>{copy.purge}</Btn>
          </>
        ) : (
          <Btn onClick={onDelete}>{copy.delete}</Btn>
        )}
      </div>
    </div>
  )
}

/** 异常 → 一句话（非 Error 也别说成 undefined） */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** requestIdleCallback 不一定有（老 Safari、测试环境），没有就同步跑 */
function onIdle(run: () => void): (() => void) | undefined {
  const scope = globalThis as {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (typeof scope.requestIdleCallback !== 'function') {
    run()
    return undefined
  }
  const handle = scope.requestIdleCallback(run, { timeout: 500 })
  return () => scope.cancelIdleCallback?.(handle)
}

const STAMP = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** ISO 时间 → 本地时区的「2025/09/14 00:12」。坏时间原样显示，不显示成 Invalid Date */
function formatStamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : STAMP.format(date)
}
