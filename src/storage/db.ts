import {
  decodeStoredProject,
  projectSummary,
  type Project,
  type ProjectSummary,
} from '../domain/project'
import { t } from '../i18n/zh'

/**
 * 作品库的持久化。完整工程和草稿分开存，列表只读轻量索引，点击卡片时才读完整网格。
 * 三个旧 store 继续保留；indexes / draft-indexes 是 v2 新增的列表索引。
 */
export const DB_NAME = 'pindou'
export const DB_VERSION = 2
export type StoreName = 'projects' | 'drafts' | 'images' | 'indexes' | 'draft-indexes'

export interface Draft {
  id: string
  updatedAt: string
  project: Project
}

export interface CachedImage {
  id: string
  name: string
  blob: Blob
  width: number
  height: number
  updatedAt: string
}

export interface ProjectIndex {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  paletteId: string
  summary: ProjectSummary
}

interface InvalidIndex {
  id: string
  invalid: true
  issue: string
}

type IndexRecord = ProjectIndex | InvalidIndex

let openPromise: Promise<IDBDatabase> | null = null

function indexFor(project: Project): ProjectIndex {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    paletteId: project.paletteId,
    summary: projectSummary(project),
  }
}

function isIndex(record: unknown): record is ProjectIndex {
  if (!record || typeof record !== 'object') return false
  const value = record as Partial<ProjectIndex> & { invalid?: unknown }
  const summary = value.summary
  if (!summary || typeof summary !== 'object') return false
  const size = summary.sizeMm
  return (
    !('invalid' in value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.paletteId === 'string' &&
    Number.isInteger(summary.cells) &&
    summary.cells >= 0 &&
    Number.isInteger(summary.beads) &&
    summary.beads >= 0 &&
    Number.isInteger(summary.colorCount) &&
    summary.colorCount >= 0 &&
    Number.isInteger(summary.boardCount) &&
    summary.boardCount >= 0 &&
    !!size &&
    Number.isFinite(size.w) &&
    size.w >= 0 &&
    Number.isFinite(size.h) &&
    size.h >= 0
  )
}

function recordId(record: unknown, fallback: string): string {
  const id = (record as { id?: unknown } | null)?.id
  return typeof id === 'string' && id ? id : fallback
}

function recordIssue(record: unknown): string {
  const issue = (record as { issue?: unknown } | null)?.issue
  return typeof issue === 'string' && issue ? issue : '数据损坏，读不出来'
}

function issueIndex(value: unknown, fallback: string, issue: string): InvalidIndex {
  return { id: recordId(value, fallback), invalid: true, issue }
}

/** v1 升级时建立轻量索引；坏记录也留一个索引，作品库不会把它静默吞掉。 */
function migrateIndex(
  transaction: IDBTransaction,
  sourceName: 'projects' | 'drafts',
  targetName: 'indexes' | 'draft-indexes',
): void {
  const source = transaction.objectStore(sourceName)
  const target = transaction.objectStore(targetName)
  const cursorRequest = source.openCursor()
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result
    if (!cursor) return
    const fallback = `${sourceName}-${String(cursor.key)}`
    const raw = cursor.value
    const candidate = sourceName === 'drafts' ? (raw as Partial<Draft>)?.project : raw
    try {
      const project = decodeStoredProject(candidate)
      target.put(project ? indexFor(project) : issueIndex(raw, fallback, '数据损坏，读不出来'))
    } catch {
      target.put(issueIndex(raw, fallback, '数据损坏，读不出来'))
    }
    cursor.continue()
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        openPromise = null
        reject(error)
      }
      request.onupgradeneeded = (event) => {
        const database = request.result
        const transaction = request.transaction
        for (const store of ['projects', 'drafts', 'images', 'indexes', 'draft-indexes'] as StoreName[]) {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store, { keyPath: 'id' })
          }
        }
        if (transaction && event.oldVersion < 2) {
          migrateIndex(transaction, 'projects', 'indexes')
          migrateIndex(transaction, 'drafts', 'draft-indexes')
        }
      }
      request.onsuccess = () => {
        const database = request.result
        if (settled) {
          // A blocked request may eventually open after its promise has already failed.
          database.close()
          return
        }
        settled = true
        database.onversionchange = () => {
          database.close()
          openPromise = null
        }
        resolve(database)
      }
      request.onblocked = () => fail(new Error(t('storage').blocked))
      request.onerror = () => {
        fail(request.error ?? new Error('打不开本地数据库'))
      }
    })
  }
  return openPromise
}

