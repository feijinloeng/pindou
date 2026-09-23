# Pindou

Pindou is a browser-only Chinese fuse-bead / pegboard pattern editor.

## What it does

- Arrange physical pegboards and draw on a Canvas 2D grid.
- Import an image and convert it to a palette-limited bead pattern locally.
- Manage palettes, selections, transforms, drafts, thumbnails, and exports.
- Export `.pindou.json` project files as external copies; project-file import is not currently available.

There is no backend, account, login, payment, cloud sync, or upload service. Projects and cached source images stay in the browser's IndexedDB. Clearing browser data or changing devices does not move projects; exported files are external copies and cannot currently be restored through the app.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal.

## Checks

```bash
npm run typecheck
npm run lint
npm run check
npm run check:browser   # local Chrome/Chromium required
npm run build
```

`npm run build:palettes` refreshes the checked-in palette data from its upstream repositories and requires network access. It is not needed to run the app.

## Repository map

- `src/domain/` — board geometry, grid rules, project validation, and serialization.
- `src/editor/` — editing state, history, tools, and UI state.
- `src/conversion/` — local image decoding and palette conversion.
- `src/storage/` — IndexedDB projects, drafts, and image cache.
- `src/render/` — Canvas 2D drawing and exports.
- `deploy/` — optional static Nginx deployment templates.

## Palette and font attribution

- [`maxcleme/beadcolors`](https://github.com/maxcleme/beadcolors) — MIT; Perler, Hama, and Artkal color fields.
- [`HansBug/pindou-color-data`](https://github.com/HansBug/pindou-color-data) — MIT; MARD, COCO, 漫漫, 盼盼, and 咪小窝 palette data.
- `src/render/fonts/` includes a font subset under the SIL Open Font License; see `src/render/fonts/OFL.txt`.

Palette values are community screen-reference data, not manufacturer-certified color measurements. For production matching, use physical brand swatches or a calibrated custom palette.

## License

The application code is licensed under the MIT License. Third-party data and font files retain the licenses listed above; see `LICENSE` and the notices in `src/data/palettes.json`.
