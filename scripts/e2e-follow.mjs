#!/usr/bin/env node
/**
 * 跟做模式回归检查（130 万格，真浏览器）。
 *
 * 这个页面出过"打开就卡死"：每个色号各扫一遍全图找连通域 = 291 × 130 万格。
 * 这里量的是【主线程响应时间】—— CDP 求值被阻塞多久，就等于用户等了多久。
 *
 * 用法：先 npm run dev，然后 node scripts/e2e-follow.mjs
 */
import { rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const BASE = process.env.PINDOU_E2E_URL ?? 'http://localhost:5173'
const IMAGE = process.argv[2] ?? '/tmp/pindou-test-image.png'
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9400 + Math.floor(Math.random() * 400)
const PROFILE = '/tmp/pindou-e2e-follow'
const BUDGET_MS = 2000

// 每次跑都用干净的浏览器配置：不然上一次存进 IndexedDB 的草稿会影响这一次
// 上一次跑崩了可能留下 Chrome 占着同一个 profile，先清掉
// 上一次跑崩了可能留下 Chrome 占着同一个 profile，先清掉
spawnSync('pkill', ['-f', PROFILE])
rmSync(PROFILE, { recursive: true, force: true })

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1680,1000', 'about:blank'], { stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 中途报错也要把 Chrome 收掉，不然下次会撞上残留实例
process.on('exit', () => { try { chrome.kill() } catch { /* 已经退出了 */ } })
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
    errors.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200))
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable')

const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败')
  return r.result?.value
}
/** 等条件成立；返回等待耗时（ms），超时返回 -1 */
const waitFor = async (expression, timeoutMs = 60000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await js(expression)) return Date.now() - start } catch { /* 页面还在加载 */ }
    await wait(300)
  }
  return -1
}
/** 主线程被占住多久：这条求值的往返耗时就是答案 */
const respondMs = async () => {
  const t = Date.now()
  await js('1')
  return Date.now() - t
}
const fail = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) fail.push(label)
}

// 1) 切到 44×44 个 26 板 = 1144×1144 = 130 万格（跟出问题那次一样大）
//    现在没有预设下拉框了：点「选板 / 换板」→ 选板页右下角的压测按钮
await send('Page.navigate', { url: `${BASE}/#/editor` })
check((await waitFor(`!!document.querySelector('[data-surface]')`, 30000)) >= 0, '编辑器打开（选板页）')
const stress = `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('130 万格'))`
check((await waitFor(`(${stress}) !== undefined`, 20000)) >= 0, '选板页有 130 万格压测台面')
await js(`(${stress}).click()`)
check((await waitFor(`document.body.innerText.includes('1144×1144')`, 30000)) >= 0, '压测台面生效')

const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
await send('DOM.setFileInputFiles', { nodeId, files: [IMAGE] })
const convertMs = await waitFor(`document.querySelector('aside').innerText.includes('结果：') && !document.querySelector('aside').innerText.includes('转换中')`, 120000)
check(convertMs >= 0, '130 万格转换完成', `${convertMs} ms`)

// 2) 进跟做模式：最关心"会不会又卡住"
await send('Page.navigate', { url: `${BASE}/#/follow` })
let worst = 0
let ready = false
const start = Date.now()
while (Date.now() - start < 30000 && !ready) {
  worst = Math.max(worst, await respondMs())
  try { ready = await js(`document.body.innerText.includes('总进度')`) } catch { /* 还在加载 */ }
  if (!ready) await wait(300)
}
check(ready, '跟做页渲染完成', `打开用了 ${Date.now() - start} ms`)
check(worst < BUDGET_MS, `打开过程中主线程没被卡住（每次响应 < ${BUDGET_MS} ms）`, `最慢 ${worst} ms`)

// 3) 点色号 → 推荐 → 点一块标记，每一步都要即时
const clickColor = `[...document.querySelectorAll('aside button')].find(b => /^[A-Za-z]+\\d+\\s*\\n/.test(b.innerText))`
check((await waitFor(`(${clickColor}) !== undefined`, 10000)) >= 0, '色号列表有可选色号')
const pickMs = await respondMs()
await js(`(${clickColor}).click()`)
check(pickMs < BUDGET_MS, '点色号即时响应', `${pickMs} ms`)

await wait(500)
const regionsText = await js(`document.body.innerText.match(/\\d+\\/\\d+ 个区域/)?.[0] ?? ''`)
if (!regionsText) {
  console.log('--- 页面文字 ---')
  console.log(await js(`document.body.innerText.slice(0, 500)`))
  console.log('--- 画布 ---', await js(`document.querySelectorAll('canvas').length`), '--- 报错 ---', errors.slice(0, 3))
}
check(/\d+\/\d+ 个区域/.test(regionsText), '区域数算出来了', regionsText)

const recommend = `[...document.querySelectorAll('button')].find(b => b.innerText.includes('推荐下一个区域'))`
const recMs = await respondMs()
await js(`(${recommend}).click()`)
check(recMs < BUDGET_MS, '推荐下一个区域即时响应', `${recMs} ms`)

await wait(600)
const hitMs = await respondMs()
await js(`(() => {
  const c = [...document.querySelectorAll('canvas')].at(-1)
  const r = c.getBoundingClientRect()
  c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }))
})()`)
await wait(800)
check(hitMs < BUDGET_MS, '在画布上点一块标记完成，不卡', `${hitMs} ms`)
check((await respondMs()) < BUDGET_MS, '标记之后界面依旧不卡')

const progress = await js(`document.body.innerText.match(/总进度 [\\d.]+%/)?.[0] ?? ''`)
console.log('总进度显示：', progress || '(空)')
check(errors.length === 0, '控制台没有报错', errors.join(' / '))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/pindou-follow.png', Buffer.from(shot.data, 'base64'))
console.log('截图：/tmp/pindou-follow.png')
ws.close()
chrome.kill()
console.log(fail.length ? `\n失败 ${fail.length} 项：${fail.join('、')}` : '\n全部通过')
process.exit(fail.length ? 1 : 0)
