#!/usr/bin/env node
/**
 * 拉三个数据源 → 归一化 → 写 src/data/palettes.json
 *
 * 只让这个脚本写那个文件，永远不手改。
 * 用 `node scripts/build-palettes.ts` 跑（Node 24 直接跑 TS，不用装 tsx）。
 *
 * 数据源许可证（都是可商用的）：
 *  - maxcleme/beadcolors         MIT        Perler / Hama / Artkal 全系 + symbol 符号字段
 *  - HansBug/pindou-color-data   MIT        MARD 221/291、COCO 291、漫漫 278、盼盼 289、咪小窝 290
 *  - pomodiary/bitbead.app       CC BY 4.0  跨品牌最近色（v1 不用，先存着）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RAW = 'https://raw.githubusercontent.com'
const MAXCLEME = `${RAW}/maxcleme/beadcolors/master`
const HANSBUG = `${RAW}/HansBug/pindou-color-data/main`
const OUT = join(process.cwd(), 'src/data/palettes.json')

interface BeadColor {
  code: string
  name: string
  hex: string
  rgb: [number, number, number]
  lab: [number, number, number]
  symbol: string | null
}

interface Palette {
  id: string
  brand: string
  displayName: string
  pitchMm: 2.6 | 5
  beadMm: number
  colors: BeadColor[]
  source: { repo: string; license: string; path: string; retrievedAt: string; note?: string }
}

// ---------- 色彩换算（和 src/conversion/colorDistance.ts 同一套公式，这里独立实现一份，
//             保证构建产物不依赖应用代码的变化） ----------

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function labF(t: number): number {
  const delta3 = (6 / 29) ** 3
  return t > delta3 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116
}

function rgbToLab(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map(srgbToLinear)
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeHex(hex: string): string {
  return `#${hex.replace('#', '').toUpperCase().padStart(6, '0')}`
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * 色号按色相排序（抄 Zippland `sortColorsByHue` 的思路）：
 * 无彩色的排最前并按明度走；有彩色的按 5° 色相桶分组，桶内先明度后饱和度。
 */
function sortColorsByHue(colors: BeadColor[]): BeadColor[] {
  const key = (c: BeadColor) => {
    const [l, a, b] = c.lab
    const chroma = Math.hypot(a, b)
    if (chroma < 10) return { bucket: -1, l, chroma }
    let hue = (Math.atan2(b, a) * 180) / Math.PI
    if (hue < 0) hue += 360
    return { bucket: Math.round(hue / 5), l, chroma }
  }
  return [...colors].sort((p, q) => {
    const kp = key(p)
    const kq = key(q)
    if (kp.bucket !== kq.bucket) return kp.bucket - kq.bucket
    if (kp.l !== kq.l) return kp.l - kq.l
    if (kp.chroma !== kq.chroma) return kp.chroma - kq.chroma
    return p.code.localeCompare(q.code)
  })
}

function bead(code: string, name: string, hex: string, symbol: string | null = null): BeadColor {
  const rgb = hexToRgb(hex)
  return {
    code,
    name,
    hex: normalizeHex(hex),
    rgb,
    lab: rgbToLab(rgb).map((v) => round(v)) as [number, number, number],
    symbol,
  }
}

// ---------- 抓取 ----------

/** 上游偶发超时是常态，重试三次再放弃 */
async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`)
      return await res.text()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T
}

/** 上游最后一次提交的日期，用作 retrievedAt（上游不变就不会变，保证可重复构建） */
async function lastCommitDate(repo: string, branch = 'master'): Promise<string> {
  try {
    const data = await fetchJson<{ commit: { committer: { date: string } } }>(
      `https://api.github.com/repos/${repo}/commits/${branch}`,
    )
    return data.commit.committer.date.slice(0, 10)
  } catch {
    return 'unknown'
  }
}

