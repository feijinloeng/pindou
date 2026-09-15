/** Browser-only checks; launched in an isolated Chrome profile by browser.ts. */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createProject, serializeProject, type Project } from '../../src/domain/project'
import { createGrid, EMPTY } from '../../src/domain/grid'
import { deriveLayoutGeometry } from '../../src/domain/board'
import { useEditor } from '../../src/editor/store'
import { startAutosave } from '../../src/storage/autosave'
import * as db from '../../src/storage/db'
import NewProjectDialog from '../../src/components/NewProjectDialog'
import Library from '../../src/pages/Library'
import CanvasStage from '../../src/components/CanvasStage'
import { useUi } from '../../src/editor/uiState'
import { t } from '../../src/i18n/zh'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
async function rejects(action: () => Promise<unknown>, message: string) {
  let rejected = false
  try { await action() } catch { rejected = true }
  assert(rejected, message)
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until<T>(read: () => T | Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 200; i++) {
    const value = await read()
    if (value) return value
    await sleep(10)
  }
  throw new Error('Timed out waiting for browser UI.')
}
function project(name: string): Project {
  const layout = { placements: [{ board: 'mini26' as const, col: 0, row: 0 }], gapMm: 0 }
  const geom = deriveLayoutGeometry(layout)
  return createProject({ name, layout, paletteId: 'mard-221', grid: createGrid(geom.cols, geom.rows, EMPTY, geom.placeable) })
}
function paint(value: number, col = 0) {
  const editor = useEditor.getState()
  editor.setTool('pencil')
  editor.setColor(value)
  editor.pointerDown(col, 0, 0, false)
  editor.pointerUp()
}

