#!/usr/bin/env node
/**
 * P1 修复的真浏览器回归（不需要图片，用默认空画布就够）。
 *
 * 覆盖那些单测跑不到的界面行为：
 *  - P1-05 在输入框/输入法里打字不会抢走画布快捷键
 *  - P1-04 工具栏显示保存状态（保存中 / 已保存 hh:mm）
 *  - P1-09 空作品的跟做模式显示"暂无可跟做内容"，不是"总进度 100%"
 *  - P1-13 选板可以纯键盘加/移动/删除；画布可以用方向键移动光标、Enter 落色
 *
 * 用法：先 npm run dev，然后 node scripts/e2e-p1.mjs（端口不一样就传 URL）
 */
import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const BASE = process.env.PINDOU_E2E_URL ?? 'http://localhost:5173'
const APP = process.argv[2] ?? `${BASE}`
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9800 + Math.floor(Math.random() * 200)
const PROFILE = '/tmp/pindou-e2e-p1'
const DOWNLOADS = '/tmp/pindou-e2e-p1-downloads'

spawnSync('pkill', ['-f', PROFILE])
rmSync(PROFILE, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1680,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('exit', () => {
  try {
    chrome.kill()
  } catch {
    /* 已经退出了 */
  }
})
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
// 页面里的 window.confirm（比如"放弃这次排板吗"）会阻塞 CDP 调用，必须自动应答
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Page.javascriptDialogOpening') {
    void send('Page.handleJavaScriptDialog', { accept: true })
  }
})
await send('Runtime.enable')

const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败')
  return r.result?.value
}
const waitFor = async (expression, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await js(expression)) return Date.now() - start
    } catch {
      /* 页面还在加载 */
    }
    await wait(250)
  }
  return -1
}
const fail = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`)
  if (!ok) fail.push(label)
}

// ---------- P1-09：空作品的跟做模式（先查，别把画布画脏） ----------
await send('Page.navigate', { url: `${APP}/#/follow` })
check((await waitFor(`document.body.innerText.includes('跟做')`, 20000)) >= 0, '跟做页打开')
// 页面是懒加载的，先等真内容出来（"正在加载…"不算）
check(
  (await waitFor(`document.body.innerText.includes('暂无可跟做内容')`, 20000)) >= 0,
  '空作品页渲染完成（等到真内容，不是加载占位）',
)
const followText = (await js(`document.body.innerText`)).replace(/\n+/g, ' | ')
check(followText.includes('暂无可跟做内容'), '空作品提示"暂无可跟做内容"', followText.slice(0, 120))
check(!followText.includes('100.0%'), '不再显示"总进度 100.0%"')
const resetDisabled = await js(
  `[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '清空进度')?.disabled === true`,
)
check(resetDisabled === true, '空作品时「清空进度」是禁用的')

await send('Page.navigate', { url: `${APP}/#/editor` })
check((await waitFor(`!!document.querySelector('[data-surface]')`, 30000)) >= 0, '编辑器打开（选板页）')

// ---------- P1-13：选板纯键盘可用 ----------
const boards = `[...document.querySelectorAll('[data-surface] [role=button]')]`
const boardCount = await js(`${boards}.length`)
check(boardCount === 1, '默认台面上有一块板', `${boardCount} 块`)

