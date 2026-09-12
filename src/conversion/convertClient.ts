import type { Rgb } from './colorDistance'
import type { ConversionSettings } from './convert'
import type { SourceImage } from './types'
import type { ConvertRequest, ConvertResponse } from './worker'

export interface ConvertDone {
  cells: Uint16Array
  usedIndexes: number[]
  droppedIndexes: number[]
  kindOfSource: 'lineart' | 'pixelart' | 'document' | 'photo'
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
  onProgress?: (stage: string, ratio: number) => void
}

let worker: Worker | null = null
let nextId = 1

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  return worker
}

/**
 * 转换全链路跑在 Worker 里，像素用 Transferable 过去，结果用 Transferable 回来。
 * 传之前拷一份 buffer：源图要留在内存里给"重新生成"用。
 */
export function runConvert(job: ConvertJob): Promise<ConvertDone> {
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
  }

  return new Promise<ConvertDone>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ConvertResponse>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.kind === 'progress') {
        job.onProgress?.(message.stage, message.ratio)
        return
      }
      w.removeEventListener('message', onMessage)
      if (message.kind === 'error') {
        reject(new Error(message.message))
        return
      }
      resolve({
        cells: message.cells,
        usedIndexes: message.usedIndexes,
        droppedIndexes: message.droppedIndexes,
        kindOfSource: message.kindOfSource,
        quantizedColorCount: message.quantizedColorCount,
        cropped: message.cropped,
        ms: message.ms,
      })
    }
    w.addEventListener('message', onMessage)
    w.postMessage(request, [pixels.buffer])
  })
}