type StoreMap = Map<StoreName, IDBObjectStore>

/** 等待整个事务完成，而不是只等单个 request 的 success。 */
async function withStores<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  run: (stores: StoreMap) => IDBRequest<T>,
): Promise<T> {
  const database = await openDb()
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(names, mode)
    } catch (error) {
      reject(error)
      return
    }

    let result!: T
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const fail = (error: unknown) =>
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))

    transaction.oncomplete = () => finish(() => resolve(result))
    transaction.onerror = () => fail(transaction.error ?? new Error('本地数据库事务失败'))
    transaction.onabort = () => fail(transaction.error ?? new Error('本地数据库事务已中止'))

    try {
      const stores = new Map(names.map((name) => [name, transaction.objectStore(name)] as const))
      const request = run(stores)
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => fail(request.error ?? new Error('本地数据库操作失败'))
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // 事务已经结束时无需再处理。
      }
      fail(error)
    }
  })
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return withStores([store], mode, (stores) => run(stores.get(store)!))
}

export function put<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return withStore(store, 'readwrite', (s) => s.put(value))
}

export function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  return withStore(store, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>)
}

export function getAll<T>(store: StoreName): Promise<T[]> {
  return withStore(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

/** Indexes are created during migration and updated atomically with every write. */
export async function listProjectEntries(): Promise<LibraryListing> {
  const [stored, drafts] = await Promise.all([
    getAll<IndexRecord>('indexes'),
    getAll<IndexRecord>('draft-indexes'),
  ])

  const issues: string[] = []
  const draftsById = new Map<string, ProjectIndex>()
  for (const record of drafts) {
    if (isIndex(record)) draftsById.set(record.id, record)
    else issues.push(`${recordId(record, '草稿')}：${recordIssue(record)}`)
  }

  const entries: LibraryEntry[] = []
  for (const record of stored) {
    if (!isIndex(record)) {
      issues.push(`${recordId(record, '工程')}：${recordIssue(record)}`)
      continue
    }
    const draft = draftsById.get(record.id)
    draftsById.delete(record.id)
    const useDraft = !!draft && !record.name.startsWith('[已删除] ') && draft.updatedAt > record.updatedAt
    entries.push({ project: useDraft ? draft : record, hasNewerDraft: useDraft })
  }
  // 只有草稿、没有正式工程的条目（新建后写盘失败过）也别漏
  for (const draft of draftsById.values()) {
    entries.push({ project: draft, hasNewerDraft: true })
    issues.push(`${draft.name}：只有草稿，没有正式工程`)
  }

  entries.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
  return { entries, issues }
}

export interface LibraryEntry {
  project: ProjectIndex
  /** 磁盘上还存着一份更新的草稿，卡片摘要随时会变 */
  hasNewerDraft: boolean
}

export interface LibraryListing {
  entries: LibraryEntry[]
  /** 读不出来的条目（坏数据、旧版本…）。不能默默丢掉，得让用户知道 */
  issues: string[]
}

// --- 工程 ---

/** 把完整工程和列表索引放进同一个事务。 */
async function putProjectRecord(project: Project): Promise<IDBValidKey> {
  return withStores(['projects', 'indexes', 'drafts', 'draft-indexes'], 'readwrite', (all) => {
    const projectRequest = all.get('projects')!.put(project)
    all.get('indexes')!.put(indexFor(project))
    all.get('drafts')!.delete(project.id)
    all.get('draft-indexes')!.delete(project.id)
    return projectRequest
  })
}

export async function getProject(id: string): Promise<Project | undefined> {
  return decodeStoredProject(await get<unknown>('projects', id)) ?? undefined
}

export function putProject(project: Project): Promise<IDBValidKey> {
  // 写正式工程后，旧草稿已经被纳入正式版本，不应继续遮住它。
  return putProjectRecord(project)
}

/** 正式工程和草稿同时存在时，始终以写入时间更新的那份为准。 */
export interface LatestProject {
  project: Project
  hasNewerDraft: boolean
}

export async function getLatestProject(id: string): Promise<LatestProject | null> {
  const [project, draft] = await Promise.all([getProject(id), readDraft(id)])
  if (!project && !draft) return null
  const hasNewerDraft = !!draft && !project?.name.startsWith('[已删除] ') &&
    (!project || draft.project.updatedAt > project.updatedAt)
  return { project: hasNewerDraft ? draft!.project : project!, hasNewerDraft }
}

/** 删除走回收站语义：不物理删，只把名字改掉（第 14.2 节） */
export async function trashProject(id: string): Promise<void> {
  const latest = await getLatestProject(id)
  if (!latest) throw new Error(t('storage').missingProject)
  const project = latest.project
  await putProjectRecord({
    ...project,
    name: `[已删除] ${project.name.replace(/^\[已删除\] /, '')}`,
    updatedAt: new Date().toISOString(),
  })
  // 已删掉的工程不能被“上次打开的工程”自动恢复回来
  if (lastProjectId() === id) forgetLastProject()
}

/** 从回收站恢复：把前缀去掉 */
export async function restoreProject(id: string): Promise<void> {
  const latest = await getLatestProject(id)
  if (!latest) throw new Error(t('storage').missingProject)
  const project = latest.project
  await putProjectRecord({
    ...project,
    name: project.name.replace(/^\[已删除\] /, ''),
    updatedAt: new Date().toISOString(),
  })
}

/** 真的抹掉（清空回收站时才用） */
export async function purgeProject(id: string): Promise<void> {
  await withStores(['projects', 'drafts', 'images', 'indexes', 'draft-indexes'], 'readwrite', (stores) => {
    stores.get('projects')!.delete(id)
    stores.get('drafts')!.delete(id)
    stores.get('images')!.delete(id)
    stores.get('indexes')!.delete(id)
    return stores.get('draft-indexes')!.delete(id)
  })
  if (lastProjectId() === id) forgetLastProject()
}

// --- 草稿 ---

export async function saveDraft(project: Project): Promise<void> {
  const draft: Draft = {
    id: project.id,
    updatedAt: new Date().toISOString(),
    project,
  }
  await withStores(['drafts', 'draft-indexes'], 'readwrite', (stores) => {
    const request = stores.get('drafts')!.put(draft)
    stores.get('draft-indexes')!.put(indexFor(project))
    return request
  })
}

async function readDraft(id: string): Promise<Draft | undefined> {
  const record = await get<Draft>('drafts', id)
  const project = decodeStoredProject(record?.project)
  return project ? { id: project.id, updatedAt: project.updatedAt, project } : undefined
}

// --- 源图缓存 ---

export function putImage(
  id: string,
  image: Omit<CachedImage, 'id' | 'updatedAt'>,
): Promise<IDBValidKey> {
  return put<CachedImage>('images', { ...image, id, updatedAt: new Date().toISOString() })
}

export function getImage(id: string): Promise<CachedImage | undefined> {
  return get<CachedImage>('images', id)
}

// --- 最后打开的工程（刷新后用来自动恢复草稿） ---

const LAST_PROJECT_KEY = 'pindou:last-project'

export function rememberLastProject(id: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch {
    // 隐私模式下 localStorage 会抛异常，忽略就好
  }
}

export function lastProjectId(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function forgetLastProject(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(LAST_PROJECT_KEY)
  } catch {
    // 隐私模式，忽略
  }
}

/** 刷新后自动恢复：优先草稿，其次正式保存的工程。回收站里的不恢复 */
export async function restoreLastProject(): Promise<LatestProject | undefined> {
  const id = lastProjectId()
  if (!id) return undefined
  const latest = await getLatestProject(id)
  if (!latest) return undefined
  if (latest.project.name.startsWith('[已删除] ')) {
    forgetLastProject()
    return undefined
  }
  return latest
}
