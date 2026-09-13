# Pindou UI and Motion Redesign: Implementation Handoff

Date: 2026-09-13. Status: specification only; implementation has not started.

This is the complete implementation brief for a future coding session. It fixes the design decisions, preserves the existing feature set, assigns every control a home, and defines implementation order and acceptance checks. Do not reinterpret it as a request for another proposal.

Documentation and code identifiers are English. Existing product localization remains Simplified Chinese. Chinese strings quoted below are exact proposed interface labels, not instructions to translate the application into English.

## 1. Execution contract

- Repository: `/Users/feijinloeng/my file/4.pindou`. If moved, use the repository containing this document as the root.
- Rebuild the presentation and interaction structure of the existing application. Keep its project format, editing algorithms, palette data, conversion pipeline, storage, exports, and deployment compatibility.
- The central bead pattern is the primary workspace. Supporting controls must be discoverable without dominating it.
- This is a full visual and layout redesign. Merely changing colors, rounding the existing buttons, or applying animation to the existing arrangement does not satisfy the brief.
- Implement the single direction specified here. Do not spend a new session producing alternatives or asking about colors, fonts, panel placement, animation styles, or component libraries.
- Use the current working tree as the starting point. It already contains uncommitted work. Never reset, overwrite, or discard that work to recover an older version.
- Never permanently delete files. Move obsolete source files to the OS Trash only if retirement is actually necessary. Prefer keeping and replacing existing components in place.
- Preserve the existing recoverable project deletion workflow. Do not invoke permanent deletion while developing or testing. The existing application's permanent-delete capability stays behind its existing explicit confirmation in the Trash view; this does not authorize the implementing AI to use it.
- Do not expose credentials, customer details, project images, or other private data in logs, screenshots, commits, or reports. Use dedicated synthetic QA projects.
- Do not deploy, change Tencent Cloud, edit DNS, or alter the domain/ICP setup as part of implementation. Deliver a verified local implementation and production build. Deployment is a separate request.
- Work sequentially to control cost. No subagents, research detours, Figma round trip, generated artwork, new backend, or replacement framework is needed.
- Actual missing access or destructive decisions can be reported as concrete blockers. Design choices already settled here are not blockers.

## 2. Evidence and current-state findings

### 2.1 What was inspected

The current local checkout was read and its Vite preview was opened at `http://127.0.0.1:5173/`. Visually inspected: editor empty state, color panel, image panel including advanced controls, board arrangement, export empty state/options, library with an empty project, and follow-mode empty state.

Populated drawing, conversion output, downloads, destructive operations, and follow completion were inspected in source, not executed as an end-to-end test during planning. No public production URL was supplied or inspected; the plan describes the local checkout, not a verified production snapshot.

The repository uses React 19, TypeScript, Vite 8, Tailwind 4, Zustand, IndexedDB, and Canvas 2D. `gsap` is already declared at `^3.15.0`. `@gsap/react` and an icon library were not present in `package.json` at inspection. Recheck before adding dependencies.

### 2.2 Existing structure

| Area | Current implementation | Main presentation problem |
| --- | --- | --- |
| Global navigation | `src/App.tsx`, three hash routes | Navigation differs between editor and the other pages; the editor hides destinations in its menu. |
| Editor header | `src/components/Toolbar.tsx` | A compact menu mixes project information, image import, board arrangement, transforms, navigation, and help. Export appears only after a manual save. |
| Drawing tools | `src/components/ToolRail.tsx` | Single-character buttons such as `画`, `擦`, `桶`, `点`, `框` are compact but ambiguous. |
| Canvas | `src/components/CanvasStage.tsx` | Strong red board outline, very small surrounding text, and a generic empty prompt. Zoom is displayed as a large percentage derived from pixels per cell. |
| Auxiliary panels | `src/components/PanelHost.tsx` | One right-side overlay, 288 px wide; close/open motion exists but needs lifecycle and interruption handling. |
| Colors | `src/components/ColorList.tsx` | Hundreds of swatches; exclusion controls appear only on hover/focus; settings and explanations are below a long list. |
| Image conversion | `src/components/ConvertPanel.tsx` | Functional basic/advanced grouping, but weak hierarchy around image selection, parameters, results, and the apply action. |
| Selection actions | `src/components/SelectionBar.tsx` | Contextual floating row exists; its sizing and small menus need a responsive design. |
| Library | `src/pages/Library.tsx` | Small 80 px thumbnails and many always-visible card actions compete with the work itself. |
| Board arrangement | `src/pages/BoardPicker.tsx` | Three simultaneous columns and duplicate cancellation controls; board selection, placement, and confirmation feel disconnected. |
| Export | `src/components/ExportStage.tsx` | Preview receives little visual space; configuration and estimates are disconnected; two header rows repeat context. |
| Follow mode | `src/pages/Follow.tsx` | Permanent side list plus a dense action row; secondary actions have similar prominence to the next-region action. |
| Motion | `src/motion.ts` and per-component effects | Existing fades and button bounce are a starting point; they are not a coherent motion system yet. |

Existing strengths to keep: reversible editing, contextual selection controls, conversion worker, lazy-loaded pages, image thumbnail caching, local drafts, explicit-save requirement for export, source-image cache warning, and granular keyboard support.

### 2.3 Source-level inconsistencies to handle during the redesign

These are findings from the inspected code. Reproduce or confirm before changing them. They are narrowly related to truthful UI behavior and preservation, not authorization for an unrelated rewrite.

1. **Available-color semantics:** `allowedCodes` is a whitelist. `null` means all colors are allowed. `ColorList.tsx` currently treats its entries as excluded in several places. The new panel must derive exclusion as: a whitelist exists and does not contain the code. Use the existing store/data contract; do not invert the stored format.
2. **Export notifications:** `ExportStage` writes to `notice`, but `Editor` currently renders the notice only inside its editing branch. Mount the notification host outside the edit/picker/export switch so export errors and success are visible.
3. **Follow persistence:** `startAutosave()` is mounted by `Editor`, while `Follow` mutates progress without its own subscription. Page switching unmounts the editor subscription. Put one shared project-session persistence owner above both pages and verify follow progress survives reload.
4. **Viewport restoration:** `CanvasStage` performs an initial fit after mounting. Returning from export can remount it and refit despite the stored viewport. Keep the canvas instance mounted while export is open, or explicitly distinguish a new layout from a return to the same layout. The selected implementation below uses a mounted canvas layer hidden during export.
5. **Rotation limits:** current 90-degree rotation requires a square target. Preserve the limitation and present its reason. Do not quietly invent rectangular rotation behavior.
6. **Metadata and saving:** verify edits to customer notes and color availability reach persistence. Do not advertise a saved state merely because the grid's commit counter has not changed. Preserve the existing explicit-save export gate and check the latest save result.

## 3. Fixed design direction

Design read: a calm creative workspace for bead-pattern makers, with a large uninterrupted canvas, recognizable tools, compact contextual controls, and short feedback animations.

Taste configuration: `DESIGN_VARIANCE = 5`, `MOTION_INTENSITY = 4`, `VISUAL_DENSITY = 3` for the workspace. A color browser may have higher local density because comparing colors is its purpose.

This is an original workspace using existing React/Tailwind and shared components, not an imitation of an official enterprise design system. Use opaque neutral surfaces, one restrained green interaction accent, clear typography, and subtle borders. Pattern colors provide most of the visual richness.