export async function run(): Promise<string> {
  assert(location.pathname === '/__check', 'Run only through npm run check:browser.')
  const results: string[] = []
  const legacy = project('Legacy project')
  legacy.updatedAt = '2026-01-01T00:00:00.000Z'
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(db.DB_NAME, 1)
    request.onupgradeneeded = () => {
      for (const store of ['projects', 'drafts', 'images']) request.result.createObjectStore(store, { keyPath: 'id' })
      request.transaction!.objectStore('projects').put(legacy)
      request.transaction!.objectStore('projects').put({ id: 'broken', schemaVersion: 999 })
      request.transaction!.objectStore('drafts').put({ id: legacy.id, project: legacy, updatedAt: '2026-01-01T00:00:00.050Z' })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
  const listing = await db.listProjectEntries()
  assert(listing.issues.some((issue) => issue.includes('broken')), 'Migration must report corrupt records.')
  const entry = listing.entries.find((item) => item.project.id === legacy.id)
  assert(entry && !entry.hasNewerDraft && !('grid' in entry.project), 'Legacy duplicate drafts must not replace formal saves; indexes must stay lightweight.')
  assert((await db.getProject(legacy.id))?.grid.cells.length === legacy.grid.cells.length, 'Migration must preserve grids.')
  results.push('PASS: v1 migration, corrupt records, lightweight indexes')

  useEditor.getState().loadProject(project('Draft'), false)
  paint(1)
  const id = useEditor.getState().projectId
  await useEditor.getState().saveNow()
  assert(!(await db.getProject(id)), 'Autosave must not write a formal project.')
  assert((await db.getLatestProject(id))?.hasNewerDraft, 'Autosave must be recoverable as a draft.')
  assert(await useEditor.getState().restoreLast(), 'Draft must restore after reopening.')
  assert(useEditor.getState().savedCommitVersion === null, 'Restoring a draft must not unlock export.')
  await Promise.all([useEditor.getState().saveNow(true), useEditor.getState().saveNow()])
  assert(useEditor.getState().savedCommitVersion === useEditor.getState().commitVersion, 'An explicit save must unlock export even with a queued autosave.')
  assert(!(await db.getLatestProject(id))?.hasNewerDraft, 'Queued unchanged autosave must not recreate a draft.')
  const snapshot = useEditor.getState().toProject()
  paint(2)
  assert(snapshot.grid.cells[0] === 1, 'Save snapshots must not mutate during later edits.')
  await useEditor.getState().saveNow()
  assert((await db.getProject(id))?.grid.cells[0] === 1, 'Draft edits must leave formal content untouched.')
  assert((await db.getLatestProject(id))?.project.grid.cells[0] === 2, 'Newest draft must win.')
  results.push('PASS: draft/formal separation, restore gate, save queue, immutable snapshots')

  const originalPut = IDBObjectStore.prototype.put
  try {
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args)
      if (this.name === 'projects' || this.name === 'drafts') request.addEventListener('success', () => this.transaction.abort())
      return request
    }
    await rejects(() => useEditor.getState().saveNow(true), 'A request success followed by transaction abort must reject.')
    assert(useEditor.getState().savedCommitVersion !== useEditor.getState().commitVersion, 'Failed saves must not unlock export.')
    assert((await db.getProject(id))?.grid.cells[0] === 1, 'Aborted transaction must keep the original formal version.')
    assert((await db.getLatestProject(id))?.hasNewerDraft, 'Aborted transaction must preserve the newer draft.')

    let alert = ''
    let closed = false
    const originalAlert = window.alert
    const root = createRoot(document.getElementById('root')!)
    try {
      window.alert = (message) => { alert = String(message) }
      flushSync(() => root.render(createElement(NewProjectDialog, { open: true, onClose: () => { closed = true } })))
      document.querySelector<HTMLFormElement>('form')!.requestSubmit()
      for (let i = 0; i < 100 && !alert; i++) await sleep(10)
      assert(alert && !closed && useEditor.getState().projectId === id, 'Save failure must prevent NewProjectDialog from switching projects.')
    } finally {
      root.unmount()
      window.alert = originalAlert
    }
  } finally {
    IDBObjectStore.prototype.put = originalPut
  }
  await useEditor.getState().saveNow(true)
  assert(!useEditor.getState().saving, 'Save queue must recover after errors.')
  results.push('PASS: transaction rollback, save failure blocks new project, retry succeeds')

  paint(3)
  await useEditor.getState().saveNow()
  await db.trashProject(id)
  await db.restoreProject(id)
  assert((await db.getLatestProject(id))?.project.grid.cells[0] === 3, 'Trash/restore must preserve the newest draft, not the old formal grid.')
  useEditor.getState().loadProject((await db.getLatestProject(id))!.project)
  const stop = startAutosave(10)
  try {
    paint(4)
    await useEditor.getState().deleteProject(id)
    await sleep(40)
    await useEditor.getState().saveNow()
    assert(useEditor.getState().projectId !== id, 'Deleting the current project must switch the editor.')
    assert((await db.getProject(id))?.name.startsWith('[已删除] '), 'Queued autosave must not resurrect a deleted project.')
    await db.restoreProject(id)
    assert((await db.getProject(id))?.grid.cells[0] === 4, 'Current-project deletion must preserve unsaved cells.')
  } finally { stop() }
  results.push('PASS: trash/restore and current-project deletion cannot lose or resurrect content')

  useEditor.getState().newProject()
  await useEditor.getState().importImage(new File(['invalid'], 'test.png', { type: 'image/png' }))
  assert(useEditor.getState().sourceImage === null && !useEditor.getState().converting, 'An empty layout must reject image import before decoding.')
  results.push('PASS: empty-layout image guard')

  useEditor.getState().loadProject((await db.getProject(id))!)
  paint(5)
  useUi.getState().setMotion('reduced')
  const root = createRoot(document.getElementById('root')!)
  const originalPrompt = window.prompt
  try {
    flushSync(() => root.render(createElement(Library, { embedded: true })))
    const card = await until(() => [...document.querySelectorAll('article')].find((item) => item.textContent?.includes('Draft')))
    const menuAction = async (label: string) => {
      card.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click()
      const button = await until(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === label))
      button.click()
    }
    await menuAction(t('library').duplicate)
    const clone = await until(async () => (await db.getAll<Project>('projects')).find((item) => item.id !== id && typeof item.name === 'string' && item.name.startsWith('Draft ')))
    assert(clone.grid.cells[0] === 5, 'Library duplication must include edits still inside the autosave delay.')
    await until(() => !card.inert)
    window.prompt = () => 'Renamed project'
    await menuAction(t('library').rename)
    await until(async () => (await db.getProject(id))?.name === 'Renamed project')
    assert(useEditor.getState().name === 'Renamed project', 'Library rename must update the live editor.')
    paint(6)
    await useEditor.getState().saveNow()
    assert((await db.getLatestProject(id))?.project.name === 'Renamed project', 'Autosave must not restore the previous name.')

    const imported = { ...useEditor.getState().toProject(), name: 'Imported collision' }
    imported.grid.cells[0] = 7
    const transfer = new DataTransfer()
    transfer.items.add(new File([serializeProject(imported)], 'collision.pindou.json', { type: 'application/json' }))
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    fileInput.files = transfer.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    const importedCopy = await until(async () => (await db.getAll<Project>('projects')).find((item) => typeof item.name === 'string' && item.name.startsWith('Imported collision')))
    assert(importedCopy.id !== id && useEditor.getState().grid.cells[0] === 6, 'An import collision must never overwrite the current editor.')
    assert((await db.getLatestProject(id))?.project.grid.cells[0] === 6, 'An import collision must preserve the existing draft.')
    assert([...document.querySelectorAll('button')].some((item) => item.textContent === t('library').tabTrash), 'Embedded library must expose the recycle bin.')

    const originalGetAll = IDBObjectStore.prototype.getAll
    try {
      IDBObjectStore.prototype.getAll = function () { throw new Error('Injected read failure') }
      useEditor.setState({ savedAt: new Date().toISOString() })
      await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('Injected read failure'))
    } finally { IDBObjectStore.prototype.getAll = originalGetAll }
    results.push('PASS: library duplicate, rename, import collision, recycle-bin access and visible read errors')

    flushSync(() => root.render(createElement('div', { style: { width: 900, height: 700 } }, createElement(CanvasStage))))
    await sleep(50)
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[role="application"]')!
    useEditor.getState().setVp({ ...useEditor.getState().vp, zoom: 10 })
    const outsideWheel = new WheelEvent('wheel', { deltaY: 50, ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(outsideWheel)
    assert(!outsideWheel.defaultPrevented && useEditor.getState().vp.zoom === 10, 'Panel/browser zoom must not be intercepted.')
    const canvasWheel = new WheelEvent('wheel', { deltaY: 50, ctrlKey: true, bubbles: true, cancelable: true })
    canvas.dispatchEvent(canvasWheel)
    assert(canvasWheel.defaultPrevented && useEditor.getState().vp.zoom !== 10, 'Canvas wheel must still zoom the canvas.')
    results.push('PASS: canvas zoom is scoped to the canvas')
  } finally {
    root.unmount()
    window.prompt = originalPrompt
  }

  const { createPdfSink } = await import('../../src/render/pdf')
  const { PINDOU_BOM_CJK_FONT_BASE64 } = await import('../../src/render/fonts/pindouBomCjk')
  const sink = createPdfSink({ widthPt: 300, heightPt: 200, cjkFontBase64: PINDOU_BOM_CJK_FONT_BASE64 })
  sink.setFont('cjk')
  sink.text('春日(测试)\\作品', 10, 100, 12, 'fill')
  assert(new TextDecoder().decode(sink.output()).includes('/Subtype /Image'), 'Chinese glyphs missing from the subset must use browser-font fallback.')

  const { buildScreenPdf, buildPaperPdf, buildPaperZip, buildPreviewPng } = await import('../../src/render/exporters')
  const { getPalette } = await import('../../src/data/palettes')
  const sample = project('春日(测试)\\作品')
  sample.grid.cells.fill(0)
  const context = { ...sample, palette: getPalette(sample.paletteId), geom: deriveLayoutGeometry(sample.layout), pitchMm: 2.6 }
  const paper = await buildPaperPdf(context, { includeBom: true, instructions: true })
  const zip = await buildPaperZip(context)
  assert(new TextDecoder().decode(paper.subarray(0, 4)) === '%PDF', 'Paper export must produce a real PDF.')
  assert(zip[0] === 0x50 && zip[1] === 0x4b, 'Paper ZIP must await the PDF, not serialize a Promise.')
  const offscreen = globalThis.OffscreenCanvas
  try {
    Object.defineProperty(globalThis, 'OffscreenCanvas', { value: undefined, configurable: true })
    const png = await buildPreviewPng(context, { pxPerCell: 4 })
    assert(png[0] === 137 && png[1] === 80, 'PNG fallback must work without OffscreenCanvas.')
  } finally { Object.defineProperty(globalThis, 'OffscreenCanvas', { value: offscreen, configurable: true }) }
  const layout = { placements: Array.from({ length: 100 }, (_, i) => ({ board: 'mini104' as const, col: (i % 10) * 104, row: Math.floor(i / 10) * 104 })), gapMm: 0 }
  const geom = deriveLayoutGeometry(layout)
  const large = createGrid(geom.cols, geom.rows, 0, geom.placeable)
  const largePdf = await buildScreenPdf({ ...context, geom, grid: large }, { showCodes: false, includeBom: true })
  assert(largePdf.length > 100_000, 'Million-cell vector export must produce content.')
  results.push(`PASS: Chinese fallback, async PDF/ZIP, PNG fallback and ${large.cells.length.toLocaleString('en-US')}-cell PDF`)
  return results.join('\n')
}