/** maxcleme 的 CSV：code,name,symbol,r,g,b,h,s,l,labL,labA,labB,contributor */
async function loadCsvPalette(
  file: string,
  meta: Omit<Palette, 'colors' | 'source'>,
  retrievedAt: string,
): Promise<Palette> {
  const text = await fetchText(`${MAXCLEME}/gen/v3/${file}`)
  const colors: BeadColor[] = []
  for (const line of text.split('\n')) {
    const parts = line.trim().split(',')
    if (parts.length < 6) continue
    const [code, name, symbol, r, g, b] = parts
    if (!/^\d+$/.test(r)) continue
    colors.push(
      bead(
        code,
        name,
        `#${Number(r).toString(16).padStart(2, '0')}${Number(g).toString(16).padStart(2, '0')}${Number(b).toString(16).padStart(2, '0')}`,
        symbol && symbol !== '!' ? symbol : symbol || null,
      ),
    )
  }
  return {
    ...meta,
    colors: sortColorsByHue(colors),
    source: {
      repo: 'maxcleme/beadcolors',
      license: 'MIT',
      path: `gen/v3/${file}`,
      retrievedAt,
    },
  }
}

interface HansBugFile {
  title: string
  generated_at: string
  count: number
  rows_with_rgb: number
  colors: Array<{ code: string; hex: string; rgb: [number, number, number] }>
}

async function loadHansBugPalette(
  dir: string,
  meta: Omit<Palette, 'colors' | 'source'>,
): Promise<Palette> {
  const file = await fetchJson<HansBugFile>(`${HANSBUG}/${dir}/colors.json`)
  const colors = file.colors.map((c) => bead(c.code, c.code, c.hex))
  return {
    ...meta,
    displayName: `${meta.displayName}（${file.rows_with_rgb}/${file.count} 有色值）`,
    colors: sortColorsByHue(colors),
    source: {
      repo: 'HansBug/pindou-color-data',
      license: 'MIT',
      path: `${dir}/colors.json`,
      retrievedAt: file.generated_at ?? 'unknown',
    },
  }
}

// ---------- 清单 ----------

const CSV_PALETTES: Array<[string, Omit<Palette, 'colors' | 'source'>]> = [
  [
    'perler.csv',
    {
      id: 'perler',
      brand: 'Perler',
      displayName: 'Perler（5mm）',
      pitchMm: 5,
      beadMm: 5,
    },
  ],
  [
    'hama.csv',
    { id: 'hama', brand: 'Hama', displayName: 'Hama（5mm）', pitchMm: 5, beadMm: 5 },
  ],
  [
    'artkal_s.csv',
    {
      id: 'artkal-s',
      brand: 'Artkal',
      displayName: 'Artkal S 中豆（5mm）',
      pitchMm: 5,
      beadMm: 5,
    },
  ],
  [
    'artkal_m.csv',
    {
      id: 'artkal-mini',
      brand: 'Artkal',
      displayName: 'Artkal Mini（2.6mm）',
      pitchMm: 2.6,
      beadMm: 2.6,
    },
  ],
]

const HANSBUG_PALETTES: Array<[string, Omit<Palette, 'colors' | 'source'>]> = [
  [
    'mard-221-github',
    { id: 'mard-221', brand: 'MARD', displayName: 'MARD 221', pitchMm: 2.6, beadMm: 2.6 },
  ],
  [
    'mard-291-github',
    { id: 'mard-291', brand: 'MARD', displayName: 'MARD 291', pitchMm: 2.6, beadMm: 2.6 },
  ],
  ['coco-291', { id: 'coco-291', brand: 'COCO', displayName: 'COCO 291', pitchMm: 2.6, beadMm: 2.6 }],
  [
    'manman-278',
    { id: 'manman-278', brand: '漫漫', displayName: '漫漫 278', pitchMm: 2.6, beadMm: 2.6 },
  ],
  [
    'panpan-289',
    { id: 'panpan-289', brand: '盼盼', displayName: '盼盼 289', pitchMm: 2.6, beadMm: 2.6 },
  ],
  [
    'mixiaowo-290',
    { id: 'mixiaowo-290', brand: '咪小窝', displayName: '咪小窝 290', pitchMm: 2.6, beadMm: 2.6 },
  ],
]