No marketing hero, decorative dashboard cards, gradients, perpetual pulsing, animated background, custom cursor artwork, magnifying dock, particle effects, or bouncing canvas.

### 3.1 Shared visual values

Define semantic CSS custom properties in `src/index.css`; all application chrome consumes them. Avoid a large override sheet that merely fights old utility classes.

| Token / rule | Light | Dark |
| --- | --- | --- |
| Workspace surround | `#F2F4F3` | `#171C1A` |
| Main control surface | `#FCFDFC` | `#222925` |
| Hover / grouped surface | `#E9EEEB` | `#2D3731` |
| Primary text | `#202A24` | `#EDF3EF` |
| Secondary text | `#59665E` | `#B6C3BA` |
| Border | `#D8E0DA` | `#46544B` |
| Accent for selected controls | `#2D624B` | `#9ACBAD` |
| Text on accent | `#FFFFFF` | `#17271D` |
| Focus outline | `#2D624B` | `#9ACBAD` |

These are starting tokens, not a claim of measured contrast. Verify text at 4.5:1 and functional graphics/focus indicators at 3:1. Adjust the paired semantic token if measurement fails, not individual random buttons.

- Font: native system sans stack, including PingFang SC and Microsoft YaHei for Chinese. No runtime font CDN. Use native monospace only for color codes and technical dimensions; tabular digits for counters.
- Body and control text: 14 px, line-height 1.5. Secondary descriptions: 12 px minimum. Main page heading: 28 px. Panel heading: 16 px. Avoid long all-caps tracking labels.
- Spacing scale: 4, 8, 12, 16, 24, 32 px.
- Radius: inputs/buttons 8 px; popovers/panels/cards 12 px; only small color dots and status indicators are circular.
- Desktop controls: at least 36 px high; icon targets 40 x 40 px. Coarse-pointer/mobile controls: at least 44 x 44 px. Swatch grid cells are an explicit dense-control exception, with 44 px target height on touch.
- Shadow only for surfaces that actually float: a subtle neutral shadow plus a border. No shadow on every field or section.
- Use one icon family: `@phosphor-icons/react`, regular weight; active tools may use the matching fill weight. Named imports only. No hand-drawn SVG paths or character substitutes.
- Keep the existing product name, favicon, route labels, ICP link and number, attribution, and legal text. Store new product labels in the existing localization module.
- Theme setting: system/light/dark in the application menu; default system. Reduced-motion setting: system/reduced, default system; never override an OS request for reduced motion.
- Theme affects application chrome. Keep actual bead HEX values, white board reference, thumbnails, and export artwork unchanged. A dark interface must never invert pattern colors.

## 4. Page structure and feature ownership

Keep the existing URLs: `#/library`, `#/editor`, `#/follow`. Board selection and export remain substates of the editor, not new routes. Preserve browser Back behavior.

| Page/state | Primary job | Primary action |
| --- | --- | --- |
| Library | Find, open, and manage projects | New project |
| Board arrangement | Choose and arrange the physical boards | Use this arrangement |
| Editor | Edit the bead pattern | Draw; save/export stay accessible |
| Export | Choose outputs and inspect the actual work | Export selected outputs |
| Follow | Assemble the real beads by color and region | Next region |

All screens use the same visual system and shared controls. Do not add a landing page before the library.

## 5. Editor: new layout

The key structural change is to replace the permanent left drawing rail with a **bottom drawing dock**, expose four auxiliary entry points at the upper left, and keep auxiliary panels closed by default.

Desktop schematic, not a literal screenshot:

```text
+--------------------------------------------------------------------------+
| Product/menu | Project name + details | Save status | Library Follow Save Export |
+--------------------------------------------------------------------------+
| [Image] [Colors] [Boards] [Transform]                     [View] [Focus]   |
|                                                                          |
| +-------------------+                                                    |
| | Auxiliary panel   |             BEAD PATTERN                            |
| | only when opened  |             MAIN WORKSPACE                          |
| |                   |                                                    |
| +-------------------+                                                    |
|                                                                          |
| Tool hint       [ six drawing tools | active color | undo redo ]   Zoom  |
+--------------------------------------------------------------------------+
```

The outline describes regions; actual header widths follow the responsive rules in section 11. Do not implement the drawing dock by transforming the canvas or its coordinate parent.

### 5.1 Document header

- Height: 64 px desktop, 56 px mobile. One header only. It remains outside the canvas coordinate system.
- Left: existing product identity with a menu trigger. Menu contains project navigation, new project, project details, theme, reduced-motion setting, and keyboard help. New project follows the same creation path as the library; flush the previous project first.
- Project title: visually borderless input, 200 px preferred, 120 px minimum. Focus shows the normal input border. Do not update on every animation frame. Existing rename behavior can remain immediate; Escape must not claim to undo an already saved edit.
- Adjacent details button opens a small nonmodal form for customer/order notes and a read-only summary: boards, grid size, physical size. Values come from `layoutSizeMm(geom)` and current state.
- Right: readable save status, links to `作品库` and `跟做模式`, secondary `保存作品`, primary `导出`.
- Export is always visible on the editing screen. If the explicit save gate is closed, disable export and show a visible short reason near the save status: `导出前请保存`. Do not leave it undiscoverable or silently bypass the save requirement.
- While saving, prevent duplicate manual requests. After failure, keep the status visible with an enabled retry action. A success checkmark can replace the status icon, without resizing the button row.
- On the board-arrangement screen, replace save/export with that screen's confirmation and cancellation actions. Never suggest that saving confirms an uncommitted board draft.
- On export, use one header with return-to-editor and document context; the export run button belongs to the output summary, not a second competing header.

### 5.2 Upper-left auxiliary launchers

Order and exact short labels: `图片`, `色号`, `底板`, `整图变换`.

- Put the group 16 px from the canvas top and left, in a quiet opaque surface. Each item has an icon and text on desktop.
- `图片`: opens image import/conversion panel.
- `色号`: opens color panel.
- `底板`: enters the dedicated board-arrangement state using `openPicker('edit')`.
- `整图变换`: opens a compact nonmodal transform panel; this is distinct from selection transforms.
- Active panel launcher has accent text/background and `aria-expanded`. Reclicking its launcher closes it.
- Add two controls at the upper right: `显示` for code labels and workspace settings; `专注` for focus mode. Help belongs to the application menu, not another permanent button row.

### 5.3 Bottom drawing dock

- Desktop: centered horizontally, bottom 16 px, 56 px high, opaque surface, 12 px radius, subtle shadow. Maximum intended width: 500 px.
- Tool order: pencil B, eraser E, bucket G, picker I, single-cell tool V, rectangle selection M. Preserve all six distinct behaviors. `select` is a single-cell color operation in the current implementation, not a generic move tool.
- Use Phosphor icons and complete tooltips: Chinese name, one-line purpose, shortcut. Tooltip on hover after 350 ms; keyboard focus shows it immediately.
- Follow tools with a separator, active-color swatch plus readable code, another separator, then undo/redo.
- Active color directly opens the full color panel, not a second intermediate picker. The color panel's pin option supports repeated selection.
- Undo and redo show disabled states based on store capabilities. Shortcuts and click actions go through the same store commands.
- No dock magnification or moving hit targets. Press feedback scales the internal visual wrapper only, leaving the clickable target stable.
- A quiet bottom-left hint describes the active tool. Change it when the tool changes; do not display the entire shortcut manual permanently.

