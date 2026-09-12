#!/usr/bin/env node
/**
 * 浏览器回归一键跑：起开发服务器 → 依次跑 4 个 e2e 脚本 → 收摊。
 *
 * 为什么要有这个：以前这几个脚本得手动开 npm run dev、手动敲 4 条命令、
 * 还得自己准备一张测试图 —— 结果是"写好了但从来没人跑"（P2-31）。
 *
 * 用法：npm run e2e
 *   CHROME_PATH=/path/to/chrome   换浏览器（默认找 macOS / Linux 的常见位置）
 *   E2E_URL=http://host:port      不用自带服务器，对着已有实例跑
 *
 * 没有浏览器时：默认视为"环境不具备"跳过（不失败）；CI 环境（CI=true）下判失败，
 * 免得门禁静默放过。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const PORT = Number(process.env.E2E_PORT ?? 5199)
const URL = process.env.E2E_URL ?? `http://localhost:${PORT}`
const IMAGE = join(ROOT, 'samples/e2e/test-image.png')
const HEALTH_TIMEOUT_MS = 60_000

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
].filter(Boolean)

const chromePath = CANDIDATES.find((candidate) => existsSync(candidate))

if (!chromePath) {
  const message = '没找到 Chrome/Chromium，浏览器回归跳过（设 CHROME_PATH 指定）'
  if (process.env.CI) {
    console.error(`✗ ${message}`)
    process.exit(1)
  }
  console.log(`… ${message}`)
  process.exit(0)
}

if (!existsSync(IMAGE)) {
  console.log('… 测试图不存在，先重新生成')
  spawnSync(process.execPath, [join(ROOT, 'scripts/make-test-image.mjs')], { stdio: 'inherit' })
}

let server = null
if (!process.env.E2E_URL) {
  console.log(`… 起开发服务器 :${PORT}`)
  server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
}

const stop = () => {
  if (!server?.pid) return
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    try {
      server.kill()
    } catch {
      // 已经退出了
    }
  }
  server = null
}
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

async function waitForServer() {
  const start = Date.now()
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(URL, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return false
}

if (!process.env.E2E_URL && !(await waitForServer())) {
  console.error(`✗ 开发服务器 ${URL} 在 ${HEALTH_TIMEOUT_MS / 1000}s 内没起来`)
  process.exit(1)
}

const SUITES = [
  { name: '导入 / 转换', script: 'scripts/e2e-import.mjs', args: [IMAGE] },
  { name: '自由拼板', script: 'scripts/e2e-board.mjs', args: [] },
  { name: '跟做模式（130 万格）', script: 'scripts/e2e-follow.mjs', args: [IMAGE] },
  { name: 'P1 界面回归', script: 'scripts/e2e-p1.mjs', args: [URL] },
]

const env = { ...process.env, CHROME_PATH: chromePath }
if (process.env.E2E_URL || URL !== 'http://localhost:5173') {
  // 老脚本里 URL 有硬编码，这里用环境变量把端口对齐
  env.PINDOU_E2E_URL = URL
}

const failed = []
for (const suite of SUITES) {
  console.log(`\n=== ${suite.name}（${suite.script}）===`)
  const result = spawnSync(process.execPath, [join(ROOT, suite.script), ...suite.args], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  })
  if (result.status !== 0) failed.push(suite.name)
}

stop()
console.log('')
if (failed.length > 0) {
  console.error(`✗ 失败：${failed.join('、')}`)
  process.exit(1)
}
console.log(`✓ 4 组浏览器回归全部通过（${chromePath.split('/').pop()} @ ${URL}）`)
