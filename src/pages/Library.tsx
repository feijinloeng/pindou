import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DotsThreeVertical, MagnifyingGlass, Plus, X } from '@phosphor-icons/react'

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
import { gsap, MOTION, reducedMotion } from '../motion'
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
import NewProjectDialog from '../components/NewProjectDialog'
import { Btn, Menu, MenuItem, Modal } from '../components/ui'

type Tab = 'projects' | 'trash'
const TRASH_PREFIX = '[已删除] '

export default function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('projects')
  const [newOpen, setNewOpen] = useState(false)
  const [details, setDetails] = useState<Project | null>(null)
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

  const openProject = async (id: string) => {
    try {
      // 优先打开草稿（可能比正式保存的更新）
      const entry = entries.find((e) => e.project.id === id)
      const draft = await getDraft(id)
      const target = draft ?? entry?.project
      if (!target) return
      // 草稿比正式工程新 = 这份内容还没经过一次正式保存，导出前要先保存
      useEditor.getState().loadProject(target, !entry?.hasNewerDraft)
      setError(null)
      navigate('editor')
    } catch (cause) {
      setError(`打开失败：${message(cause)}`)
    }
  }

  const duplicate = (project: Project) =>
    runWrite(async () => {
      const clone = createProject({
        name: `${cleanName(project.name)} 副本`,
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
      })
      await refresh()
    })

  const rename = (project: Project) =>
    runWrite(async () => {
      const next = window.prompt(copy.renamePrompt, cleanName(project.name))
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
      `${safeName(cleanName(project.name))}.pindou.json`,
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

  // 本地搜索 + 按更新时间排序 + 作品/回收站分栏。都不改写盘数据。
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries
      .filter((entry) => {
        const deleted = entry.project.name.startsWith(TRASH_PREFIX)
        if (tab === 'trash' ? !deleted : deleted) return false
        if (!needle) return true
        return (
          cleanName(entry.project.name).toLowerCase().includes(needle) ||
          (entry.project.customer ?? '').toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
  }, [entries, query, tab])

  // 只给前 8 张卡片播入场（spec 12.2：不为一屏之外的卡片付动画钱）。
  // 依赖长度而不是数组本身：重命名也会 refresh，不该因此重播一次入场。
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = gridRef.current
    if (!el || reducedMotion()) return
    gsap.fromTo(
      Array.from(el.children).slice(0, 8),
      { opacity: 0, y: 8 },
      {
        opacity: 1,
        y: 0,
        duration: 0.22,
        ease: MOTION.easeOut,
        stagger: 0.025,
        clearProps: 'transform',
      },
    )
  }, [shown.length])

  return (
    <div className="mx-auto flex h-full w-full max-w-[1088px] flex-col gap-4 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <h2 className="text-[23.8px] leading-tight font-semibold">{copy.title}</h2>
          <p className="text-sm text-ink-2">{copy.subtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Btn variant="primary" onClick={() => setNewOpen(true)} disabled={busy}>
            <Plus size={14} aria-hidden />
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

      {/* 工具条：搜索 / 作品·回收站 / 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <MagnifyingGlass
            size={12}
            aria-hidden
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-2"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
            className="w-56 rounded-lg border border-line bg-surface py-1.5 pr-7 pl-8 text-sm text-ink placeholder:text-ink-2/60"
          />
          {query && (
            <button
              type="button"
              aria-label={copy.clearSearch}
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-2 hover:bg-hover"
            >
              <X size={10} aria-hidden />
            </button>
          )}
        </div>
        <div role="tablist" aria-label={copy.title} className="flex gap-1">
          {(
            [
              ['projects', copy.tabProjects],
              ['trash', copy.tabTrash],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === id ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-2">{copy.sortUpdated} ↓</span>
      </div>

      {error && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-surface p-3 text-sm text-danger"
        >
          {error}
          <Btn onClick={() => void refresh()}>{copy.retry}</Btn>
        </p>
      )}

      {issues.length > 0 && (
        <ul role="status" className="rounded-xl border border-warn-ink/30 bg-warn-bg p-3 text-sm text-warn-ink">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {loading && <p className="text-sm text-ink-2">{copy.loading}</p>}

      {!loading && !error && shown.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          {query ? (
            <>
              <p className="text-sm text-ink-2">{copy.emptySearch.replace('{q}', query)}</p>
              <Btn onClick={() => setQuery('')}>{copy.clearSearch}</Btn>
            </>
          ) : tab === 'trash' ? (
            <p className="text-sm text-ink-2">{copy.emptyTrash}</p>
          ) : (
            <>
              <p className="text-sm text-ink-2">{copy.empty}</p>
              <div className="flex gap-2">
                <Btn variant="primary" onClick={() => setNewOpen(true)}>
                  <Plus size={14} aria-hidden />
                  {copy.new}
                </Btn>
                <Btn onClick={() => fileRef.current?.click()}>{copy.import}</Btn>
              </div>
            </>
          )}
        </div>
      )}

      <div ref={gridRef} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((entry) => (
          <ProjectCard
            key={entry.project.id}
            entry={entry}
            busy={busy}
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
            onDetails={() => setDetails(entry.project)}
          />
        ))}
      </div>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} />
      <ProjectDetails project={details} onClose={() => setDetails(null)} />
    </div>
  )
}

function ProjectCard({
  entry,
  busy,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onRestore,
  onPurge,
  onExport,
  onDetails,
}: {
  entry: LibraryEntry
  busy: boolean
  onOpen: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
  onExport: () => void
  onDetails: () => void
}) {
  const project = entry.project
  const [thumb, setThumb] = useState<string | null>(null)
  const deleted = project.name.startsWith(TRASH_PREFIX)
  const copy = t('library')
  // 摘要要扫完整张画布，几百个 130 万格工程不能每次渲染都算
  const summary = useMemo(() => projectSummary(project), [project])

  useEffect(() => {
    // 缩略图也是整幅扫描：先让卡片画出来，空闲时再逐张补图
    return onIdle(() => setThumb(renderThumbnailDataUrl(project.grid, getPalette(project.paletteId))))
  }, [project])

  return (
    <article
      className={`flex flex-col rounded-xl border bg-surface ${
        deleted ? 'border-dashed border-line' : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        aria-label={`${copy.open}《${cleanName(project.name)}》`}
        className="group block overflow-hidden rounded-t-xl text-left"
      >
        {/* 4:3 预览区：图案本身是最大的视觉，操作都让开 */}
        <div className="flex aspect-[4/3] items-center justify-center border-b border-line bg-hover">
          {thumb ? (
            <img src={thumb} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-ink-2">…</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <span className="truncate">{cleanName(project.name)}</span>
            {entry.hasNewerDraft && (
              <span className="shrink-0 rounded bg-warn-bg px-1.5 py-0.5 text-[8.5px] text-warn-ink">
                {copy.hasDraft}
              </span>
            )}
          </p>
          <p className="text-xs text-ink-2 tabular">
            {summary.beads.toLocaleString()} 颗 · {summary.colorCount} 色
          </p>
          <p className="text-xs text-ink-2 tabular">
            {summary.boardCount} 块板 · {summary.sizeMm.w.toFixed(0)}×{summary.sizeMm.h.toFixed(0)}mm
          </p>
          <p className="text-[9.35px] text-ink-2/70">
            {copy.updatedAt} {formatStamp(project.updatedAt)}
          </p>
        </div>
      </button>
      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <span className="ml-auto" />
        <Menu label={<DotsThreeVertical size={15} aria-hidden />} title={copy.more} align="right" width="w-48" triggerVariant="ghost">
          {(close) => (
            <>
              {deleted ? (
                <>
                  <MenuItem
                    onClick={() => {
                      onRestore()
                      close()
                    }}
                  >
                    {copy.restore}
                  </MenuItem>
                  <div className="my-1 h-px bg-line" />
                  <MenuItem
                    onClick={() => {
                      onPurge()
                      close()
                    }}
                  >
                    <span className="text-danger">{copy.purge}</span>
                  </MenuItem>
                </>
              ) : (
                <>
                  <MenuItem
                    onClick={() => {
                      onDuplicate()
                      close()
                    }}
                  >
                    {copy.duplicate}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      onRename()
                      close()
                    }}
                  >
                    {copy.rename}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      onExport()
                      close()
                    }}
                  >
                    {copy.exportProject}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      onDetails()
                      close()
                    }}
                  >
                    {copy.details}
                  </MenuItem>
                  <div className="my-1 h-px bg-line" />
                  <MenuItem
                    onClick={() => {
                      onDelete()
                      close()
                    }}
                  >
                    <span className="text-danger">{copy.delete}</span>
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>
      </div>
    </article>
  )
}

/** 项目详情：所有摘要值都在这，卡片上不用堆数字 */
function ProjectDetails({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const copy = t('library')
  const summary = useMemo(() => (project ? projectSummary(project) : null), [project])
  if (!project || !summary) return null
  const rows: Array<[string, string]> = [
    [copy.namePlaceholder, cleanName(project.name)],
    [copy.customerLabel, project.customer ?? '—'],
    [copy.cells, summary.cells.toLocaleString()],
    [copy.beads, summary.beads.toLocaleString()],
    [copy.colorsUsed, `${summary.colorCount}`],
    [copy.boards, `${summary.boardCount}`],
    [copy.physicalSize, `${summary.sizeMm.w.toFixed(1)}×${summary.sizeMm.h.toFixed(1)} mm`],
    [copy.updatedAt, formatStamp(project.updatedAt)],
  ]
  return (
    <Modal open onClose={onClose} title={copy.details}>
      <dl className="flex flex-col gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-sm">
            <dt className="text-ink-2">{k}</dt>
            <dd className="text-right text-ink tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end">
        <Btn onClick={onClose}>{copy.cancel}</Btn>
      </div>
    </Modal>
  )
}

/** 回收站显示干净名字：前缀是存储格式，不是给人看的 */
function cleanName(name: string): string {
  return name.startsWith(TRASH_PREFIX) ? name.slice(TRASH_PREFIX.length) : name
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