const labelBefore = await js(`(${boards}[0]).getAttribute('aria-label')`)
await js(`(${boards}[0]).focus()
  ;(${boards}[0]).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
await wait(200)
const labelAfter = await js(`(${boards}[0]).getAttribute('aria-label')`)
check(labelBefore !== labelAfter, '聚焦后用方向键能移动板块', `${labelBefore} → ${labelAfter}`)
check(labelsDifferByOne(labelBefore, labelAfter), '移动量正好一个吸附位', `${labelBefore} → ${labelAfter}`)

const addOne = `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('加一块'))`
check((await js(`(${addOne}) !== undefined`)) === true, '有键盘可点的「加一块」按钮')
await js(`(${addOne}).click()`)
await wait(300)
check((await js(`${boards}.length`)) === 2, '「加一块」真的加了一块')

await js(`(${boards}[1]).focus()
  ;(${boards}[1]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`)
await wait(300)
check((await js(`${boards}.length`)) === 1, 'Delete 能删掉选中的板块')

const cancel = `[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('取消'))`
check((await js(`(${cancel}) !== undefined`)) === true, '有「取消」按钮')
// draft 和当前板阵一致时直接关（不该弹确认）；确认弹窗由上面的自动应答兜住
await js(`(${cancel}).click()`)
check((await waitFor(`!document.querySelector('[data-surface]')`, 8000)) >= 0, '取消后回到编辑器画布')

// 选板期间侧栏是 inert 的（屏幕阅读器读不到、Tab 也进不去），但点一下还得给句话
const reopen = `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('选板'))`
await js(`(${reopen}).click()`)
check((await waitFor(`!!document.querySelector('[data-surface]')`, 8000)) >= 0, '「选板 / 换板」能重新打开选板页')
await js(`(() => {
  // 走真实的命中测试：真实点击落在哪，就点哪
  const aside = document.querySelector('aside')
  const r = aside.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + 10, r.top + 10)
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }))
})()`)
await wait(300)
check(
  (await js(`document.body.innerText.includes('先选板')`)) === true,
  '选板期间点侧栏会给一句提示（inert 不会变成无声无息）',
)
check(
  (await js(`document.querySelector('aside')?.closest('[inert]') !== null`)) === true,
  '侧栏及里面所有控件都处于 inert（屏幕阅读器和 Tab 都进不去）',
)
const accept = `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('就用这个板阵'))`
await js(`(${accept}).click()`)
check((await waitFor(`!document.querySelector('[data-surface]')`, 8000)) >= 0, '确认板阵后回到画布')

// ---------- P1-05：输入框和输入法里不抢快捷键 ----------
const toolPressed = (name) =>
  `[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '${name}')?.getAttribute('aria-pressed')`
check((await js(toolPressed('画笔'))) === 'true', '默认工具是画笔')

await js(`(() => {
  const input = document.querySelector('input[type=text], input:not([type])')
  input.focus()
  for (const key of ['v', 'e', 'g']) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
})()`)
await wait(200)
check((await js(toolPressed('画笔'))) === 'true', '在输入框里打 v/e/g 不切换工具')
check((await js(toolPressed('点选'))) === 'false', '点选没有被误触发')

await js(`document.activeElement.blur()
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, isComposing: true }))`)
await wait(150)
check((await js(toolPressed('点选'))) === 'false', '输入法组合输入期间不切换工具')

await js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }))`)
await wait(200)
check((await js(toolPressed('点选'))) === 'true', '不在输入状态时快捷键照样管用')

