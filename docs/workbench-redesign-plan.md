# Workflow-First Workbench Redesign

Date: 2026-09-13
Status: Implemented 2026-09-13 (see §11). Original proposal kept below for reference.
Scope: Simplify the editor interface without substantially removing functionality.

## 11. Implementation status (2026-09-13)

Done:

- Single-row editor header: menu / project name / stage / save status / primary action. App-level nav hidden on the editor route.
- Narrow left tool rail: 6 drawing tools, active color (opens color panel), undo/redo. No permanent side panels; the canvas keeps its full width (1366-wide viewport → 95.9% canvas region, measured).
- Temporary overlay panels (`PanelHost`): one at a time, color or image. Opening/closing never resizes the canvas, so zoom and position survive.
- Save gate: `savedCommitVersion` opens export only after an explicit save (or after opening an already-saved project). Autosave writes to disk but does not advance the workflow; any later edit closes the gate again. `npm run check` plus a headless run verified both directions.
- Export destination (`ExportStage`): replaces the canvas, shows a rendered preview, presents the four purposes first and reveals options per purpose, keeps estimates/warnings next to the download button.
- Board picker: dev stress-test entries removed, right sidebar reduced to a compact summary with details behind a disclosure, cancel returns to the library for a new project, and applying a layout that would drop cells asks for confirmation.
- Selection bar appears only with a selection; cut/paste/invert/select-all/move live under 更多. Whole-image operations moved to the Image menu with explicit 整图 labels.
- Color panel: used-colors-first on a non-empty design, active color block at the top, compact swatch grid, palette/exclusion/disclaimer behind 色彩库设置. Choosing a color closes the panel unless it is pinned.
- Removed: duplicate name field, header zoom slider, always-visible convert/export panels, statistics (cell counts, undo memory), instruction paragraphs.

Deliberately not done:

- Trackpad two-finger pan (§7) — separating a trackpad scroll from a mouse wheel is a heuristic and the section itself requires hardware verification. Current behaviour (wheel = zoom) is unchanged.
- Merging single-click and drag colouring into one tool (§6) — the proposal asked to verify existing behaviour first; both tools still exist.
- Preview-before-apply for image conversion (§3.2) — marked as a proposal, not a claim about current behaviour.

## 1. Goal

Make the bead canvas the primary workspace, particularly on laptops. Show tools when their workflow stage or current action requires them, rather than displaying every available function at once.

Primary workflow:

**Choose boards → Edit → Save → Export**

Saving is an action, not a separate form page. Existing projects can resume editing without repeating board selection. Image import is optional.

## 2. Current Interface Problems

The proposal is grounded in the existing interface components:

- `src/pages/Editor.tsx`: both 256px sidebars remain visible during board selection, although interactions are blocked. Conversion, colors, export, and selection controls share the editing screen.
- `src/pages/BoardPicker.tsx`: board selection adds its own sidebars inside that already constrained workspace.
- `src/components/Toolbar.tsx`: project metadata, board specifications, drawing tools, saving, and zoom controls compete for the same toolbar.
- `src/components/ExportPanel.tsx`: export settings are permanently visible, and the project name is editable again here.
- `src/components/SelPanel.tsx`: selection controls remain visible without a selection; statistics and technical details occupy permanent space.

Board specifications, names, and zoom information should each have one primary home. Future-stage tools should be absent, not merely disabled or folded into a large permanent sidebar.

## 3. Workflow

### 3.1 Choose Boards

Purpose: establish the physical board layout.

Show:

- Board models and a large layout preview.
- Add, move, and remove board actions.
- One compact board-count and size summary; detailed specifications are available on demand.
- One primary action: **Start editing**.

Rules:

- Do not show drawing, color, image conversion, or export tools.
- A valid, nonempty layout must be explicitly confirmed before editing a new project.
- Without a valid layout, disable the primary action and explain that a board must be added.
- Canceling initial board selection returns to the project library; it must not bypass confirmation.
- After confirmation, remove board specifications from the main editing interface.
- Later layout changes are available through **Project menu → Adjust boards**.
- Warn and request confirmation before applying a layout change that would discard existing cells.

