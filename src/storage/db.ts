import { ensureLayout, type Project } from '../domain/project'

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
      request.onerror = () => reject(request.error ?? new Error('打不开本地数据库'))
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

export async function clearAll(): Promise<void> {
  for (const store of ['projects', 'drafts', 'images'] as StoreName[]) {
    await withStore(store, 'readwrite', (s) => s.clear())
  }
}

// --- 工程 ---

export async function listProjects(): Promise<Project[]> {
  const all = await getAll<Project>('projects')
  return all.map(ensureLayout).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getProject(id: string): Promise<Project | undefined> {
  const project = await get<Project>('projects', id)
  return project && ensureLayout(project)
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
}

// --- 草稿 ---

export async function saveDraft(project: Project): Promise<void> {
  await put<Draft>('drafts', {
    id: project.id,
    updatedAt: new Date().toISOString(),
    project,
  })
}

export async function getDraft(id: string): Promise<Project | undefined> {
  const project = (await get<Draft>('drafts', id))?.project
  return project && ensureLayout(project)
}

export async function listDrafts(): Promise<Project[]> {
  const all = await getAll<Draft>('drafts')
  return all.map((d) => d.project)
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

/** 刷新后自动恢复：优先草稿，其次正式保存的工程 */
export async function restoreLastProject(): Promise<Project | undefined> {
  const id = lastProjectId()
  if (!id) return undefined
  return (await getDraft(id)) ?? (await getProject(id))
}
