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
      quantizedColorCount: 1,
      cropped: false,
      ms: 1,
    })

    await expect(nextPending).resolves.toMatchObject({ usedIndexes: [0], ms: 1 })
    expect(nextWorker.terminated).toBe(false)
  })
})