### 3.2 Edit

After board confirmation, show the canvas. An empty canvas offers:

**Import image** or **Draw directly**.

This is not an additional mandatory wizard page. Selecting a drawing tool can begin editing immediately.

#### Optional image preparation

Import opens a temporary image-processing panel with the source and conversion preview.

Default controls:

- Color limit.
- Background removal.
- Image fitting mode.
- Apply to canvas.

Collapsed under **More adjustments**:

- Conversion strategy.
- Dithering and strength.
- Crop to subject.
- Existing-content replacement settings.

Explain dithering plainly: using small dots of different colors to simulate a gradient.

Applying the result closes the image-processing panel and returns to drawing. Reopening conversion must remain possible. Warn before replacing manual edits, and make applied conversions undoable.

Preview-before-apply is a proposed interaction, not a claim that the current implementation already supports it.

### 3.3 Save

Saving should not introduce another full-screen form.

While editing, the primary top-right action is **Save project**.

Rules:

- Preserve background autosaving to protect against accidental loss.
- Autosaving does not mean the user has finished editing and must not advance the workflow or automatically expose export controls.
- An explicit save must succeed for the current content before **Next: Export** appears.
- Further project edits hide that entry and restore **Save project** as the primary action.
- Saving failures keep the user in editing, show the cause, and offer a retry.
- Export eligibility must describe the current saved content, not merely the existence of a previous save timestamp.
- Loading an existing project must not force board selection again. Export availability must be based on a verified saved state; a newer draft is not automatically a completed save checkpoint.

The current application saves locally in the browser, not to a cloud account. User-facing save messaging must make that distinction clear.

### 3.4 Export

Export becomes a separate destination, entered deliberately after a successful save.

Replace the editing canvas with an output preview. Only here show export settings.

Present choices by purpose first:

| Purpose | Output |
| --- | --- |
| Share the finished appearance | Preview image |
| Follow the pattern on screen | Screen pattern |
| Print the pattern | Printable pattern |
| Prepare materials | Bead quantity list |

After a purpose is selected, reveal its relevant resolution, color-code, pagination, and related options. Preserve multi-output selection and bundled downloads.

Keep relevant output estimates and warnings visible before downloading. Do not make users understand every file format before choosing a purpose.

Provide **Return to editing**. Returning restores the previous canvas position and zoom.

Preserve the existing guided bead-making mode through saved-project actions and the project library. It is not a mandatory stage of creating a design.

## 4. Editing Layout

Default state:

```text
+----------------------------------------------------------------+
| Menu  Project name v       Edit       Save status  [Save project] |
+------+---------------------------------------------------------+
| Draw |                                                         |
| Erase|                                                         |
| Fill |                                                         |
| Pick |                                                         |
|Select|                     LARGE CANVAS                        |
|------|                                                         |
|Color |                                                         |
|------|                                                         |
| Undo |                                                         |
| Redo |                            [- Scale +] [Fit whole view]  |
+------+---------------------------------------------------------+
```

### Region Responsibilities

| Region | Contains | Does not contain |
| --- | --- | --- |
| Single-row header | Project name, current stage, save status, primary action | Board dimensions, permanent customer form, long zoom slider |
| Narrow left tool rail | Frequent drawing tools, active color, undo/redo | Full color catalog, import parameters, project directory |
| Main canvas | Drawing, selection, movement, zoom | Permanent explanatory paragraphs and statistics |
| Temporary panel | The deliberately opened color or image controls | Multiple unrelated tool groups at once |
| Project menu | Rename, customer information, board details, adjust boards | Forms that remain expanded throughout editing |

Borrow the structural simplicity of desktop clients: collapsible navigation, a dominant content area, and details shown on demand. Do not add another permanent folder sidebar.

Open the project library from the upper-left navigation and close it when returning to work. Do not introduce a new folder-management system in this redesign.

### Panel Rules

1. No expanded side panel by default.
2. Open at most one main temporary panel at a time.
3. Choosing a color closes the color panel by default; allow pinning for repeated color work.
4. On narrow laptop windows, use a temporary overlay rather than continually shrinking the canvas.
5. Opening or closing panels must not reset zoom or push the user's editing target out of view.