/** 上游应有的色号数（变了就在这里改，脚本会打印差异） */
const EXPECTED: Record<string, number> = {
  perler: 0, // 不校验：Perler 官方色号数会随版本变
  hama: 0,
  'artkal-s': 0,
  'artkal-mini': 0,
  'mard-221': 221,
  'mard-291': 291,
  'coco-291': 291,
  'manman-278': 278,
  'panpan-289': 289,
  'mixiaowo-290': 290,
}

async function main() {
  const retrievedAt = await lastCommitDate('maxcleme/beadcolors', 'master')
  const palettes: Palette[] = []

  for (const [file, meta] of CSV_PALETTES) {
    process.stdout.write(`拉 ${file} … `)
    const palette = await loadCsvPalette(file, meta, retrievedAt)
    console.log(`${palette.colors.length} 色`)
    palettes.push(palette)
  }

  for (const [dir, meta] of HANSBUG_PALETTES) {
    process.stdout.write(`拉 ${dir} … `)
    const palette = await loadHansBugPalette(dir, meta)
    console.log(`${palette.colors.length} 色`)
    palettes.push(palette)
  }

  // 交叉校验：色号不重复、颜色数符合预期
  const problems: string[] = []
  for (const palette of palettes) {
    const codes = new Set(palette.colors.map((c) => c.code))
    if (codes.size !== palette.colors.length) {
      problems.push(`${palette.id} 有重复色号（${palette.colors.length} 行 / ${codes.size} 个色号）`)
    }
    const expected = EXPECTED[palette.id]
    if (expected && expected !== palette.colors.length) {
      problems.push(
        `${palette.id} 期望 ${expected} 色，上游给了 ${palette.colors.length} 色 —— 上游可能变了`,
      )
    }
  }

  palettes.sort((a, b) => a.id.localeCompare(b.id))
  const payload = {
    schema: 'pindou-palettes',
    schemaVersion: 1,
    note: '由 scripts/build-palettes.ts 生成，不要手改。色卡数据来自社区屏幕参考值，不是厂家官方色值。',
    attribution: [
      {
        repo: 'maxcleme/beadcolors',
        license: 'MIT',
        used: 'Perler / Hama / Artkal 的色号、名称、RGB、符号',
      },
      {
        repo: 'HansBug/pindou-color-data',
        license: 'MIT',
        used: 'MARD 221/291、COCO 291、漫漫 278、盼盼 289、咪小窝 290',
      },
      {
        repo: 'pomodiary/bitbead.app',
        license: 'CC BY 4.0',
        used: '跨品牌最近色对照表（v1 未使用，v2 再说）',
      },
    ],
    disclaimer:
      '内置色表来自社区屏幕参考数据。显示器、光线、豆子批次和相机配置都会影响实际观感；需要生产级配色时，请使用品牌实体色卡或校准后的自定义色表。',
    trademarks:
      'MARD、Artkal、Hama、Perler、COCO、漫漫、盼盼、咪小窝等产品名称是各自所有者的商标。本项目仅用于描述色卡或底板兼容性，与这些所有者无关联、未获授权或背书。',
    palettes,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)

  const total = palettes.reduce((n, p) => n + p.colors.length, 0)
  console.log(`\n写入 ${OUT}`)
  console.log(`${palettes.length} 套色卡，共 ${total} 色`)
  for (const p of palettes) console.log(`  ${p.id.padEnd(16)} ${String(p.colors.length).padStart(4)} 色  ${p.displayName}`)
  if (problems.length) {
    console.log('\n⚠️ 需要人工确认：')
    for (const problem of problems) console.log(`  - ${problem}`)
  }
}

await main()