// ---------- P1-13：画布方向键 + Enter 落色 ----------
await js(`document.querySelector('canvas[role=application]').focus()`)
await wait(200)
const readout = `document.querySelector('[role=status][aria-live=polite]')?.innerText ?? ''`
const before = await js(readout)
await js(`document.querySelector('canvas[role=application]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
await wait(200)
const after = await js(readout)
check(/第 \d+ 行 第 \d+ 列/.test(after), '方向键移动后有"第几行第几列"的文本反馈', after)
const colBefore = Number(after.match(/第 (\d+) 列/)?.[1] ?? 0)
await js(`document.querySelector('canvas[role=application]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))`)
await wait(200)
const colAfter = Number((await js(readout)).match(/第 (\d+) 列/)?.[1] ?? 0)
check(colAfter - colBefore === 5, 'Shift + 方向键一次跳 5 格', `${colBefore} → ${colAfter}`)
check(before !== after, '状态区会随光标更新')

await js(`document.querySelector('canvas[role=application]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
await wait(300)
check(/色号 \S+/.test(await js(readout)), 'Enter 把当前工具作用在光标那一格上')

// ---------- P1-04：工具栏显示保存状态 ----------
const saveText = `[...document.querySelectorAll('span[aria-live=polite]')].map((s) => s.innerText).join(' | ')`
const saved = await waitFor(`${saveText}.includes('已保存')`, 15000)
check(saved >= 0, '落色后自动保存并显示"已保存 hh:mm"', (await js(saveText)).slice(0, 80))

// ---------- P1-12：透明 PNG 的透明区域不能变成黑色 ----------
// 先关掉"自动裁到主体"和"去背景"：这样透明背景会原样进入转换结果，才看得出是不是黑的
await js(`(() => {
  for (const name of ['自动裁到主体', '去背景']) {
    const label = [...document.querySelectorAll('label')].find((l) => l.innerText.includes(name))
    const box = label?.querySelector('input[type=checkbox]')
    if (box?.checked) box.click()
  }
})()`)
await wait(200)
const alphaPng = await js(`(() => {
  const c = document.createElement('canvas')
  c.width = c.height = 120
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#d81b1b'
  ctx.fillRect(30, 30, 60, 60) // 中间红块，四周全透明
  return c.toDataURL('image/png')
})()`)
writeFileSync('/tmp/pindou-alpha.png', Buffer.from(alphaPng.split(',')[1], 'base64'))
const { root: docRoot } = await send('DOM.getDocument', { depth: -1 })
const { nodeId: fileNode } = await send('DOM.querySelector', {
  nodeId: docRoot.nodeId,
  selector: 'input[type=file]',
})
await send('DOM.setFileInputFiles', { nodeId: fileNode, files: ['/tmp/pindou-alpha.png'] })
check((await waitFor(`document.querySelector('aside').innerText.includes('结果：')`, 60000)) >= 0, '透明图转换完成')
await wait(500)
const pixels = await js(`(() => {
  const c = [...document.querySelectorAll('canvas:not([role=application])')].at(-1)
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let dark = 0, opaque = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    opaque++
    if (d[i] < 40 && d[i + 1] < 40 && d[i + 2] < 40) dark++
  }
  return { dark, opaque }
})()`)
check(
  pixels.opaque > 0 && pixels.dark / pixels.opaque < 0.02,
  '透明背景合成成白底，没有变成脏黑',
  `暗像素 ${pixels.dark}/${pixels.opaque}`,
)

// ---------- P1-11：勾多项导出只触发一个下载（打成一个 zip） ----------
rmSync(DOWNLOADS, { recursive: true, force: true })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
await js(`document.querySelector('input[value][placeholder]')?.click()`)
await js(`(() => {
  // 勾上用量 CSV，凑够三项导出：预览图 + 屏幕版 + CSV
  const label = [...document.querySelectorAll('label')].find((l) => l.innerText.includes('用量清单'))
  const box = label?.querySelector('input[type=checkbox]')
  if (box && !box.checked) box.click()
})()`)
await wait(200)
const exportBtn = `[...document.querySelectorAll('button')].find((b) => b.innerText.includes('导出勾选的格式'))`
await js(`(${exportBtn}).click()`)
const bundled = await waitFor(`document.body.innerText.includes('导出完成')`, 60000)
check(bundled >= 0, '导出完成提示出现', bundled >= 0 ? `${bundled} ms` : '')
await wait(1500)
const files = readdirSync(DOWNLOADS)
check(files.length === 1, '三个格式只产生一个下载文件', files.join(', ') || '(没有文件)')
check(files[0]?.endsWith('.zip') === true, '多格式打包成 zip', files[0] ?? '')
check(
  (await js(`document.body.innerText.includes('个文件已打包')`)) === true,
  '提示里说明了打包了几个文件',
)

check(errors.length === 0, '控制台没有报错', errors.slice(0, 3).join(' / '))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('/tmp/pindou-p1.png', Buffer.from(shot.data, 'base64'))
console.log('截图：/tmp/pindou-p1.png')
ws.close()
chrome.kill()
console.log(fail.length ? `\n失败 ${fail.length} 项：${fail.join('、')}` : '\n全部通过')
process.exit(fail.length ? 1 : 0)

/** "第 1 行 第 3 列的 52×52 板" → 取列号比较 */
function labelsDifferByOne(a, b) {
  const col = (text) => Number(text?.match(/第 (\d+) 列的/)?.[1] ?? NaN)
  const row = (text) => Number(text?.match(/第 (\d+) 行/)?.[1] ?? NaN)
  return col(b) - col(a) === 1 && row(a) === row(b)
}
