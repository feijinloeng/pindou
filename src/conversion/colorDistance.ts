/**
 * 色差与色彩空间。全部纯函数、无随机、无状态。
 * 依赖：sRGB ↔ linear ↔ XYZ ↔ Lab（D65, 2°）+ Oklab（快速预筛用）。
 */

export type Rgb = readonly [number, number, number]
export type Lab = readonly [number, number, number]

/** sRGB 分量（0-255）→ linear 0-1 */
export function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** linear 0-1 → sRGB 分量（0-255） */
export function linearToSrgb(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
  return Math.min(255, Math.max(0, Math.round(c * 255)))
}

export function rgbToLinear(rgb: Rgb): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
}

export function linearToRgb(linear: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])]
}

const XN = 0.95047
const YN = 1.0
const ZN = 1.08883
const DELTA3 = (6 / 29) ** 3
const K = 24389 / 27

/** linear sRGB → XYZ（D65） */
export function linearToXyz(linear: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = linear
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ]
}

function labF(t: number): number {
  return t > DELTA3 ? Math.cbrt(t) : (K * t + 16) / 116
}

export function xyzToLab(xyz: readonly [number, number, number]): Lab {
  const fx = labF(xyz[0] / XN)
  const fy = labF(xyz[1] / YN)
  const fz = labF(xyz[2] / ZN)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** sRGB（0-255）→ CIELAB（D65, 2°） */
export function rgbToLab(rgb: Rgb): Lab {
  return xyzToLab(linearToXyz(rgbToLinear(rgb)))
}

/** linear sRGB → Oklab（Björn Ottosson）。只用来粗筛，不参与最终判定。 */
export function linearToOklab(linear: readonly [number, number, number]): Lab {
  const [r, g, b] = linear
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

export function rgbToOklab(rgb: Rgb): Lab {
  return linearToOklab(rgbToLinear(rgb))
}

/** Oklab 上的平方距离，用作预筛排序键 */
export function oklabDistanceSq(a: Lab, b: Lab): number {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

/**
 * CIEDE2000（Sharma, Wu & Dalal 2005 的实现约定），kL = kC = kH = 1。
 * 必须通过 34 组参考向量，容差 1e-4 —— 不过就不许合并（adr/0004）。
 */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1
  const [L2, a2, b2] = lab2

  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const cBar = (C1 + C2) / 2
  const cBar7 = cBar ** 7
  const G = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)))

  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = hueAngle(b1, a1p)
  const h2p = hueAngle(b2, a2p)

  const dLp = L2 - L1
  const dCp = C2p - C1p

  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2)

  const LBarP = (L1 + L2) / 2
  const CBarP = (C1p + C2p) / 2

  let hBarP: number
  if (C1p * C2p === 0) {
    hBarP = h1p + h2p
  } else {
    const diff = Math.abs(h1p - h2p)
    if (diff <= 180) hBarP = (h1p + h2p) / 2
    else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2
    else hBarP = (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(hBarP - 30)) +
    0.24 * Math.cos(deg2rad(2 * hBarP)) +
    0.32 * Math.cos(deg2rad(3 * hBarP + 6)) -
    0.2 * Math.cos(deg2rad(4 * hBarP - 63))

  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2))
  const CBarP7 = CBarP ** 7
  const RC = 2 * Math.sqrt(CBarP7 / (CBarP7 + 25 ** 7))
  const SL = 1 + (0.015 * (LBarP - 50) ** 2) / Math.sqrt(20 + (LBarP - 50) ** 2)
  const SC = 1 + 0.045 * CBarP
  const SH = 1 + 0.015 * CBarP * T
  const RT = -Math.sin(deg2rad(2 * dTheta)) * RC

  const tL = dLp / SL
  const tC = dCp / SC
  const tH = dHp / SH
  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH)
}

function hueAngle(b: number, a: number): number {
  if (a === 0 && b === 0) return 0
  const deg = rad2deg(Math.atan2(b, a))
  return deg >= 0 ? deg : deg + 360
}

function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180
}

function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** 色板预计算：一次算好 Lab 和 Oklab，后面匹配就不用再算 */
export interface PaletteLabEntry {
  rgb: Rgb
  lab: Lab
  oklab: Lab
}

export function toLabEntry(rgb: Rgb): PaletteLabEntry {
  return { rgb, lab: rgbToLab(rgb), oklab: rgbToOklab(rgb) }
}
