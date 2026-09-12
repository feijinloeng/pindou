/// <reference lib="webworker" />
import { convert, type ConversionSettings, type ConvertResult } from './convert'
import type { Rgb } from './colorDistance'

export interface ConvertRequest {
  id: number
  pixels: Uint8ClampedArray
  width: number
  height: number
  paletteColors: Rgb[]
  allowed?: boolean[]
  cols: number
  rows: number
  settings: ConversionSettings
  /** 已有画布内容，clearExisting=false 时当底图 */
  existing?: Uint16Array
}

export type ConvertResponse =
  | { id: number; kind: 'progress'; stage: string; ratio: number }
  | {
      id: number
      kind: 'done'
      cells: Uint16Array
      usedIndexes: number[]
      droppedIndexes: number[]
      kindOfSource: ConvertResult['analysis']['kind']
      strategyUsed: ConvertResult['strategyUsed']
      ditherUsed: number
      backgroundConfidence: number
      cropSkipped: boolean
      quantizedColorCount: number
      cropped: boolean
      ms: number
    }
  | { id: number; kind: 'error'; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const req = event.data
  const started = performance.now()
  try {
    const result = convert({
      image: { width: req.width, height: req.height, data: req.pixels },
      paletteColors: req.paletteColors,
      allowed: req.allowed,
      cols: req.cols,
      rows: req.rows,
      settings: req.settings,
      existing: req.existing,
      onProgress: (stage, ratio) => {
        scope.postMessage({ id: req.id, kind: 'progress', stage, ratio } satisfies ConvertResponse)
      },
    })
    const message: ConvertResponse = {
      id: req.id,
      kind: 'done',
      cells: result.cells,
      usedIndexes: result.usedIndexes,
      droppedIndexes: result.droppedIndexes,
      kindOfSource: result.analysis.kind,
      strategyUsed: result.strategyUsed,
      ditherUsed: result.ditherUsed,
      backgroundConfidence: result.backgroundConfidence,
      cropSkipped: result.cropSkipped,
      quantizedColorCount: result.analysis.quantizedColorCount,
      cropped: result.cropped,
      ms: Math.round(performance.now() - started),
    }
    // 用 Transferable 把结果数组直接交出去，不复制
    scope.postMessage(message, [result.cells.buffer])
  } catch (error) {
    const message: ConvertResponse = {
      id: req.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
    scope.postMessage(message)
  }
}
