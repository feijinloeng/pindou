import { decodeStoredProject, type Project } from '../domain/project'

/**
 * 作品库的持久化。三个 store（第 14.1 节）：
 *   projects  工程对象（不含源图）
 *   drafts    当前编辑中的草稿（写得更频繁）
 *   images    源图缓存（压缩后）
 *
 * 直接用原生 IndexedDB + 20 行 Promise 包装：这里只用到 put / get / getAll / delete / clear，
 * 为这点操作引一个库不值得。
 */
export const DB_NAME = 'pindou'
export const DB_VERSION = 1
export type StoreName = 'projects' | 'drafts' | 'images'

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

let openPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (!openPromise) {
    openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        for (const store of ['projects', 'drafts', 'images'] as StoreName[]) {
          if (!database.objectStoreNames.contains(store)) {
            database.createObjectStore(store, { keyPath: 'id' })
          }
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        openPromise = null
        reject(request.error ?? new Error('打不开本地数据库'))
      }
    })
  }
  return openPromise
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('本地数据库操作失败'))
  })
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDb()
  const transaction = database.transaction(store, mode)
  return requestAsPromise(run(transaction.objectStore(store)))
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

export function remove(store: StoreName, id: string): Promise<undefined> {
  return withStore(store, 'readwrite', (s) => s.delete(id))
}

// --- 工程 ---

/**
 * 作品库列表用的条目。
 * 草稿可能比正式工程新（自动保存先写正式再写草稿，中间断了就不同步），
 * 所以列表要合并两份，卡片上所有动作都基于这份最新快照。
 */
export interface LibraryEntry {
  project: Project
  /** 磁盘上还存着一份更新的草稿，卡片摘要随时会变 */
  hasNewerDraft: boolean
}

export interface LibraryListing {
  entries: LibraryEntry[]
  /** 读不出来的条目（坏数据、旧版本…）。不能默默丢掉，得让用户知道 */
  issues: string[]
}

/**
 * 作品库读盘。IndexedDB 里的对象和工程文件走同一套校验（validateProject），
 * 坏数据在这里就被挡住，不会绕过导入路径直接进渲染层。
 */
export async function listProjectEntries(): Promise<LibraryListing> {
  const [stored, drafts] = await Promise.all([getAll<unknown>('projects'), getAll<unknown>('drafts')])
  const issues: string[] = []

  const draftsById = new Map<string, Draft>()
  for (const raw of drafts) {
    const record = raw as Partial<Draft> | undefined
    const project = decodeStoredProject(record?.project)
    if (project) {
      draftsById.set(project.id, {
        id: project.id,
        updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : project.updatedAt,
        project,
      })
    }
  }

  const entries: LibraryEntry[] = []
  for (const raw of stored) {
    const project = decodeStoredProject(raw)
    if (!project) {
      const name = (raw as { name?: string } | undefined)?.name
      issues.push(`${name ?? '（没名字的条目）'}：数据损坏，读不出来`)
      continue
    }
    const draft = draftsById.get(project.id)
    draftsById.delete(project.id)
    const useDraft = !!draft && draft.project.updatedAt > project.updatedAt
    entries.push({ project: useDraft ? draft.project : project, hasNewerDraft: useDraft })
  }
  // 只有草稿、没有正式工程的条目（新建后写盘失败过）也别漏
  for (const draft of draftsById.values()) {
    entries.push({ project: draft.project, hasNewerDraft: true })
    issues.push(`${draft.project.name}：只有草稿，没有正式工程`)
  }

  entries.sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
  return { entries, issues }
}

export async function getProject(id: string): Promise<Project | undefined> {
  return decodeStoredProject(await get<unknown>('projects', id)) ?? undefined
}

export function putProject(project: Project): Promise<IDBValidKey> {
  return put('projects', project)
}

/** 删除走回收站语义：不物理删，只把名字改掉（第 14.2 节） */
export async function trashProject(id: string): Promise<void> {
  const project = await getProject(id)
  if (!project) return
  await putProject({
    ...project,
    name: `[已删除] ${project.name.replace(/^\[已删除\] /, '')}`,
    updatedAt: new Date().toISOString(),
  })
  // 已删掉的工程不能被“上次打开的工程”自动恢复回来
  if (lastProjectId() === id) forgetLastProject()
}

/** 从回收站恢复：把前缀去掉 */
export async function restoreProject(id: string): Promise<void> {
  const project = await getProject(id)
  if (!project) return
  await putProject({
    ...project,
    name: project.name.replace(/^\[已删除\] /, ''),
    updatedAt: new Date().toISOString(),
  })
}

/** 真的抹掉（清空回收站时才用） */
export async function purgeProject(id: string): Promise<void> {
  await remove('projects', id)
  await remove('drafts', id)
  await remove('images', id)
  if (lastProjectId() === id) forgetLastProject()
}

// --- 草稿 ---

export async function saveDraft(project: Project): Promise<void> {
  await put<Draft>('drafts', {
    id: project.id,
    updatedAt: new Date().toISOString(),
    project,
  })
}

async function readDraft(id: string): Promise<Draft | undefined> {
  const record = await get<Draft>('drafts', id)
  const project = decodeStoredProject(record?.project)
  if (!project) return undefined
  return {
    id: project.id,
    updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : project.updatedAt,
    project,
  }
}

export async function getDraft(id: string): Promise<Project | undefined> {
  return (await readDraft(id))?.project
}

export function clearDraft(id: string): Promise<undefined> {
  return remove('drafts', id)
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
export async function restoreLastProject(): Promise<Project | undefined> {
  const id = lastProjectId()
  if (!id) return undefined
  const [project, draft] = await Promise.all([getProject(id), readDraft(id)])
  const latest =
    draft && (!project || draft.project.updatedAt > project.updatedAt) ? draft.project : project
  if (!latest) return undefined
  if (latest.name.startsWith('[已删除] ')) {
    forgetLastProject()
    return undefined
  }
  return latest
}
