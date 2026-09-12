import type { Rgb } from './colorDistance'
import type { ConversionSettings } from './convert'
import type { StrategyId } from './strategies'
import type { SourceImage } from './types'
import type { ConvertRequest, ConvertResponse } from './worker'

export interface ConvertDone {
  cells: Uint16Array
  usedIndexes: number[]
  droppedIndexes: number[]
  kindOfSource: 'lineart' | 'pixelart' | 'document' | 'photo'
  /** 实际生效的策略（选了“自动”时由分析结果决定） */
  strategyUsed: StrategyId
  ditherUsed: number
  backgroundConfidence: number
  cropSkipped: boolean
  quantizedColorCount: number
  cropped: boolean
  ms: number
}

export interface ConvertJob {
  image: SourceImage
  paletteColors: Rgb[]
  allowed?: boolean[]
  cols: number
  rows: number
  settings: ConversionSettings
  /** 已有画布内容，clearExisting=false 时当底图；无底图就传 undefined */
  existing?: Uint16Array
  /** 新输入开始时由调用方中止旧任务，防止旧结果回写 */
  signal?: AbortSignal
  onProgress?: (stage: string, ratio: number) => void
}

let worker: Worker | null = null
let nextId = 1

interface PendingJob {
  fail: (reason: unknown) => void
}

const pendingJobs = new Map<number, PendingJob>()

function abortError(): Error {
  const error = new Error('转换已取消')
  error.name = 'AbortError'
  return error
}

function failAllPending(error: Error): void {
  const failedWorker = worker
  worker = null
  failedWorker?.terminate()
  for (const job of [...pendingJobs.values()]) job.fail(error)
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('error', () => {
      failAllPending(new Error('转换 Worker 出错，请重试'))
    })
    worker.addEventListener('messageerror', () => {
      failAllPending(new Error('转换结果无法读取，请重试'))
    })
  }
  return worker
}

/**
 * 转换全链路跑在 Worker 里，像素用 Transferable 过去，结果用 Transferable 回来。
 * 传之前拷一份 buffer：源图要留在内存里给"重新生成"用。
 * 浏览器没有办法中断 Worker 内部正在执行的同步函数，因此取消时终止当前 Worker；
 * 下一次转换会自动创建新的 Worker，所有等待中的 Promise 都会结束，不会永久卡在“转换中”。
 */
export function runConvert(job: ConvertJob): Promise<ConvertDone> {
  if (job.signal?.aborted) return Promise.reject(abortError())
  const w = getWorker()
  const id = nextId++
  const pixels = job.image.data.slice()

  const request: ConvertRequest = {
    id,
    pixels,
    width: job.image.width,
    height: job.image.height,
    paletteColors: job.paletteColors,
    allowed: job.allowed,
    cols: job.cols,
    rows: job.rows,
    settings: job.settings,
    existing: job.existing,
  }

  return new Promise<ConvertDone>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      job.signal?.removeEventListener('abort', onAbort)
      pendingJobs.delete(id)
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const onMessage = (event: MessageEvent<ConvertResponse>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.kind === 'progress') {
        job.onProgress?.(message.stage, message.ratio)
        return
      }
      if (message.kind === 'error') {
        finish(() => reject(new Error(message.message)))
        return
      }
      finish(() =>
        resolve({
          cells: message.cells,
          usedIndexes: message.usedIndexes,
          droppedIndexes: message.droppedIndexes,
          kindOfSource: message.kindOfSource,
          strategyUsed: message.strategyUsed,
          ditherUsed: message.ditherUsed,
          backgroundConfidence: message.backgroundConfidence,
          cropSkipped: message.cropSkipped,
          quantizedColorCount: message.quantizedColorCount,
          cropped: message.cropped,
          ms: message.ms,
        }),
      )
    }

    const onAbort = () => {
      // 转换函数是同步运行的，终止 Worker 才能真正停止旧任务。
      failAllPending(abortError())
    }

    pendingJobs.set(id, { fail: (reason) => finish(() => reject(reason)) })
    w.addEventListener('message', onMessage)
    job.signal?.addEventListener('abort', onAbort, { once: true })
    if (job.signal?.aborted) {
      onAbort()
      return
    }
    try {
      w.postMessage(request, [pixels.buffer])
    } catch (error) {
      finish(() => reject(error))
    }
  })
}
