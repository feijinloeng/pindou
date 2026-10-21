#!/usr/bin/env node
/**
 * Run the grid/bundle self-checks through Vite's module resolver.
 * Node's own TypeScript runner needs explicit file extensions, and the app follows
 * the bundler convention (extensionless imports), so loading via Vite keeps the
 * check aligned with what actually ships.
 */
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
})

try {
  await server.ssrLoadModule('/scripts/check/grid-loss.ts')
} finally {
  await server.close()
}