The right side has no permanent panel during editing.

## 5. Color Interaction

Separate choosing a color from managing the color library.

- Clicking the active color opens the color panel.
- With a nonempty design, initially show used colors. On an empty design, show all colors.
- Keep color-code search and a compact swatch grid with internal scrolling.
- Clearly show the active color code. Make quantity details available on hover or click instead of turning every swatch into a statistics card.
- Move palette/brand selection, excluded-color management, and restoring colors into **Color library settings**.
- Place palette attribution and trademark information in color-library information, keeping it accessible without occupying the drawing surface.

Do not remove palette choice, used/all filtering, color exclusion, restoration, or search.

## 6. Selection and Image Operations

Only show selection actions when a selection exists.

Use a short contextual bar at the canvas edge:

**Fill | Copy | Clear | Transform v | More v**

It disappears when the selection is cleared. Preserve cut, paste, invert selection, and related actions through menus and keyboard shortcuts.

Whole-image operations have a separate **Image** menu. Use explicit labels such as **Rotate whole image** and **Move whole image** so their scope is not confused with selection-only operations. Preserve existing restrictions, such as square-region requirements where applicable, with relevant explanations when the action is used.

Proposed duplication reduction: combine single-cell coloring and continuous drag coloring into one drawing tool, preserving both input behaviors. Verify the existing tool behavior before implementing the consolidation.

## 7. Canvas Navigation and Precision

| Interaction | Expected behavior |
| --- | --- |
| Zoom at a pointed-to cell | Keep that cell as the zoom anchor |
| Two-finger trackpad scroll | Move the canvas |
| Trackpad pinch | Zoom the canvas |
| Mouse wheel over the canvas | Preserve mouse-wheel zoom |
| Hold Space and drag | Temporarily pan; release to resume the drawing tool |
| Fit whole view | Recover the full design in one click |
| Precision editing | Highlight the active cell, show codes when legible, retain arrow-key cell navigation |

Ordinary scrolling inside a panel scrolls that panel, not the canvas. Navigation changes are proposed behavior and must be checked on actual mouse and trackpad hardware.

Keep zoom controls in one compact canvas-edge location. Do not duplicate them in the header.

Do not obtain more space by shrinking controls into tiny targets. Remove irrelevant content, not usable click areas. Keep accessible labels, visible focus, and keyboard operation.

## 8. What Moves or Disappears

Remove from the default editing surface:

- Repeated board counts, grid dimensions, and physical sizes.
- Duplicate project-name fields and zoom controls.
- Always-visible conversion and export settings.
- Inactive selection controls, permanent instruction paragraphs, and developer-facing statistics such as undo memory use.
- Developer stress-test entries from the customer-facing board-selection experience.

Preserve their legitimate user-facing capabilities in the appropriate stage or menu. Relevant warnings, error messages, and data-loss protections must remain visible when they matter.

No broad feature removal, conversion-engine rewrite, new folder system, or speculative management interface is proposed.

## 9. Acceptance Criteria

1. **Clean board selection:** before explicit layout confirmation, no color, conversion, or export tools are visible, and editing cannot bypass board selection.
2. **Canvas space:** at a 1366 x 768 application viewport, the default editing canvas region occupies at least 90% of the work area's width; the header remains one row. This measures the canvas region, not whether a particular board aspect ratio fills it.
3. **Focused interaction:** opening the color panel and choosing an immediately visible color takes at most two clicks. Closing a panel does not require finding the editing target again.
4. **Correct save gate:** autosaving does not advance the workflow. Failed explicit saves and edits made after a successful save prevent direct export of unsaved current content.
5. **Capabilities retained:** conversion, color-library management, selections, whole-image transformations, multi-format export, the project library, and guided bead-making remain reachable. Only duplicate entrances, duplicate information, and developer-facing display clutter are removed from the primary interface.

## 10. Next Decision

Review the editing layout first: **large canvas + narrow tool rail + temporary panels**.

After layout approval, create a visual mockup for review before changing application behavior or production code.
