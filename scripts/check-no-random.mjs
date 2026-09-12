#!/usr/bin/env node
/**
 * adr/0004 的硬纪律：转换链路里不许出现随机初始化。
 * 随机会让"同一张图转两次不一样"，是这类工具里最难查的一类 bug。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIRS = ['src/conversion', 'src/domain']
const FORBIDDEN = ['Math.random', 'getRandomValues']
let failed = false

for (const dir of DIRS) {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const text = readFileSync(join(dir, file), 'utf8')
    for (const token of FORBIDDEN) {
      if (text.includes(token)) {
        console.error(`✗ ${dir}/${file} 里出现了 ${token}`)
        failed = true
      }
    }
  }
}

if (failed) {
  console.error('转换链路必须完全确定（adr/0004）')
  process.exit(1)
}
console.log('✓ 转换链路里没有随机初始化')
