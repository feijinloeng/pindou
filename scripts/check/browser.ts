#!/usr/bin/env node
/** Run the real browser storage checks without a test framework or a browser dependency. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createServer } from 'vite'

const chrome = process.env.CHROME_PATH ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome')
assert.ok(existsSync(chrome), 'Set CHROME_PATH to a Chrome/Chromium executable.')
const profile = await mkdtemp(join(tmpdir(), 'pindou-check-'))
let finish!: (result: { ok: boolean; message: string }) => void
const result = new Promise<{ ok: boolean; message: string }>((resolve) => { finish = resolve })
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, open: false },
  plugins: [{
    name: 'browser-self-check',
    configureServer(vite) {
      vite.middlewares.use('/__check/result', async (req, res) => {
        let body = ''
        for await (const chunk of req) body += chunk
        finish(JSON.parse(body))
        res.end('ok')
      })
      vite.middlewares.use('/__check', async (_req, res) => {
        const html = await vite.transformIndexHtml('/__check', `<!doctype html>
          <html><head><meta charset="utf-8"></head><body><div id="root"></div>
          <script type="module">
            try {
              const { run } = await import('/scripts/check/persistence.ts');
              const message = await run();
              await fetch('/__check/result', { method: 'POST', body: JSON.stringify({ ok: true, message }) });
            } catch (error) {
              await fetch('/__check/result', { method: 'POST', body: JSON.stringify({ ok: false, message: String(error.stack ?? error) }) });
            }
          </script></body></html>`)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(html)
      })
    },
  }],
})
await server.listen()
const browser = spawn(chrome, [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', `--user-data-dir=${profile}`,
  `${server.resolvedUrls!.local[0]}__check`,
], { stdio: 'ignore' })
browser.on('error', (error) => finish({ ok: false, message: error.message }))
browser.on('exit', (code) => finish({ ok: false, message: `Chrome exited before completion (${code}).` }))
const timeout = setTimeout(() => finish({ ok: false, message: 'Browser checks timed out after 90 seconds.' }), 90_000)
try {
  const outcome = await result
  assert.ok(outcome.ok, outcome.message)
  console.log(outcome.message)
} finally {
  clearTimeout(timeout)
  if (browser.exitCode === null) {
    const exited = once(browser, 'exit')
    browser.kill()
    await exited
  }
  await server.close()
  // Keep the disposable test profile recoverable; never touch the user's browser profile.
  const trash = process.platform === 'darwin' ? join(homedir(), '.Trash') : join(homedir(), '.local/share/Trash/files')
  await mkdir(trash, { recursive: true })
  await rename(profile, join(trash, basename(profile)))
}