### 5.4 Canvas and view controls

- Canvas fills all space below the header. Reserve no permanent left/right property columns in the default editor.
- Workspace element uses stable positioning and `100dvh`/flex sizing. Canvas rendering remains the current two-layer Canvas 2D implementation.
- Keep direct drawing, wheel/pinch zoom, Space+drag pan, middle-button pan, right-click pick, and existing keyboard movement.
- Display coordinates only when useful and only if already derived by the canvas interaction code. Do not subscribe the whole shell to pointer movement.
- Zoom/fit group: bottom right, above the dock on medium widths. Use `-`, a compact numerical readout, `+`, and fit icon with tooltip.
- Fix the confusing unit without changing zoom math: show `12.2 px/格` as the primary readout because `vp.zoom` is pixels per cell. When code labels are enabled but below `CODE_ZOOM`, explain in View settings that zooming further reveals them. Never display a constant `100%+` in place of the actual scale.
- Replace the alarming red on-screen board outline with a neutral outline. Do this through screen-render options, not by changing shared constants used in exported documents. Keep board seams distinguishable from grid lines and unusable gaps.
- No automatic fit, recenter, or zoom when a panel opens, closes, switches, pins, or a notification appears. Fit is explicit except on first creation or confirmed geometry change.
- On first fit, leave room for top launchers and bottom dock so they do not cover the outermost editable cells. Centralize this padding in `canvasViewport`; do not scatter coordinate offsets across components.

### 5.5 Auxiliary panel behavior

- One panel at a time: image, colors, or whole-image transforms. Preserve the existing store API; extend `PanelId` with a presentation-only transform value if needed.
- Desktop panel: 320 px wide, left 16 px, top 64 px within workspace, bottom 88 px. Header 48 px; body independently scrollable. Maximum height follows available viewport height.
- It overlays the canvas. It never changes canvas dimensions, fitted scale, or the drawing target underneath the cursor.
- No backdrop or modal focus trap on desktop. The user can keep editing while a color panel is pinned.
- Close through X, the active launcher, or Escape. Clicking/drawing on the canvas does not dismiss a pinned panel and must not produce an accidental stroke through a closing overlay.
- Color panel defaults unpinned to preserve current selection behavior: pick a color, close the panel, return focus to the canvas. Pinning keeps it open after selection. Pin does not make a second panel legal.
- Image panel remains open while settings change. Applying successfully closes it as the current store does. Errors remain visible without losing input.
- Preserve image parameters, color query/filter/scroll, and pin preference while switching panels in the same project session. Reset query/scroll and transient confirmation state on project change; retain only explicitly defined app preferences.
- While exiting, the panel is immediately noninteractive and removed from keyboard navigation, then unmounted after the animation. On rapid reopen, cancel the old exit callback before it can unmount the reopened panel.
- Closing a panel does not cancel an existing conversion unless the user invokes a real cancellation operation. Completion feedback is global even when the panel is closed.

### 5.6 Image panel contents

Top to bottom:

1. Heading `图片转换`, close control.
2. Image chooser area. Empty: clear `选择图片` button and supported-image hint. Loaded: actual thumbnail, filename, dimensions, replace action, and remove-source action. Keep upload local; do not send images to a service.
3. Persistent warning when using the cached reduced-size source.
4. Basic settings: target color count, background removal, image fit. Preserve current limits and defaults from `conversion` state: max colors 0 means unlimited; fit remains cover/contain/stretch.
5. `更多调整` disclosure: strategy auto/general/cartoon/portrait/pixel/line art as supplied by the strategy list; dither enabled/amount; crop-to-subject; clear-existing-content. Read defaults from `DEFAULT_SETTINGS`, not copied numbers in the component.
6. Result summary: color count and detected/chosen strategy first. Timing, merged colors, crop result, and skipped-crop explanation under a details disclosure.
7. Fixed panel footer with primary `应用到画布` or `重新转换`. Disabled without an imported image; busy label and real progress while converting.

Parameter edits never trigger an expensive conversion automatically. Apply runs once through `runConvert()`. Preserve confirmation before replacing occupied content and the ability to undo the conversion. Preserve the distinction between removing a source image and clearing the pattern.

Do not implement drag-and-drop upload, automatic live conversion, or an image-editing suite in this scope. The existing file picker is sufficient and predictable.

### 5.7 Color panel contents

Top to bottom:

1. Heading `色号`, pin and close controls.
2. Active swatch, code, name, HEX, current bead count. Render real palette colors; use `labelTextColor` for contrast.
3. Search by code/name/HEX. A clear button resets only the query.
4. Filters: `已用`, `全部`, `可用`. Empty patterns default to All; nonempty patterns initially default to Used. Retain an explicitly selected filter while the panel is open.
5. Five-column swatch grid with consistent targets and code labels. A selected swatch uses outline/check state; excluded swatches are visibly marked, not confused with selection.
6. Fixed footer entry `色彩库设置`. It opens a settings subview within the same panel, with a Back control. The settings entry must not sit after 291 swatches in a long scroll.

Settings subview contains palette/brand selector, used/available/excluded counts, `管理可用色号`, restore-all, exclusion explanation, attribution and trademarks. Management mode exposes explicit exclude/restore controls for touch and keyboard; they are not hover-only X buttons.

Selecting an excluded swatch never paints with it. Excluding a code and changing palette use existing nearest-color remapping. Restore removes the restriction but does not reconstruct already remapped cells; say this in the settings help. Prevent excluding the final available color through the existing store guard.

All counts are based on the actual whitelist semantics. Memoize usage by grid/palette/commitVersion, not pointer movement. Only animate a selected swatch or a small visible group, never all palette entries.

### 5.8 Whole-image and selection operations

Whole-image transform panel contains four explicit operations: clockwise 90 degrees, counterclockwise 90 degrees, horizontal flip, vertical flip; below them a four-arrow control for moving the entire image by one cell. Show the current square-only rotation limitation before the click where applicable. Whole-image actions clear selection before calling the existing transform command.

Selection toolbar appears only with a nonempty selection. Place it under the upper launcher row, centered over the available canvas and outside any open panel's bounds; on small screens use the action sheet described later.

Primary selection actions: fill with current color, copy, clear selected cells, transform menu, More menu, cancel selection. More contains cut, paste, invert, select all. Preserve the existing invert restriction to one rectangle and clipboard-disabled states.

Do not label a rectangle count as a bead count. Use `已选 N 个区域` when reporting the current selection array length. Whole-image move remains in its own panel; do not accidentally apply it as a selection move.

### 5.9 Focus mode

- This is a presentation mode, not browser fullscreen.
- Hide document metadata, auxiliary launchers, open panels, selection toolbar when absent, and passive hints. Keep the drawing dock, zoom controls, and a visible `退出专注` button at the upper right.
- Store which panel was open. Restore it on exit with its input intact; do not erase store state to implement hiding.
- Escape closes the topmost popup first, then a selection if present, then exits focus mode. Never consume the same Escape twice.
- Do not refit the canvas. Header height stays reserved to avoid a layout jump; its contents fade away and the background merges with the workspace.
- Focus is session-only, reset when changing projects. Do not add another keyboard shortcut that can collide with typing.

