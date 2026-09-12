import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from './convert'
import type { Rgb } from './colorDistance'
import type { SourceImage } from './types'
import type { ConvertResponse } from './worker'

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  readonly posted: unknown[] = []
  terminated = false

  constructor() {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(message: ConvertResponse): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }))
  }

  /** Worker 自己崩了（模块加载失败、OOM、被浏览器杀掉） */
  crash(type: 'error' | 'messageerror'): void {
    this.dispatchEvent(new Event(type))
  }
}

const image: SourceImage = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([255, 0, 0, 255]),
}

function makeJob(signal?: AbortSignal) {
  return {
    image,
    paletteColors: [[255, 0, 0] as Rgb],
    cols: 1,
    rows: 1,
    settings: DEFAULT_SETTINGS,
    signal,
  }
}

describe('转换 Worker 客户端', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('Worker', FakeWorker)
    FakeWorker.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('保留底图时把 existing 交给 Worker', async () => {
    const client = await import('./convertClient')
    const existing = new Uint16Array([7])
    const pending = client.runConvert({ ...makeJob(), existing })
    const worker = FakeWorker.instances[0]
    const request = worker.posted[0] as { id: number; existing?: Uint16Array }
    expect(Array.from(request.existing ?? [])).toEqual([7])
    worker.emit({
      id: request.id,
      kind: 'done',
      cells: new Uint16Array([7]),
      usedIndexes: [7],
      droppedIndexes: [],
      kindOfSource: 'photo',
      strategyUsed: 'general',
      ditherUsed: 0.55,
      backgroundConfidence: 1,
      cropSkipped: false,
      quantizedColorCount: 1,
      cropped: false,
      ms: 1,
    })
    await expect(pending).resolves.toMatchObject({ usedIndexes: [7] })
  })

  it('取消时会结束 Promise 并终止旧 Worker', async () => {
    const client = await import('./convertClient')
    const controller = new AbortController()
    const pending = client.runConvert(makeJob(controller.signal))

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })

  it('取消旧任务后，新任务使用新 Worker 并能正常返回', async () => {
    const client = await import('./convertClient')
    const oldController = new AbortController()
    const oldPending = client.runConvert(makeJob(oldController.signal))
    oldController.abort()
    await expect(oldPending).rejects.toMatchObject({ name: 'AbortError' })

    const nextPending = client.runConvert(makeJob())
    const nextWorker = FakeWorker.instances[1]
    const request = nextWorker.posted[0] as { id: number }
    nextWorker.emit({
      id: request.id,
      kind: 'done',
      cells: new Uint16Array([0]),
      usedIndexes: [0],
      droppedIndexes: [],
      kindOfSource: 'photo',
      strategyUsed: 'general',
      ditherUsed: 0.55,
      backgroundConfidence: 1,
      cropSkipped: false,
      quantizedColorCount: 1,
      cropped: false,
      ms: 1,
    })

    await expect(nextPending).resolves.toMatchObject({ usedIndexes: [0], ms: 1 })
    expect(nextWorker.terminated).toBe(false)
  })

  it('Worker 崩了：Promise 一定会结束，不会永远停在“转换中”（P2-11）', async () => {
    const client = await import('./convertClient')
    const pending = client.runConvert(makeJob())
    FakeWorker.instances[0].crash('error')
    await expect(pending).rejects.toThrow(/Worker 出错/)
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })

  it('结果读不出来（messageerror）也会结束 Promise', async () => {
    const client = await import('./convertClient')
    const pending = client.runConvert(makeJob())
    FakeWorker.instances[0].crash('messageerror')
    await expect(pending).rejects.toThrow(/无法读取/)
  })

  it('崩溃后重建：下一次转换用新 Worker 并正常返回', async () => {
    const client = await import('./convertClient')
    const first = client.runConvert(makeJob())
    FakeWorker.instances[0].crash('error')
    await expect(first).rejects.toThrow()

    const second = client.runConvert(makeJob())
    expect(FakeWorker.instances).toHaveLength(2)
    const worker = FakeWorker.instances[1]
    const request = worker.posted[0] as { id: number }
    worker.emit({
      id: request.id,
      kind: 'done',
      cells: new Uint16Array([0]),
      usedIndexes: [0],
      droppedIndexes: [],
      kindOfSource: 'photo',
      strategyUsed: 'general',
      ditherUsed: 0,
      backgroundConfidence: 1,
      cropSkipped: false,
      quantizedColorCount: 1,
      cropped: false,
      ms: 2,
    })
    await expect(second).resolves.toMatchObject({ usedIndexes: [0], ms: 2 })
  })

  it('Worker 内部报错时把消息透出来，面板能显示可重试的原因', async () => {
    const client = await import('./convertClient')
    const pending = client.runConvert(makeJob())
    const worker = FakeWorker.instances[0]
    const request = worker.posted[0] as { id: number }
    worker.emit({ id: request.id, kind: 'error', message: '内存不够' })
    await expect(pending).rejects.toThrow('内存不够')
    expect(worker.terminated).toBe(false)
  })
})
