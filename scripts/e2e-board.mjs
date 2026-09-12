#!/usr/bin/env node
/**
 * 自由拼板（选板页）回归检查。
 *
 * 要覆盖的是这次新加的流程：
 *   1. 打开编辑器第一步就是选板，别的控件点不动、点了给提示
 *   2. 从左栏拖板到台面，能叠放成 L 形（错开摆，外接框里有空档）
 *   3. 确认后进入编辑器，空档格子不能画
 * 用法：先 npm run dev，然后 node scripts/e2e-board.mjs
 */
import { rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9400 + Math.floor(Math.random() * 400)
const PROFILE = '/tmp/pindou-e2e-board'

spawnSync('pkill', ['-f', PROFILE])
rmSync(PROFILE, { recursive: true, force: true })
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => { try { chrome.kill() } catch { /* 已退出 */ } })
await wait(2500)

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const errors = []
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300))
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable')

const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败')
  return r.result?.value
}
const waitFor = async (expression, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await js(expression)) return Date.now() - start } catch { /* 还在加载 */ }
    await wait(250)
  }
  return -1
}
const fail = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) fail.push(label)
}

await send('Page.navigate', { url: 'http://localhost:5173/#/editor' })
check((await waitFor(`!!document.querySelector('button[data-surface]') || !!document.querySelector('[data-surface]')`)) >= 0, '一进编辑器就是选板页（台面在）')
check(
  (await js(`document.querySelectorAll('aside').length`)) >= 3,
  '选板时左右面板还在（不是蒙层盖住）',
  `${await js(`document.querySelectorAll('aside').length`)} 个面板`,
)

// 点侧栏的色号：应该点不动，并且给"先选板"提示
const blocked = await js(`(() => {
  // 色号按钮本身就是色块（inline style 里带 background-color）
  const btn = document.querySelector('aside button[style*="background-color"]')
  if (!btn) return { had: false }
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return { had: true }
})()`)
await wait(800)
const noticeAfter = await js(`document.body.innerText.includes('先选板')`)
check(
  blocked.had && noticeAfter,
  '没选板时点侧栏被挡住，并提示"先选板"',
  `找到色号按钮=${blocked.had} 出现提示=${noticeAfter}`,
)

// 拖两块板到台面：一块 104、一块 52，拼成 L 形（错开摆）
// 台面支持"点一下就放"（拖拽在真鼠标下才可靠，合成的 DragEvent 拿不到 dataTransfer）
const drop = (boardType, xRatio, yRatio) => `(() => {
  const surface = document.querySelector('[data-surface]')
  const r = surface.getBoundingClientRect()
  const dt = new DataTransfer()
  dt.setData('text/pindou-board', '${boardType}')
  const opts = {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: r.left + r.width * ${xRatio}, clientY: r.top + r.height * ${yRatio}, pointerId: 1, isPrimary: true,
  }
  // 先在左栏点一下这个型号（等于"手上拿着这块板"），再点台面
  const item = [...document.querySelectorAll('aside button')].find((b) => b.innerText.startsWith('${boardType.replace('mini', '')} ×'))
  item?.click()
  surface.dispatchEvent(new PointerEvent('pointerdown', opts))
  return true
})()`

await js(drop('mini104', 0.02, 0.02))
await wait(500)
const afterFirst = await js(`document.querySelectorAll('[data-surface] > div[title]').length`)
check(afterFirst === 1, '把 104 板放到台面', `台面上 ${afterFirst} 块`)
await js(drop('mini52', 0.82, 0.02))
await wait(500)
const afterSecond = await js(`document.querySelectorAll('[data-surface] > div[title]').length`)
check(afterSecond === 2, '再放一块 52（错开摆成 L 形）', `台面上 ${afterSecond} 块`)

const info = await js(`[...document.querySelectorAll('aside')].map((a) => a.innerText).find((t) => t.includes('板阵信息'))?.replace(/\\n/g, ' | ') ?? ''`)
check(/空档格数/.test(info), '右栏报出了空档格数（L 形外接框里的空白）', info.slice(0, 160))

// 确认进入编辑器
await js(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('就用这个板阵'))?.click()`)
await wait(1000)
const toolbar = await js(`document.querySelector('header')?.parentElement?.innerText.slice(0, 120) ?? ''`)
const summary = await js(`document.body.innerText.match(/\\d+ 块 · \\d+×\\d+ · [\\d.]+×[\\d.]+mm/)?.[0] ?? ''`)
check(summary.length > 0, '确认后工具栏显示板阵摘要', summary || toolbar.slice(0, 60))
check((await js(`document.querySelector('[data-surface]') === null`)) === true, '选板页收起，画布出来了')
check((await js(`document.querySelectorAll('canvas').length`)) >= 1, '画布在')

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/pindou-board.png', Buffer.from(shot.data, 'base64'))
console.log('截图：/tmp/pindou-board.png')
check(errors.length === 0, '控制台没有报错', errors.join(' / '))

ws.close()
chrome.kill()
console.log(fail.length ? `\n失败 ${fail.length} 项：${fail.join('、')}` : '\n全部通过')
process.exit(fail.length ? 1 : 0)
