# Pindou — Agent Guide

## What this repository is

Pindou is a Chinese, browser-based workspace for designing **fuse-bead / pegboard patterns**. It is a static frontend: there is no application backend or database.

Users can:

- create projects and arrange physical pegboards;
- draw and edit a bead grid on a Canvas 2D workspace;
- convert an image to a palette-limited bead pattern;
- manage colors, selections, whole-pattern transforms, local projects, and exports;

Project data is stored in the visitor's browser (IndexedDB). Do not introduce a server dependency unless explicitly requested.

## Current status — 2026-09-13

The UI and motion redesign described in `docs/ui-motion-redesign-spec-2026-09-13.md` has been implemented and deployed. The specification's opening status text is stale; use this file and the current source as the operational status.

Completed:

- Semantic light/dark/system theme tokens, reduced-motion preference, shared UI primitives, overlay/Escape stack, notices, and GSAP motion helpers.
- Editor redesign: document header, bottom tool dock, temporary panels, persistent canvas across board-picker/export states, focus mode, and project session autosave.
- Board picker redesign: model sidebar, drag/drop/snap layout workspace, geometry validation, dirty guard, lost-cell confirmation, keyboard movement, and mobile layout.
- Library, export, color, conversion, selection, and transform layouts were redesigned without replacing existing editing, conversion, storage, or export algorithms.
- Production build, typecheck, lint, and grid-loss checks pass. The current version was deployed on 2026-09-13.

Still to verify or finish:

1. Manual browser acceptance on desktop and mobile, including screenshots and reduced-motion/Escape flows.

## Important rules for future agents

- Preserve existing project format, grid algorithms, palette data, image-conversion pipeline, local storage, exports, routes, and deployment compatibility.
- Do **not** reset, clean, overwrite, or discard the working tree. This repository contains intentional uncommitted work.
- Never permanently delete files. Keep/rewrite files in place, or move retired local files to the OS Trash only when needed.
- Keep product UI text in Simplified Chinese via `src/i18n/zh.ts`; code identifiers and technical documentation are English.
- Pattern colors, exported images, and thumbnails must remain true colors in dark mode; only application chrome changes theme.
- Respect the OS and application-level reduced-motion settings. Canvas drawing is not GSAP DOM animation.
- Do not expose credentials, private project images, or user data. There are no credentials in the deployment script.
- Do not deploy or alter server/DNS/certificates unless the user explicitly asks.

## Architecture map

- `src/App.tsx` — hash-route shell (`#/library`, `#/editor`), library-only app chrome, route transition, session owner.
- `src/pages/Library.tsx` — project library and recoverable-trash workflow.
- `src/pages/Editor.tsx` — editor state switch: drawing canvas, board picker, or export stage; canvas remains mounted when temporarily hidden.
- `src/pages/BoardPicker.tsx` — physical board layout editing. `src/pages/pickerActions.ts` bridges its header actions.
- `src/components/` — canvas, toolbar, tool dock, workspace controls, panels, export, notices, modal/popover primitives, and overlay state.
- `src/editor/store.ts` — Zustand editing state and actions. `src/editor/uiState.ts` stores UI preferences/session state.
- `src/storage/ProjectSession.tsx` — editor autosave lifecycle. `src/storage/` holds browser persistence.
- `src/render/` — Canvas 2D drawing, viewport, board seams, and bitmap cache.
- `src/domain/` — board/grid domain logic.
- `src/motion.ts` — GSAP tokens, reduced-motion gate, generic animation and presence lifecycle helpers.
- `deploy/` — Nginx configuration and production deployment script.

## Local development and checks

Prerequisite: Node/npm (use the lockfile with `npm install`).

```bash
npm run dev          # Vite development server
npm run typecheck    # TypeScript only
npm run lint         # oxlint with warnings treated as failures
npm run check        # grid-loss self-check
npm run build        # TypeScript build + Vite production build to dist/
npm run preview      # serve the local production build
```

Before changing UI behavior, trace the affected Zustand action and all its callers. For non-trivial grid, conversion, persistence, export, or motion logic, leave the smallest runnable check that catches regressions.

## Production deployment

- **Public site:** https://pindou.liangfeiyan.cn
- **Routes:** `#/library`, `#/editor` (hash routes; no server rewrite logic is required for them).
- **Hosting:** Ubuntu server `82.156.156.239`, served by Nginx from `/var/www/pindou`.
- **Nginx config template:** `deploy/nginx-pindou.conf`.
- **TLS:** Let's Encrypt. The domain's CAA record allows `letsencrypt.org`; do not change certificate authority without reviewing that DNS rule.
- **ICP footer:** `粤ICP备2026075024号-1`, linked to `https://beian.miit.gov.cn/` from the library page footer.

Deploy only after explicit approval:

```bash
./deploy/deploy.sh ubuntu@82.156.156.239
```

The script runs `npm run build`, uploads to a timestamped release directory, renames the current `/var/www/pindou` to a timestamped backup, switches the release into place, runs `nginx -t`, and reloads Nginx. It intentionally keeps the prior release; do not replace this with destructive deletion.
