import { useCallback, useEffect, useRef, useState } from 'react'

import { getPalette } from '../data/palettes'


import {
  createProject,
  parseProject,
  projectSummary,
  serializeProject,
  type Project,
} from '../domain/project'
import { useEditor } from '../editor/store'
import { navigate } from '../router'
import { downloadBytes, safeName } from '../render/exporters'
import { renderThumbnailDataUrl } from '../render/thumbnail'
import {
  clearDraft,
  getDraft,
  listProjects,
  purgeProject,
  putProject,
  restoreProject,
  trashProject,
} from '../storage/db'
import { t } from '../i18n/zh'
import { Btn } from '../components/ui'

export default function Library() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const copy = t('library')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await listProjects())
    } catch {
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const newProject = () => {
    const editor = useEditor.getState()
    // 不预设板阵：进编辑器先让人自己拼台面（选板页）
    editor.newProject(name.trim() || copy.untitled)
    const project = editor.toProject()
    void putProject(project)
    navigate('editor')
  }

  const openProject = async (id: string) => {
    // 优先打开草稿（可能比正式保存的更新）
    const draft = await getDraft(id)
    const target = draft ?? projects.find((p) => p.id === id)
    if (!target) return
    useEditor.getState().loadProject(target)
    navigate('editor')
  }

  const duplicate = async (project: Project) => {
    const clone = createProject({
      name: `${project.name} 副本`,
      layout: project.layout,
      paletteId: project.paletteId,
      grid: {
        cols: project.grid.cols,
        rows: project.grid.rows,
        cells: project.grid.cells.slice(),
      },
    })
    await putProject(clone)
    await refresh()
  }

  const rename = async (project: Project) => {
    const next = window.prompt(copy.renamePrompt, project.name)
    if (!next) return
    await putProject({ ...project, name: next, updatedAt: new Date().toISOString() })
    await refresh()
  }

  const remove = async (project: Project) => {
    await trashProject(project.id)
    await clearDraft(project.id)
    await refresh()
  }

  const restore = async (project: Project) => {
    await restoreProject(project.id)
    await refresh()
  }

  const exportProject = (project: Project) => {
    const text = serializeProject(project)
    downloadBytes(
      new TextEncoder().encode(text),
      `${safeName(project.name)}.pindou.json`,
      'application/json',
    )
  }

  const importProject = async (file: File) => {
    const text = await file.text()
    // 先从文件里读出色板 id，这样才能校验格子引用的色号是否存在
    let paletteId = 'mard-291'
    try {
      paletteId = (JSON.parse(text) as { paletteId?: string }).paletteId ?? paletteId
    } catch {
      // JSON 坏了的话下面 parseProject 会给明确错误
    }
    const result = parseProject(text, getPalette(paletteId).colors.length)
    if (!result.project) {
      window.alert(`${copy.importFailed}\n${result.error?.message ?? ''}`)
      return
    }
    await putProject(result.project)
    await refresh()
    if (result.error) window.alert(result.error.message)
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
          <Btn onClick={newProject}>{copy.new}</Btn>
          <Btn onClick={() => fileRef.current?.click()}>{copy.import}</Btn>
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

      {loading && <p className="text-sm text-neutral-500">{copy.loading}</p>}
      {!loading && projects.length === 0 && (
        <p className="text-sm text-neutral-500">{copy.empty}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onOpen={() => void openProject(project.id)}
            onDuplicate={() => void duplicate(project)}
            onRename={() => void rename(project)}
            onDelete={() => void remove(project)}
            onRestore={() => void restore(project)}
            onPurge={() => {
              if (window.confirm(copy.purgeConfirm)) {
                void purgeProject(project.id).then(refresh)
              }
            }}
            onExport={() => exportProject(project)}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onRestore,
  onPurge,
  onExport,
}: {
  project: Project
  onOpen: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
  onRestore: () => void
  onPurge: () => void
  onExport: () => void
}) {
  const [thumb, setThumb] = useState<string | null>(null)
  const deleted = project.name.startsWith('[已删除] ')
  const copy = t('library')
  const summary = projectSummary(project)

  useEffect(() => {
    setThumb(renderThumbnailDataUrl(project.grid, getPalette(project.paletteId)))
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
          <p className="text-xs text-neutral-500">
            {summary.cells.toLocaleString()} 格 · {summary.beads.toLocaleString()} 颗 ·{' '}
            {summary.colorCount} 色
          </p>
          <p className="text-xs text-neutral-500">
            {summary.boardCount} 块板 · {summary.sizeMm.w.toFixed(0)}×{summary.sizeMm.h.toFixed(0)}mm
          </p>
          <p className="text-[11px] text-neutral-400">
            {copy.updatedAt} {project.updatedAt.slice(0, 16).replace('T', ' ')}
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
