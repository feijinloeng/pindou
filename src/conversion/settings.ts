import type { ConversionSettings } from './convert.ts'

export const DEFAULT_SETTINGS: ConversionSettings = {
  strategyId: 'pixelart',
  maxColors: 0,
  dither: 0,
  cropToSubject: false,
  removeBackground: false,
  clearExisting: true,
  fit: 'contain',
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  backgroundThreshold: 26,
}
