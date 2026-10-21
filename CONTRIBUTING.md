# Contributing

Thanks for helping. Pindou is a small, dependency-light project; prefer the smallest change that solves the problem.

## Setup

Requires Node.js >= 22.12 and npm. Chrome/Chromium is only needed for the browser checks.

```bash
npm install
npm run dev
```

## Checks before a pull request

```bash
npm run typecheck
npm run lint
npm run check          # grid self-check
npm run build
```

`npm run check:browser` additionally runs persistence, conversion, canvas, and export checks in an isolated Chrome profile. Set `CHROME_PATH` if Chrome is not in the default location.

## Project rules

- User-facing text is Simplified Chinese and goes through `src/i18n/zh.ts`.
- Stay browser-only. Do not add a server, a database, an account system, analytics, or any remote data path. All project data stays in the visitor's IndexedDB.
- Keep the project format, legacy project-file compatibility, grid geometry, palette data, and export formats stable. Pattern colors and exported images must match the selected palette exactly.
- Validate stored project data and image inputs before allocating large buffers or starting expensive work.
- Confirm any action that can discard beads or projects. Project deletion stays recoverable; permanent purge stays behind explicit confirmation.
- Respect reduced-motion preferences.

## Pull requests

One concern per pull request. Describe what changed and how you verified it. For grid, conversion, persistence, or export changes, add or extend a small runnable check under `scripts/check/`.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
