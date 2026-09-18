# Pindou — Agent Guide

## Scope

Pindou is a Chinese, browser-only fuse-bead / pegboard pattern editor. It has no application backend, database server, account system, login, payment, cloud sync, or commercial quota logic.

All project data stays in the visitor's browser (IndexedDB). Images are decoded and converted locally. Do not add a server dependency or remote data path unless the user explicitly requests it.

## Product rules

- Keep user-facing text in Simplified Chinese through `src/i18n/zh.ts`.
- Preserve the project format, legacy project-file compatibility, grid geometry, palette data, conversion pipeline, IndexedDB behavior, and export formats.
- Pattern colors, exported images, and thumbnails must stay true to the selected palette; application styling must not recolor them.
- Validate stored project data and image inputs before allocating large buffers or running expensive work.
- Confirm actions that can discard beads or projects. Project deletion remains recoverable by default; permanent purge must stay behind explicit confirmation.
- Respect reduced-motion preferences. Canvas drawing is Canvas 2D work, not DOM animation.
- Never commit credentials, private project images, server addresses, or user data.
- Never permanently delete files. Rewrite in place or move retired local files to the OS Trash.
- Do not deploy or change DNS, certificates, or production infrastructure unless explicitly asked.

## Architecture

- `src/App.tsx` — editor shell; the library is an in-editor panel. `#/library` is a legacy redirect to `#/editor`.
- `src/pages/Editor.tsx` — switches between the canvas, board picker, and export stage while keeping the canvas session alive.
- `src/pages/Library.tsx` — local project library, project export, recoverable trash, and lightweight indexes.
- `src/components/` — canvas, panels, tool dock, overlays, notices, export UI, and shared controls.
- `src/editor/store.ts` — Zustand editing state and actions.
- `src/domain/` — board geometry, grid rules, palette-independent project validation, and project serialization.
- `src/conversion/` — local image decoding, preprocessing, palette matching, and worker execution.
- `src/storage/` — IndexedDB projects, drafts, cached source images, and autosave lifecycle.
- `src/render/` — Canvas 2D drawing, previews, thumbnails, PDF, and other exports.
- `deploy/` — optional Nginx configuration and a host-parameterized static deployment script.

Before changing UI behavior, trace the affected Zustand action and all its callers. For non-trivial grid, conversion, persistence, export, or motion logic, leave one small runnable check that catches regressions.

## Checks

Prerequisite: Node/npm; use the lockfile with `npm install`.

```bash
npm run dev
npm run typecheck
npm run lint
npm run check
npm run check:browser   # requires a local Chrome/Chromium
npm run build
npm run preview
```

`npm run check` runs the grid-loss self-check. `npm run check:browser` runs persistence, image conversion, canvas, and export checks in an isolated browser profile.

## Deployment

The public site is currently `https://pindou.liangfeiyan.cn`, but deployment is optional and must be explicitly approved. Supply the target host yourself; do not put a server IP or credential in the repository:

```bash
./deploy/deploy.sh user@your-server.example
```

The script builds locally, uploads to a timestamped release directory, keeps the previous release as a backup, validates Nginx, and reloads it. It must not be changed to destructively delete old releases.