## 6. Complete feature relocation ledger

| Existing capability | New home | Existing command/data to retain |
| --- | --- | --- |
| New project | Library primary action; application menu shortcut | `newProject`, `putProject`, existing picker-return flow |
| Project name | Header inline name | `setName` |
| Customer/order note | Header project-details popover | `setCustomer` |
| Manual save | Header Save | `saveNow(true)` |
| Save status/retry | Header status, persistent error notice | `saving`, `saveError`, `savedAt` |
| Export eligibility | Always-visible header Export | `savedCommitVersion`, `commitVersion`, `openExport` |
| Import/replace/remove source | Image panel | `importImage`, `clearSourceImage`, source cache |
| Conversion and advanced parameters | Image panel | `setConversion`, `runConvert`, existing strategies |
| Draw/erase/fill/pick/single-cell/rectangle | Bottom dock | Six existing `ToolId` values and pointer commands |
| Undo/redo | Dock | `undo`, `redo`, capability flags |
| Current color | Dock and color panel | `colorIndex`, `setColor` |
| Search/filter color | Color panel | Query/filter UI, actual palette and usage |
| Pin color panel | Color panel header | `colorPinned`, `setColorPinned` |
| Change palette | Color settings subview | `setPalette` |
| Exclude/restore colors, restore all | Color settings management mode | `toggleCode`, `restoreAllCodes`, whitelist semantics |
| Palette notices/legal attribution | Color settings disclosure | Existing data strings, unchanged |
| Board arrangement | Upper-left Boards | `openPicker`, `applyLayout`, `closePicker` |
| Board counts/size | Project details and board summary | Geometry and `layoutSizeMm` |
| Show color codes | View popover | `showCodes`, `setShowCodes`, `CODE_ZOOM` |
| Zoom/pan/fit | Canvas interactions and lower-right view controls | Existing viewport functions |
| Whole-image rotations/flips/one-cell translation | Whole-image panel | `clearSel` then `rotate`/`mirror`/`translate` |
| Selection fill/copy/cut/paste/clear/invert/all/cancel | Contextual selection toolbar | Existing selection commands |
| Selection rotation/flip | Selection transform submenu | Existing selection-aware `rotate`/`mirror` |
| Shortcuts | Application menu Help; tooltips | Existing keyboard guard and shortcut mapping |
| Library open/follow | Card preview and follow action | Draft-aware project loading |
| Library duplicate/rename/export project | Card More | Existing handlers, project serialization |
| Recoverable deletion/restore | Card More / Trash tab | `trashProject`, `restoreProject` |
| Existing permanent deletion | Trash card More, separated and confirmed | Existing `purgeProject`; never invoked by development QA |
| PNG/PDF/print/CSV export and bundling | Export screen | `estimateExport`, `buildExportBundle` |
| Follow color focus/recommend/mark complete | Follow controls | Existing region algorithms and progress state |
| Follow strategy/reset/fullscreen | Follow settings and explicit controls | Existing strategies, reset, Fullscreen API |
| Errors/recovery/diagnostics | Global notice and error boundary | Existing recovery and diagnostics functions |
| ICP notice | Library footer, visible and linked | Existing exact number and URL |

## 7. Library redesign

- Keep the normal application navigation, with Library selected. Main content maximum width 1280 px, centered with 32 px desktop padding and 16 px mobile padding.
- Page title and one factual subtitle: projects are stored in this browser. Never imply cloud synchronization.
- Top-right primary `新建作品`; secondary `导入工程文件`. New opens a compact name dialog with Enter to create, Escape to cancel; empty name uses the existing untitled fallback, then enters board arrangement.
- A single toolbar below the title: project-name/customer search, `作品` and `回收站` tabs, sort by updated time (newest first). Search is local and does not change stored data.
- Cards use a large real pattern thumbnail with a 4:3 preview region. Show project name, two compact metadata lines (beads/colors and board/physical size), draft badge only when real, and last update.
- Clicking preview/name opens the newest applicable draft using the existing logic. Keep one visible `跟着拼` secondary action and a persistent More icon. Do not require hover to find More.
- More contains duplicate, rename, export project, project details, and move to Trash. Details exposes all existing summary values, including cell count and customer name, without putting every number on every card.
- Use the existing soft-delete name-prefix semantics to derive Trash; do not migrate the database schema. Display the clean name in Trash without changing storage representation.
- Trash provides restore and the existing carefully separated permanent-delete operation. Restore is the visible primary action. Opening/following a trashed item, if retained, first offers recovery so an autosave cannot silently turn a trashed item into a live project.
- Three cards across at >=1200 px, two at 768-1199 px, one below 768 px. These are actual project tiles, not decorative feature cards.
- Empty library: one centered explanatory block and New/Import. Empty search: query-specific message with Clear search. Empty Trash: short message. Use no fabricated sample projects or remote art.
- Keep per-card operations disabled while that project is being modified. Errors are inline and retryable; a failed read must not masquerade as an empty library.
- Keep legal footer visible at the bottom of the library content. Avoid adding an editor footer that reduces the drawing area.

## 8. Board-arrangement redesign

Desktop changes from three columns to two: **260 px configuration sidebar + arrangement workspace**. Move summary and the single confirmation action into the sidebar; remove the permanent right summary column.

