#!/usr/bin/env node
/**
 * 浏览器端的导入 → 转换回归检查（无头 Chrome + CDP，不需要装 puppeteer）。
 *
 * 为什么需要它：单元测试跑不到「选完文件之后的界面反应」，
 * 而这里最容易出的问题恰恰是"点了没反应"。
 *
 * 用法：先 npm run dev，然后
 *   node scripts/e2e-import.mjs [图片路径]
 */
import { rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const IMAGE = process.argv[2] ?? '/tmp/pindou-test-image.png'
const PROFILE = '/tmp/pindou-e2e-chrome'
const BASE = process.env.PINDOU_E2E_URL ?? 'http://localhost:5173'
const APP = `${BASE}/#/editor`
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9400 + Math.floor(Math.random() * 400)

// 上一次跑崩了可能留下 Chrome 占着同一个 profile，先清掉
// 上一次跑崩了可能留下 Chrome 占着同一个 profile，先清掉
spawnSync('pkill', ['-f', PROFILE])
rmSync(PROFILE, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + PROFILE,
    '--window-size=1680,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
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
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error)
    pending.delete(m.id)
    return
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
})
await new Promise((r) => ws.addEventListener('open', r))
await send('Page.enable')
await send('Runtime.enable')
await send('DOM.enable')

const waitFor = async (expression, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try { if (await js(expression)) return Date.now() - start } catch { /* 还在加载 */ }
    await wait(250)
  }
  return -1
}
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败')
  return r.result?.value
}

const fail = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) fail.push(label)
}

await send('Page.navigate', { url: APP })
await wait(2500)

// 编辑器现在第一步是选板：先确认默认台面
const picked = await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.includes('就用这个板阵'))`, 20000)
check(picked >= 0, '打开编辑器先看到选板页')
await js(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('就用这个板阵'))?.click()`)
await wait(800)
const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
await send('DOM.setFileInputFiles', { nodeId, files: [IMAGE] })
await wait(3000)

const panel = await js(`document.querySelector('aside').innerText.replace(/\\n+/g, ' | ')`)
check(!panel.includes('还没导入图片'), '源图已记下', panel.slice(0, 60))
check(await js(`document.querySelectorAll('aside canvas').length`) === 1, '显示源图缩略图')
check(panel.includes('重新转换'), '导入后自动转换完成（按钮变成重新转换）')
check(/结果：\d+ 色/.test(panel), '有转换结果数字')

const filled = await js(`(() => {
  const c = [...document.querySelectorAll('canvas')][1]
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i+1] << 8) | d[i+2])
  return s.size })()`)
check(filled > 3, '画布上真的画出了图案', `${filled} 种颜色`)
check(errors.length === 0, '控制台没有报错', errors.join(' / '))

// 缩放必须只作用于画布：在画布上滚轮/捏合时，浏览器不能被带着缩放
const zoomText = `document.querySelector('span.tabular-nums.w-12')?.innerText ?? ''`
const zoomBefore = await js(zoomText)
const notPrevented = await js(`(() => {
  // 覆盖层是最后一张画布（前面还有源图缩略图、提交层）
  const el = [...document.querySelectorAll('canvas')].at(-1)
  const r = el.getBoundingClientRect()
  // 已经顶到上限就往回缩，保证这一步真能看出变化
  const zoomLog2 = Number(document.querySelector('input[type=range]').value)
  const ev = new WheelEvent('wheel', {
    deltaY: zoomLog2 > 3 ? 300 : -300, ctrlKey: true, bubbles: true, cancelable: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  })
  // dispatchEvent 返回 false = preventDefault 被调用了 = 浏览器不会缩放页面
  return el.dispatchEvent(ev)
})()`)
check(notPrevented === false, '画布上的捏合/滚轮被拦下（页面不跟着缩放）')
const zoomAfter = await js(zoomText)
check(zoomBefore !== zoomAfter, '画布自己缩放了', `${zoomBefore} → ${zoomAfter}`)

const panelPinchPrevented = await js(`(() => {
  const panel = document.querySelector('aside')
  const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })
  return panel.dispatchEvent(ev)
})()`)
check(panelPinchPrevented === false, '在侧栏上捏合也不会缩整个网页')

const panelScrollOk = await js(`(() => {
  const panel = document.querySelector('aside')
  const ev = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
  return panel.dispatchEvent(ev)
})()`)
check(panelScrollOk === true, '侧栏上的普通滚轮照旧留给面板滚动')

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/pindou-e2e.png', Buffer.from(shot.data, 'base64'))
console.log('截图：/tmp/pindou-e2e.png')
ws.close()
chrome.kill()
console.log(fail.length ? `\n失败 ${fail.length} 项：${fail.join('、')}` : '\n全部通过')
process.exit(fail.length ? 1 : 0)