- Sidebar heading `选择底板`. Separate model choices by 2.6 mm and 5 mm pitch using plain group labels. Keep all five models: mini26, mini52, mini78, mini104, midi29.
- Each row: simple board glyph from the icon family, peg dimensions, pitch, and calculated peg-area physical size. Do not confuse `outerMm` (manufacturer's outside dimension) with the pattern's physical size.
- Selection highlights the model; it does not add a board until `添加一块`, clicking the surface, or dragging a model onto it.
- Add button sits immediately after model selection. Preserve drag insertion, click insertion, board dragging, keyboard movement, right-click removal, Delete/Backspace removal, overlap validation, pitch validation, and snapping.
- Selecting/focusing an already placed board exposes a visible `移除这块` action so touch users do not need right-click. Do not remove a board merely by selecting it.
- Arrangement toolbar: title, undo-last-board, More with clear-arrangement, zoom control. One cancellation action in the document header; no duplicates.
- Sidebar summary below models: board count, grid dimensions, physical size. Expand details for usable cells, total bounding cells, holes. Empty values use `待添加`, not invented dimensions.
- Sidebar footer: primary `使用此板阵` plus errors immediately above it. Confirm disabled when empty or invalid.
- Existing layout is copied to local draft when entering. Cancel changes no project geometry. Warn on discarding a dirty arrangement. Confirm warns about actual lost cells through `lostCells`, then uses `applyLayout`.
- Do not force a rectangular board array. Preserve free placement and unusable holes. Keep limits from domain code and existing explanatory warnings.
- On mobile, models appear in a top horizontal list with explicit labels; summary opens as a sheet from the fixed bottom confirmation bar. The arrangement surface keeps the largest remaining area and all non-drag alternatives remain available.

## 9. Export redesign

- Single header with `返回编辑`, project name, and a small saved-state indication. No editor tool dock on this screen.
- Desktop content: real preview on the left, 380 px output column on the right. Preview is centered on a neutral surface and can occupy up to 60vh without distortion. Use existing thumbnail renderer; do not substitute a decorative image.
- Output heading `选择导出内容`. Four vertically stacked selectable rows: `成品预览`, `屏幕图纸`, `打印纸样`, `用量清单`. The format explanation sits below each plain-language label.
- Rows can be selected together; at least one must remain selected. Selection reveals only that output's options. Preserve current defaults: preview and screen enabled; print and CSV disabled.
- PNG options: 8/16/32 px per bead, default 16. Preserve clamping and actual-output-size estimate.
- Screen PDF options: code labels and material list, initially enabled as current behavior. Preserve actual page estimate.
- Print options: per-board or bundle scope; optional code labels; physical 1:1 scale and A4 splitting unchanged.
- CSV option: no unnecessary configuration.
- Summary beneath options shows actual estimated pixel size/page count and actual sanitized/truncated filename. Render warnings persistently before the run button.
- Primary run button remains visible in the output-column footer. While busy, show an honest busy label, disable duplicate run and conflicting option changes, keep feedback visible. Do not fabricate percentage progress when the exporter provides none.
- Multiple outputs continue producing a single ZIP through `buildExportBundle`, not parallel browser download attempts.
- Success means the file was generated and download initiated, not proof that the user saved it to disk. Failure leaves configuration intact and offers retry.
- Printing and assembly instructions stay in a disclosure under the summary. Preserve the existing calibration ruler, actual-size instructions, overlap, alignment, and file contents.
- Empty pattern shows an actionable return-to-editor message and disabled export. Returning to edit preserves the previous viewport, active tool, palette, selection, and source settings.
- Mobile: smaller preview first, then output choices. Sticky bottom action with expandable estimate, no nested horizontal scrolling.

## 10. Follow-mode redesign

- Same document header language, with `返回编辑` and project name. The whole workspace, including color access, is the fullscreen target.
- Desktop: collapsible 260 px color/progress sidebar, main pattern workspace. Unlike editing, persistent colors are appropriate here because color-by-color assembly is the task.
- Sidebar top: real overall percentage and completed/remaining totals derived from existing regions. Small progress line, no celebration loop.
- Used colors only: large swatch, code, remaining/total beads, completed checkmark. Click sets focus color. Keep a visible color-switch button when collapsed.
- Main contextual bar: active code, beads and regions remaining, primary `下一个区域`. Secondary `此色已完成`. Strategy is in an Options popover using the three existing choices: largest, nearest, edge-first.
- Move reset progress, help, and fullscreen into a compact secondary group. Reset requires a clearly worded confirmation because it discards recorded progress; cancelling preserves progress.
- Clicking a region keeps the existing completion toggle and faded display. Do not introduce bead-by-bead completion or change region matching.
- On completion of one color, show a stable inline message and offer to select another color. Do not auto-switch colors while the user is placing beads.
- Empty pattern: one central message with `返回编辑`, not a toolbar full of disabled controls plus an unexplained grid.
- Mobile: colors in a bottom sheet, current color and next-region action in the bottom bar. Fullscreen must retain a reachable color selector and exit control.
- Preserve progress across route changes and reload through the shared persistence owner in section 13.
- Cancel recommendation motion immediately on manual pan, zoom, or a second recommendation. Keyboard and touch must not compete with an automatic camera movement.

## 11. Responsive and accessibility rules

| Width/condition | Header | Tools and panels | Workspace |
| --- | --- | --- | --- |
| >=1280 px | Full one-line document header | Full upper-left launchers, bottom dock; 320 px overlay panel | Dock and zoom share bottom band without overlap |
| 1024-1279 px | Shorter title; compact status | Same structure; help text shortened | Zoom moves to upper right below View if it would collide with dock |
| 768-1023 px | Navigation links collapse into app menu; Save/Export remain | Text labels for launchers; 320 px overlay | No permanent side columns except explicitly expanded follow list |
| <768 px | 56 px header; short title; icon Save and text Export with accessible names | Launchers collapse into one labeled `功能` button; panels become bottom sheets | Six 44 px tools in a horizontal bottom row; undo/redo/color in adjacent compact row |
| Height <600 px | Compact header | Panel body scrolls; dock/hints compact | No hidden close/confirm buttons or forced document-level horizontal overflow |

Mobile sheets use at most 72dvh, honor safe-area insets, and keep heading/close and primary footer visible. They are modal: focus stays within the sheet, background is inert, Escape/backdrop closes where no confirmation is required. A drawing gesture cannot start through a sheet. No drag-to-dismiss is required.

At 360 px width, six 44 px tools plus 4 px gaps fit in 284 px. Keep the second tool row within available width; do not shrink touch targets to cram desktop controls into one line. Selection actions replace the secondary row while a selection exists; More opens the action sheet.

Accessibility:

- Native buttons, labeled inputs/selects, named regions, `aria-pressed` for tool toggles, `aria-expanded` and `aria-controls` for disclosures.
- Menus contain menu items with arrow-key navigation, Home/End, Escape and focus return. A popover with a text form is a nonmodal dialog, not an invalid menu containing arbitrary fields.
- Focus ring remains visible in both themes. Do not use color as the sole selected, excluded, error, or completed indicator.
- Desktop auxiliary panels are nonmodal; mobile sheets and confirmation dialogs are modal. Define focus restoration per opener. Color selection that closes a panel returns focus to the canvas to continue drawing.
- Tooltip text is also an accessible name or description; core actions never rely on hover.
- Preserve IME composition and editable-target guards in `shouldHandleCanvasKey`. New dialogs/popovers must prevent drawing shortcuts from firing through them.
- Escape handling belongs to one overlay coordinator: topmost dialog/menu, then panel, then selection, then focus mode. On board arrangement, Escape invokes the same guarded cancel path; on export it returns only when not busy. Respect input-local Escape first.
- No generic use of Tab to enter focus mode, and no replacement of browser shortcuts.
- Notifications use polite live announcements for routine success and alerts for errors. Success can disappear after four seconds; actionable errors persist until dismissal or correction.

## 12. Taste Skill and GSAP integration

### 12.1 Skill responsibilities

Installed skills at inspection:

- Taste: `/Users/feijinloeng/.codex/skills/design-taste-frontend/SKILL.md`.
- GSAP Core: `/Users/feijinloeng/.codex/skills/gsap-core/SKILL.md`.
- GSAP React: `/Users/feijinloeng/.codex/skills/gsap-react/SKILL.md`.
- GSAP Timeline: `/Users/feijinloeng/.codex/skills/gsap-timeline/SKILL.md`.
- GSAP Performance: `/Users/feijinloeng/.codex/skills/gsap-performance/SKILL.md`.
- Other available GSAP skills: frameworks, plugins, ScrollTrigger, utils. They are not required by this scope.

Only one Taste entry was found in the installed skill directory. Do not claim to have used an unseen complete Taste repository. If another machine lacks these files, this document supplies the essential project-specific requirements; do not block implementation just to install a similarly named skill.

Taste's own scope favors landing pages and visual redesigns and excludes dense product UI. Apply its relevant discipline: brief inference, explicit density, visual consistency, typography, meaningful empty states, accessibility, responsive composition, and motivated motion. The canvas editor's interaction model comes from this specification. Do not transplant marketing-page sections, hero images, scroll storytelling, or arbitrary decorative asymmetry.

The user explicitly chose GSAP. This overrides Taste's default preference for Motion. Do not install `motion` or `framer-motion`, and do not let two animation engines control the same element.

| Skill | Concrete use here |
| --- | --- |
| Taste | Layout hierarchy, one accent, consistent sizing, controls that reveal detail on demand, full screen/state review |
| GSAP Core | Short transform/opacity transitions, stable easing, overwrite handling, reduced-motion matching |
| GSAP React | Scoped animation setup, cleanup, safe event callbacks, no detached-element animation |
| GSAP Timeline | Coordinated header/canvas/tool entry, open/close sequences, feedback sequencing |
| GSAP Performance | Keep paint responsive, avoid animating dimensions, limit simultaneous animations, isolate hot updates |

No ScrollTrigger, ScrollSmoother, Draggable, Inertia, SplitText, physics plugin, or scrolling scene is needed. Native scroll stays native. Existing board/canvas pointer algorithms remain responsible for precise drag behavior.

### 12.2 Motion infrastructure

Extend `src/motion.ts` into the single motion specification consumed by shared primitives. Verify dependencies first; reuse `gsap`. Add `@gsap/react` for scoped React integration and `@phosphor-icons/react` for icons, only if absent. Keep versions compatible with the installed React/GSAP versions and lock them through the existing package lock.

- Shared timing values: press 0.10 s, release 0.18 s, short fade 0.14 s, panel entry 0.24 s, panel exit 0.16 s, page entry 0.36 s, contextual content 0.18 s.
- Default entry ease `power3.out`; exit `power2.in`; small control release `back.out(1.2)` only where the overshoot is subtle.
- GSAP owns transform/opacity motion. CSS owns static states, focus outlines, and 120 ms color/border transitions. No `transition: all` and no CSS/GSAP ownership conflict.
- Use `useGSAP` with element refs/scoped selectors and cleanup on unmount. Deferred event-created tweens must be context-safe or explicitly killed. Existing bare `animate()` calls need cleanup, not just a renamed helper.
- Use `gsap.matchMedia` for OS reduced motion. The app's reduced setting can further reduce motion; it cannot re-enable motion against the OS preference.
- Reduced mode: visibility and selected states update immediately. Skip spatial travel, stagger, bounce, and camera movement. Exit callbacks and DOM cleanup still execute.
- Separate desired visibility from rendered presence. Exit must finish before unmount, but an obsolete exit must never remove a reopened element. Use one presence implementation for panels, menus, sheets, and notifications.
- Do not put GSAP transforms on a canvas coordinate ancestor. Animate the dock's inner container, panel wrapper, or chrome elements. Canvas uses opacity only during page entry.
- No repeating timelines or listeners left after route changes. Do not animate all 291 colors or hundreds of project cards. Animate at most the first visible 8 cards or 12 swatches, total stagger <=0.25 s.

### 12.3 Motion inventory

| Trigger | Purpose and exact behavior | Mechanism |
| --- | --- | --- |
| First editor display | Header fade 180 ms; canvas opacity 0 to 1 over 220 ms; dock y 8 to 0 and opacity over 240 ms, slightly overlapping. Whole intro <=400 ms. | One GSAP timeline; do not wait to enable drawing. |
| Navigate between pages | Incoming content opacity 0 to 1 over 180 ms. No horizontal page slide. Loading placeholders retain layout size. | Scoped tween after lazy content mounts. |
| Open auxiliary panel | x -12 to 0, opacity 0 to 1, 240 ms. | GSAP Core and presence. |
| Close auxiliary panel | x 0 to -8, opacity 1 to 0, 160 ms; disable interaction immediately. | Presence exit then unmount. |
| Switch panel type | Keep panel frame in place; crossfade old/new inner content, 140 ms. | Short timeline; no entire drawer exit/reentry. |
| Open mobile sheet | y 20 to 0 and opacity over 240 ms; backdrop fades 140 ms. | Timeline, modal focus management. |
| Open menu/popover | y -4 to 0, scale 0.98 to 1, opacity over 160 ms; close 100 ms. | Scoped presence. |
| Press tool/button | Internal visual scale 1 to 0.97 in 100 ms; return to 1 in 180 ms. Keyboard activation gets one release pulse. | Context-safe GSAP, overwrite current tween. |
| Change active tool | Selected fill updates immediately; icon opacity 140 ms. No moving button positions. | CSS state plus GSAP visual feedback. |
| Select color | Swatch border/check updates immediately; tiny internal scale 0.97 to 1 over 180 ms; active dock swatch crossfades. | Targeted tween only. |
| Show selection actions | Inner row y -6 to 0 and opacity over 180 ms; exit 120 ms. | Presence; positioning wrapper stays untransformed. |
| Open advanced details | Content appears in its final layout; opacity/y 4 to 0 over 160 ms. Close restores layout directly. | No animated height or expensive measurement loop. |
| Conversion progress | Real progress fill uses scaleX with left origin, 160 ms smoothing. Never animate width or invent progress. | One replaceable tween. |
| Conversion complete | Result summary fades in 180 ms; pattern content commits immediately. | UI tween; no bead-by-bead reveal. |
| Save success/error | Status icon/text crossfade 140 ms. Error remains legible and stable. | Opacity, no whole-header bounce. |
| Toast | Inner content y 8 to 0 and opacity, 180 ms; exit 120 ms. | Global presence host. |
| Library first results | Visible cards y 8 to 0 and opacity 220 ms, 25 ms stagger, bounded. | Timeline/stagger; rename does not replay the entire list. |
| Board add/select | Label/check highlight and opacity entry 160 ms. Keep pointer-coordinate wrapper and geometry exact. | Tween inner visual only; no Draggable replacement. |
| Export option select | Border/check instant; options opacity/y 4 over 160 ms. | Shared disclosure behavior. |
| Follow next region | Interpolate viewport numeric values over 260 ms with `power2.inOut`; cancel on manual input/new request. | Dedicated viewport controller feeding current renderer, never CSS-transform the canvas. |
| Follow completion | Progress scaleX updates 180 ms; checkmark fades in; completed cells use existing immediate render. | GSAP only on progress UI. |
| Enter/exit focus | Chrome fades 160 ms; layout and canvas position stay unchanged. | Timeline with input/focus states updated correctly. |

For the follow camera, use a mutable viewport ref and a render invalidation callback to avoid rerendering the entire page every animation frame. Synchronize React state at completion/interruption. Keep a single owner of the viewport and clamp the final value with existing helpers. Do not attach GSAP directly to Zustand store fields. If implementing this controller would change core rendering behavior, keep the existing instant recommendation until the controller and its interruption checks are complete; the final deliverable still must meet the specified behavior.

## 13. Component and state implementation map

All paths below are relative to the repository root. Existing files are anchors; create only the listed supporting boundaries when they simplify responsibility. Do not split every tiny label into a file.

| File / boundary | Required responsibility |
| --- | --- |
| `src/index.css` | Semantic tokens, light/dark states, spacing/type/radius standards, responsive workspace layout, reduced-motion CSS fallback |
| `src/App.tsx` | Shared app shell, stable routing, app-wide notice/error layer, exactly one project-session lifecycle owner |
| `src/components/ui.tsx` | Buttons, icon buttons, labeled fields, menu versus form-popover distinction, disclosure, tooltip, modal/sheet foundations |
| New `src/components/OverlayHost.tsx` | Shared portal/layer ownership, topmost Escape handling, focus return, modal background handling |
| `src/motion.ts` | Motion tokens, GSAP registration, reduced-motion policy, presence/entry helpers or their exports |
| New `src/editor/uiState.ts` | Presentation-only preference/state when needed: focus mode, panel view/query/filter, theme/motion preference. No grid data duplication. |
| New `src/storage/ProjectSession.tsx` | Restore current project once, restore cached source, one autosave subscription shared by editor/follow, safe cleanup and pending-save handling |
| `src/pages/Editor.tsx` | Compose header, stable canvas workspace, dock, launchers, panels and stages; prevent shortcuts through overlays |
| `src/components/Toolbar.tsx` | New document header and project details, save status, stable export entry |
| `src/components/ToolRail.tsx` | Reimplement as bottom dock in place; rename/export as ToolDock if useful without leaving duplicate controls |
| New `src/components/WorkspaceControls.tsx` | Four auxiliary launchers, View controls, focus mode trigger |
| `src/components/CanvasStage.tsx` | Preserve drawing/render loop; safe-area-aware initial fit, view controls, improved empty state, stable stage lifecycle |
| `src/components/PanelHost.tsx` | Left overlay / mobile sheet, single-panel state and interruptible presence |
| `src/components/ConvertPanel.tsx` | Reordered image/basic/advanced/result/footer sections using current conversion actions |
| `src/components/ColorList.tsx` | Browsing/settings subviews, correct whitelist display, accessible availability management |
| New `src/components/TransformPanel.tsx` | Explicit whole-image actions; no duplicate transform algorithms |
| `src/components/SelectionBar.tsx` | Responsive contextual selection actions and menus |
| `src/pages/Library.tsx` | Gallery, local search/sort/trash views, concise cards, existing storage handlers |
| `src/pages/BoardPicker.tsx` | Two-column model/summary and arrangement workspace, same draft and validation model |
| `src/components/ExportStage.tsx` | Preview/output split, persistent busy/result/error feedback, existing exporters |
| `src/pages/Follow.tsx` | Color sidebar/sheet, contextual progress/actions, cancellable recommendation movement |
| `src/i18n/zh.ts` | All new Chinese interface labels and short explanatory text, preserve existing legal text |
| `src/editor/keyboard.ts` | Preserve input/IME guards; add overlay-aware routing only where necessary |

State invariants:

- `useEditor` remains the source of truth for grid, palette, selection, history, conversion, project data, and current viewport.
- `version` is for transient drawing updates; `commitVersion` is for committed changes. The shell must not subscribe to transient drawing values.
- Keep save queue behavior and project identifiers intact. Never introduce a second autosave subscription per page. Flush pending changes before navigating from a project, and do not let delayed work save a newly selected project under the old operation's assumptions.
- The shared session owner is mounted once, but it subscribes only while an editor/follow project session is active. Restore the last project on entry to those routes if no project has been loaded; do not create or save a default draft just because the Library was opened. Keep the subscription continuous across editor-to-follow transitions. On departure to Library, flush the loaded project before unsubscribing, then stop background project writes. Handle save failure visibly rather than silently discarding a pending timer.
- UI preferences are not added to serialized Project schema v1. Theme/reduced-motion can live in a namespaced browser preference; panel query/presence/focus are session data.
- Source settings, current tool and view survive opening/closing export. Keep the canvas mounted with inactive input while export covers it. On geometry change, request one explicit fit when editing resumes.
- Use a narrow selector for each component. Expensive usage/region computation stays memoized and outside pointer animation.
- Global notifications sit above all editor stages and inside a fullscreen target when needed. Do not put a toast portal outside the fullscreen subtree where it becomes invisible.
- Layer scale: canvas 0; ordinary workspace controls 10; auxiliary panel 20; menu/tooltip 30; modal backdrop/dialog 40/41; notifications 50. Portals prevent clipping; no arbitrary escalating z-index values.
- Keep palette HEX and output color constants separate from UI theme tokens. Only screen surroundings/overlays use the new UI palette.

Modules to preserve unless a specific acceptance failure requires a narrowly explained fix: `src/domain/*`, `src/conversion/*`, `src/editor/history.ts`, `src/editor/tools.ts`, `src/editor/selection.ts`, `src/data/palettes*`, `src/render/exporters.ts`, PDF/BOM/document layout modules, project serialization, database schema, and deployment configuration.

## 14. Ordered implementation work packages

Complete these in order. After a package passes its checkpoint, continue without asking for routine confirmation. Do not animate an obsolete screen and then rebuild it.

### Package A: establish the baseline

1. Read this document, current `AGENTS.md`, package scripts, and `git status`.
2. Preserve all current modifications, including the already deleted older planning file. Do not recreate `docs/workbench-redesign-plan.md` from Git.
3. Capture current representative screens and record existing test/build failures separately. Use synthetic project fixtures, not private customer material.
4. Read the five relevant skills from section 12 if available. Check dependencies before adding the two named packages. Do not upgrade the application stack.

Checkpoint: existing application runs locally; feature ledger is understood; baseline issues are recorded; no production changes.

### Package B: visual and interactive foundations

1. Define tokens and theme preference.
2. Implement shared button/icon/field/menu/popover/sheet primitives with all states.
3. Add overlay ordering, keyboard dismissal and focus restoration.
4. Set up GSAP lifecycle and reduced-motion support, but keep feature screens mostly static until rebuilt.

Checkpoint: shared controls work with mouse, keyboard and touch in both themes; menus and form popovers have correct semantics.

### Package C: lifecycle and editor structure

1. Establish the single shared project-session/autosave/restore owner.
2. Move notices above the stage switch.
3. Rebuild header, launchers and bottom drawing dock; remove duplicate old visible controls.
4. Preserve mounted canvas while opening export; implement focus mode and view controls.
5. Verify shortcut routing, painting and save/export gate before proceeding.

Checkpoint: all six tools work; unchanged viewport after panel/export round trips; saves and errors are truthful.

### Package D: auxiliary and contextual interactions

1. Rebuild single-panel host, desktop overlay and mobile sheet.
2. Reorganize image panel without changing conversion behavior.
3. Rebuild colors with the correct whitelist logic and settings subview.
4. Add whole-image transform panel and selection toolbar layout.
5. Confirm every row in the editor portion of the feature ledger is reachable.

Checkpoint: import/convert/undo, palette selection/exclusion/restore, whole/selection transforms, copy/paste and pinning work with no lost settings.

### Package E: supporting screens

1. Rebuild Library gallery and More menus, including search, Trash and recovery.
2. Rebuild BoardPicker into two columns and touch-friendly controls.
3. Rebuild ExportStage preview/configuration split and feedback.
4. Rebuild Follow sidebar/sheet, focus color, progress and actions.

Checkpoint: complete workflow from new project through arrangement, editing, saving, export and follow; all prior management/output options still available.

### Package F: apply the full motion inventory

1. Apply timelines and transitions to the rebuilt shared components.
2. Replace legacy unscoped fades and excessive bounce; do not stack a second animation on the same target.
3. Add interruptible presence and follow recommendation movement.
4. Exercise rapid open/close/switch, route changes during animation, and dynamic reduced-motion changes.

Checkpoint: every inventory item is implemented or explicitly inapplicable; no hidden interactive leftovers, stale callbacks, or drawing delay.

### Package G: final verification and handoff

1. Run appropriate repository checks: `npm run typecheck`, `npm run lint`, `npm run check`, `npm run build`.
2. Existing `npm run check` only covers four grid-loss cases. It is not a comprehensive editor regression suite. Add focused behavior checks for new state/lifecycle logic where necessary; do not write tests that merely assert CSS class names.
3. Perform section 15 acceptance scenarios, responsive/theme/motion screenshots, and an interaction/performance review. Use Lighthouse if the environment supports it; report if unavailable, never invent a score.
4. Inspect the final diff. Remove no files permanently. Do not include secrets, private fixtures, or generated build noise in the handoff.
5. Deliver local preview, changed-file summary, actual check results, remaining limitations, and deployment instructions limited to pointing to the existing deployment workflow. Do not deploy.

Checkpoint: usable local implementation and production build, with evidence rather than a claim of completion based only on compilation.

## 15. Acceptance scenarios

Use a dedicated QA project and known local sample images. Preserve user projects and avoid the permanent-delete path.

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Open editor at 1440x900 and 1280x720 | Single header, centered large canvas, bottom tools, no default auxiliary panel; no overlapping dock/zoom controls |
| A02 | Open/switch/close each auxiliary panel | Correct content, one panel, no recenter/refit, no lost image settings or color query |
| A03 | Rapidly open-close-reopen 10 times | Final state matches last input; no invisible blockers or stale unmount |
| A04 | Try all six tools with mouse and keyboard | Existing distinct semantics; B/E/G/I/V/M preserved; undo/redo reproduce expected grid |
| A05 | Type those letters and Chinese IME text in fields | No tool changes, drawing, selection or accidental hotkeys |
| A06 | Make a rectangle; fill/copy/cut/paste/clear/invert/select-all/cancel | Every action reachable; disabled states and current single-rectangle restriction preserved |
| A07 | Whole-image flip/rotate/translate while a selection exists | Explicit whole action clears selection; selection transforms remain local; non-square rotation explains its limitation |
| A08 | Select colors with pin off/on | Unpinned selection closes and focuses canvas; pinned selection stays; actual active code updates |
| A09 | Exclude one code and filter Available | Excluded code is not available; other allowed codes remain available; counts match whitelist; undo restores supported remapping |
| A10 | Restore one/all colors | Availability restored; UI explains that remapped cells do not automatically revert |
| A11 | Import image, change basic/advanced settings, apply, undo | One conversion per Apply; actual progress/results; existing pattern restored by undo |
| A12 | Reopen with cached source, or fail image decoding | Cache warning or error visible; existing pattern intact; retry possible |
| A13 | Save, draw again, attempt export | Export eligibility closes after edit, remains visible with reason; explicit successful save reopens it |
| A14 | Simulate save/export failure in isolated QA | Persistent visible error; no false saved/downloaded claim; no loss of options; retry works |
| A15 | Pan/zoom, open export, return | Viewport and tool preserved; pattern not fitted again solely due to remount |
| A16 | Select each export family and multiple outputs | Real PNG/PDF/CSV output; multiple files bundled once; estimates, labels and 1:1 print behavior retained |
| A17 | New project and cancel dirty board draft | Existing project not modified by unconfirmed geometry; discard guard works; new-project return goes to Library |
| A18 | Arrange irregular/mixed-compatible boards, drag, keyboard-move and remove | Snapping and overlap checks unchanged; holes respected; incompatible pitch rejected by existing validation |
| A19 | Confirm smaller arrangement covering fewer occupied cells | Actual lost-cell warning before apply; cancel keeps all cells |
| A20 | Library open/rename/duplicate/export/import/Trash/restore | Draft-aware opening; full metadata in copy; corrupt import gives error; recoverable deletion works |
| A21 | Follow: choose color, recommend, mark/unmark region, mark all | Correct highlights/progress; no accidental edit to the pattern; all three strategies accessible |
| A22 | Follow: mark progress, change route, reload, reopen | Progress persisted once through shared lifecycle; no lost completion |
| A23 | Interrupt follow recommendation with pan/zoom/new recommendation | Immediate ownership transfer; no camera snapping back from an old tween |
| A24 | Enter/exit focus and fullscreen | Restore control always reachable; panels/settings/view preserved; fullscreen keeps color access and notices |
| A25 | 1024x768, 768x1024, 390x844, 360x800, 844x390 | No document horizontal overflow; all operations reachable; sheet/footer/close controls visible; no undersized touch tools |
| A26 | Light, dark, system preference and theme change | Consistent chrome and readable controls; pattern HEX, preview and exported artwork unchanged |
| A27 | OS reduced motion and app Reduced, including changing preference while open | No travel/bounce/stagger; states and cleanup still correct; no inaccessible hidden panels |
| A28 | Tab, arrows, Enter, Escape through menus/dialogs/color management | Valid focus order, no escaped modal focus, appropriate focus return, one Escape layer at a time |
| A29 | Nonempty multi-board pattern and a large synthetic pattern | Responsive drawing; no shell rerender per pointer frame; no animation per bead or all swatches |
| A30 | Error boundary/reload/library recovery | Recovery actions preserved; diagnostic output excludes credentials/private source content |
| A31 | Refresh Library and inspect footer/route links | Existing route URLs, title, favicon, attribution and ICP details preserved |

Performance acceptance is measured on the test machine, not promised by a score: pointer input should remain responsive during panel animation; ordinary button feedback should begin within 100 ms; page introduction should finish within 400 ms. Compare production bundles against baseline and investigate new large chunks or warnings. Keep PDF/conversion code out of the library's initial load. Do not preload expensive renderer modules just to animate navigation.

## 16. Ready-to-use prompt for the next coding session

> Implement the existing Pindou application's frontend redesign using `docs/ui-motion-redesign-spec-2026-09-13.md` as the implementation contract. Read it fully before editing, then execute Packages A through G in order. The approved direction is the canvas-centered workspace with a bottom drawing dock, upper-left auxiliary launchers, collapsed-by-default panels, and the fully specified Library, BoardPicker, Export and Follow screens. Use the current working tree, preserve all existing product capabilities and storage/export formats, and use the relevant Taste and GSAP skills according to the document. Do not generate another plan or ask about decisions already specified. Keep Chinese product localization and speak Chinese to me; write code identifiers and engineering documentation in English. Do not permanently delete files or expose private information. Work sequentially, verify the listed acceptance scenarios with synthetic data, and deliver a local preview and production build. Do not deploy or change Tencent Cloud, DNS or the registered domain. If a real environment blocker prevents completion, report the exact blocker and completed work instead of claiming success.

## 17. Definition of done

The implementation is complete when the new layout exists across all five screens/states, every feature-ledger entry has a working reachable control, the motion inventory behaves correctly with interruption and reduced motion, persistence/export invariants hold, and verification evidence is delivered. A skin over the old layout, a static mockup, isolated animated buttons, or a build-only result is incomplete.

This planning session created this document only. Source-code changes, dependency installation, implementation tests, and deployment are intentionally left to the future execution session.
