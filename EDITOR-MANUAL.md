# GHOST//PROCESS Scene Editor — Newcomer Manual

This is the practical guide to the browser editor in `editor.html`. It is for people who want to change scenes without first learning the runtime source code.

The editor can author:

- scene backgrounds, palettes, music, Ink-file references, and inventory visibility;
- sprites and their placement;
- classic rectangular hitboxes;
- items and scene tasks;
- exploration geometry; and
- generic scene overlays made from `container`, `image`, `text`, and `hotspot` elements.

`story.json` is the game's source of truth. The editor changes a copy in the browser and writes the complete file only when you press **Save story.json**.

> **Important:** the editor is powerful but not an undo system. Keep the project under Git, save in small steps, and inspect the diff after larger edits.

---

## Contents

1. [Start the editor](#1-start-the-editor)
2. [Understand the screen](#2-understand-the-screen)
3. [Saving, reloading, and unsaved changes](#3-saving-reloading-and-unsaved-changes)
4. [Choose or create a scene](#4-choose-or-create-a-scene)
5. [Edit scene-wide settings](#5-edit-scene-wide-settings)
6. [Select, move, and resize things](#6-select-move-and-resize-things)
7. [Add and edit sprites](#7-add-and-edit-sprites)
8. [Add and edit classic hitboxes](#8-add-and-edit-classic-hitboxes)
9. [Add and edit items](#9-add-and-edit-items)
10. [Build generic overlays](#10-build-generic-overlays)
11. [Create overlay interactions](#11-create-overlay-interactions)
12. [Use exploration tools](#12-use-exploration-tools)
13. [Preview in the real game](#13-preview-in-the-real-game)
14. [Asset locations](#14-asset-locations)
15. [Security and safe operation](#15-security-and-safe-operation)
16. [Troubleshooting](#16-troubleshooting)
17. [Before you finish](#17-before-you-finish)

---

## 1. Start the editor

From the repository root:

```bash
cd ~/ghost-process-js
npm start
```

If this is a fresh checkout and dependencies have not been installed yet, run `npm install` once before `npm start`.

The normal local addresses are:

- Editor: <http://127.0.0.1:8765/editor.html>
- Game: <http://127.0.0.1:8765/index.html>

Leave the terminal running while you use the editor. Stop the server with **Control-C** in that terminal.

### Recommended safety check

Before editing:

```bash
git status --short
```

This tells you whether the project already has uncommitted work. Do not erase or reset changes you do not recognize.

---

## 2. Understand the screen

The editor has four main areas plus a bottom toolbar.

| Area | What it does |
|---|---|
| **Top bar** | Shows the current scene and save state, and saves or reloads `story.json`. |
| **Left panel** | Lists **Scenes**, **Items**, and the selected scene's **Scene overlay** element tree. |
| **Center canvas** | Shows the selected scene and its editable boxes. |
| **Right inspector** | Always shows scene-wide settings, followed by controls for the selected sprite, hitbox, item, or overlay element. |
| **Bottom toolbar** | Adds classic hitboxes and sprites. Exploration scenes also get walkable-area, grid, blocked-tile, and spawn tools. |

### Top-bar controls

- **Save story.json** writes the browser's current story data to disk.
- **Reload** fetches `story.json` again. If the editor is dirty, it first asks whether to discard unsaved changes.
- The status text reports messages such as `ready`, `loaded`, `unsaved changes`, `saved`, or an error.

### Center viewport controls

- The **Viewport:** selector offers **Phone — 390×844 (mobile)**, **Phone short — 390×600**, **Desktop — 1280×720 (game default)**, **Wide — 1920×1080**, and **Custom…**.
- These choices change only the editor preview size. They do not change a saved game resolution.
- Overlay scenes can also show **Preview view**, which previews one scene-local overlay view without changing the saved runtime initial view.

### Creation controls

- The left panel's **Scene overlay** section contains **Container**, **Image**, **Text**, and **Hotspot** buttons plus the generic element tree.
- The bottom toolbar contains **+ Hitbox** and **+ Sprite**.
- Exploration scenes additionally show **Walkable area**, **Grid**, **Blocked**, and **Spawn**.

On a narrow browser window, use the mobile tabs to switch between **Scenes / Items**, **Canvas**, and **Inspector**.

---

## 3. Saving, reloading, and unsaved changes

### What happens while you edit

Most changes immediately:

1. update the editor's in-memory copy;
2. redraw the canvas or inspector; and
3. change the top status to **Unsaved changes**.

They are **not on disk yet**.

### Save

Press **Save story.json**. A successful save changes the status to **Saved**.

The server validates the whole story and then atomically replaces `story.json`. The save includes all edited scenes, items, sprites, hitboxes, tasks, exploration settings, and overlays—not only the currently selected scene.

The editor does **not** save Ink source files or generate image/audio assets. The **Ink file** field only stores a path to an existing `.ink` file.

### Reload

Pressing **Reload** fetches the last saved `story.json`. If there are unsaved changes, the editor asks **Discard unsaved changes?** Choose **Cancel** to keep editing or **OK** to discard the browser copy and reload from disk.

Closing or navigating away from the page should trigger a browser unsaved-changes warning, but do not treat that warning as a backup system.

### No undo history

There is no multi-step Undo button. Your recovery options are:

- leave the page or press **Reload** before saving, to discard all unsaved changes;
- use `git diff -- story.json` after saving; or
- restore a known version with Git only after confirming that no other wanted changes would be lost.

---

## 4. Choose or create a scene

### Select a scene

Click a scene ID under **SCENES** in the left panel.

The small count at the right of each scene is:

- `c` = character sprites;
- `h` = classic hitboxes.

Generic overlay elements are not included in that count.

### Create a scene

1. Click **+ Scene**.
2. Enter a unique scene ID.
3. Press **OK**.

Use IDs made from lowercase letters, numbers, and underscores, beginning with a letter, for example:

```text
maintenance_tunnel
lab2_entry
terminal_archive
```

A new scene starts as a basic Ink scene with empty character and hitbox lists. Add its background, Ink path, and other settings in the right inspector.

> The editor does not expose every low-level scene field. New scenes default to `kind: "ink"`. Specialized structural changes may still require a careful edit to `story.json`; see `SPEC.md` and `EDITOR-AUTHORING-SPEC.md` before doing that.

### Rename, duplicate, or delete a scene

The current browser editor does not expose scene rename, duplicate, reorder, or delete controls. Those are lower-level `story.json` operations. Ask a project maintainer to make them carefully and update every hitbox, overlay action, task, or other reference to the scene ID.

---

## 5. Edit scene-wide settings

Select the scene in the left panel. Its scene-wide settings always appear at the top of the right inspector, even when a sprite, hitbox, item, or overlay element is also selected.

### Background

**Background (assets/backgrounds/*.png)** lists `.png` files in `assets/backgrounds/`.

- Pick **— none —** for no background.
- The saved value is the filename without `assets/backgrounds/` and without `.png`.
- Files containing `.prompt.` and versioned `_v<number>.png` variants are intentionally hidden from the picker.

**Background fit** controls how the image fills the canvas:

- `cover` fills the canvas and may crop the image edges;
- `contain` shows the entire image and may leave unused space around it.

### Palette

**Palette** lists `.js` and `.json` palettes under `assets/palettes/`. Choose **— none —** to use the normal default behavior.

The center canvas applies the current runtime background processing, so palette/dither changes should be reasonably representative. Final-check them in the real game as well.

### Music

**Music (assets/audio/*)** supports two editor modes:

- **Single track** — choose one file and use **▶ Play** to audition it.
- **Medley (queue)** — add several tracks, reorder them with **↑**/**↓**, preview one track with **▶**, or use **▶ Play queue** and **⏹ Stop**.

For a medley, `fadeAt s` controls when the crossfade **into that row** begins after the previous track has started. Leave it blank for automatic/default timing.

Although the picker may display older `.mid` or `.ogg` files, the current runtime asset policy is **MP3 only**. New runtime music should be placed in `assets/audio/` as MP3.

### Ink file

**Ink file** is a project-relative path such as:

```text
ink/terminal_ui.ink
```

The file must already exist. The editor uses it to populate Ink-knot pickers for hitboxes and overlay actions.

### Inventory HUD

**Inventory HUD** controls whether the runtime inventory interface appears in the scene.

### Tasks

The **Tasks (player-facing hints + auto-completion)** section authors `scene.tasks`.

1. Click **+ Add task**.
2. Give the task a stable ID.
3. Choose a type.
4. Fill in the type-specific field and player-facing hint.

| Task type | Required meaning |
|---|---|
| `pickup` | Complete when the named item is picked up. |
| `use_item` | Complete when the named item is used. |
| `goto_hitbox` | Complete after the player activates a hitbox leading to the named target scene. |
| `goto_dialog` | Complete when Ink reaches the named knot/node. |
| `custom` | Ink or runtime code explicitly calls `complete_task(id)`. |

Use the **×** button on a task row to remove it.

---

## 6. Select, move, and resize things

### Selecting boxes on the canvas

Click a sprite, classic hitbox, or generic overlay box. Its inspector opens on the right.

The selected box receives a yellow outline. This yellow treatment exists only in the editor:

- it is not runtime styling;
- it does not change the asset; and
- the selection itself is not written to `story.json`.

In dense scenes, such as `terminal_ui`, many boxes overlap. Generic overlay elements can always be selected by name in the left panel's **Scene overlay** tree. Existing sprites and classic hitboxes have no separate list in the current editor; select those from the canvas.

### Moving

Drag inside a selected box, away from its resize grip.

### Resizing

Drag the small resize grip at the lower-right corner of the box.

### Numeric coordinates

The right inspector exposes coordinates for precise placement.

For hitboxes and generic overlay elements:

- `x` and `y` are the top-left position;
- `w` and `h` are width and height; and
- the values are fractions, usually from `0` to `1`.

For example, `x: 0.25` means 25% from the left.

Generic children with a **Parent container** use coordinates relative to that parent. Top-level generic elements use coordinates relative to the scene's overlay stage.

### Lock and editor visibility for generic overlays

- **Locked** prevents pointer dragging/resizing. Numeric fields remain available.
- **Visible in editor** hides or reveals the editing handle. It is an authoring aid; it does not hide the element at runtime.

Use **Visible in views** for runtime view visibility.

---

## 7. Add and edit sprites

### Add a sprite

1. Select the destination scene.
2. Click **+ Sprite**.
3. A new sprite entry appears and is selected.
4. Configure it in the right inspector.

The editor creates a unique ID such as `sprite1` and a default frame path like:

```text
assets/sprites/sprite1/<scene_id>/frame_*.png
```

Until matching files exist, the canvas labels the box **(no frames)**.

### Sprite fields

- **Sprite — ID** — the inspector heading shows the stable runtime identifier. The current editor does not provide a sprite-ID rename field.
- **Position slot** — a named placement such as `left`, `center`, or `right`. This is shown only while the sprite uses a named slot.
- **placementX** — continuous horizontal position; `0` is left and `1` is right. Off-canvas values are allowed.
- **placementY** — vertical anchor; `0` is top and `1` is bottom. Off-canvas values are allowed.
- **targetH** — sprite height as a fraction of canvas height.
- **Speaker label** — display/speaker identity used by dialogue behavior.
- **Frames glob** — project-relative frame pattern for this scene.
- **FPS** — preview/runtime animation speed.

Dragging a sprite converts it from a named **Position slot** to continuous `placementX`/`placementY` coordinates.

Use the small play control on a sprite box to preview its animation. Press it again to pause/resume.

Click **Delete sprite** to remove the selected sprite from the current scene, then save.

---

## 8. Add and edit classic hitboxes

Classic hitboxes are the rectangular interaction boxes stored in `scene.hitboxes`. They are separate from generic overlay `hotspot` elements.

### Add a hitbox

1. Select a scene.
2. Click **+ Hitbox**.
3. A default box appears near the center of the canvas.
4. Drag/resize it or edit `x`, `y`, `w`, and `h` numerically.

### Presentation

**Affordance** controls how the player understands the hitbox:

- **Inspect / interactive (eye cursor)** for examining a location or object;
- **Control / button (hand cursor)** for a visible control/button-like action.

This changes presentation, not behavior.

**Label** is the player-facing/accessibility label and the editor box name.

### Behavior

A hitbox can contain these classic behavior fields:

- **Give item**;
- **Go to scene**; and
- **Open Ink knot**.

Prefer one behavior per classic hitbox. If several are populated, the inspector warns you, and the runtime uses this priority:

1. item;
2. target scene;
3. Ink knot.

Missing references are shown as `[missing item]`, `[missing scene]`, or `[missing Ink knot]`. Repair them before saving.

### One-shot versus repeatable

Classic hitboxes are **one-shot by default**. After a successful activation, that hitbox is considered spent and will not activate again during the same play state—even if the player leaves and later revisits the scene.

Enable **Repeatable hitbox** when the interaction must remain available, for example:

- a back or exit control;
- navigation the player may use after revisiting a room;
- a reusable terminal button; or
- an inspection that should be repeatable.

Do not enable it for a one-time pickup unless repeated activation is deliberately safe.

> Generic overlay `hotspot` actions use the overlay action system and are not controlled by this classic **Repeatable hitbox** checkbox.

Click **Delete hitbox** to remove the selected classic hitbox, then save.

---

## 9. Add and edit items

### Add an item

1. Click **+ Item** above the **Items** list.
2. Enter a unique lowercase ID with no spaces.
3. Select the new item in the left panel.

### Item fields

- **Name** — player-facing name.
- **Icon (assets/items/*.png)** — image shown in inventory.
- **Description** — inventory/inspection description.
- **Pickup message** — text shown when acquired.
- **Key item** — marks important/non-ordinary inventory.

Creating an item does not automatically place it in a scene. Give it through a classic hitbox, a generic overlay **Give item** action, or dialogue/runtime logic.

---

## 10. Build generic overlays

Generic overlays are the preferred no-code system for scene-local interfaces, panels, labels, images, Ink output, and clickable controls.

An overlay has:

- a design size;
- optional named views;
- an ordered list of elements; and
- optional parent/child relationships.

The four element types are exactly:

| Type | Use it for |
|---|---|
| `container` | Panels, groups, clipping regions, and Ink content areas. |
| `image` | Icons, diagrams, decorative images, or interface art. |
| `text` | Fixed text or Ink-driven text/choices. |
| `hotspot` | A clickable/tappable interaction region. |

### 10.1 Set the overlay layout

Select the scene in the left panel. In the scene-wide overlay-layout fields:

- **Overlay width** and **Overlay height** define the coordinate aspect ratio.
- **Scene-local views** defines named local UI states.
- **Runtime initial view** is the view active when the scene starts.
- **+ view** creates another named view.

These fields appear after a scene has an overlay configuration. On a plain scene, add the first overlay element with **Container**, **Image**, **Text**, or **Hotspot**; the editor creates the configuration and then exposes the layout fields.

For `bgFit: "contain"` scenes, the overlay stage follows the contained design rectangle. Otherwise it fills the canvas.

### 10.2 Views

Views let one scene show different local interface states without becoming separate game scenes. Example names:

```text
desktop
log
email
map
```

Use the **Preview view** selector in the center viewport toolbar to inspect one view at a time.

For each element:

- **Visible in views** controls where it exists visually at runtime.
- **Active style in views** marks the element active in selected views. At runtime this sets its `data-active` state and, for hotspots, `aria-pressed`.

If every view is checked under **Visible in views**, the editor stores no restriction and the element appears in all views.

Renaming a view updates editor-managed references. A view cannot be deleted while elements, actions, or the initial-view setting still reference it.

### 10.3 Add an element

In the left panel's **Scene overlay** section, click one of:

- **Container**
- **Image**
- **Text**
- **Hotspot**

The new element is added with a generated ID such as `container_1` or `hotspot_8` and selected immediately.

The current inspector shows an element's ID in its heading but does **not** provide an ID-renaming control. Treat the generated ID as stable while working in the editor. If a project maintainer later renames it directly in `story.json`, every parent and other reference to that ID must be updated too.

The displayed **Type** field is informational in the current inspector. To change element type, delete the incorrect element and add the correct one.

New `image` elements start with a placeholder terminal-background asset. Replace **Asset path** immediately with the intended project image.

### 10.4 Select and order elements

Use the **Scene overlay** tree in the left panel.

- Click a row to select it.
- **↑** and **↓** change list order. Later elements generally paint above earlier siblings.
- **Duplicate** in the right inspector copies the selected element and offsets it slightly.
- **Delete** deletes an element.

Deleting a container also deletes all of its descendants after a confirmation prompt.

Repeatedly duplicating the same source can produce the same `_copy` ID more than once. If saving reports a duplicate overlay ID, delete the extra copy or have a maintainer give it a unique ID in `story.json`.

### 10.5 Parent containers

Use **Parent container** to nest an element inside a `container`.

Parenting is useful because:

- child geometry becomes relative to the parent;
- moving the parent moves the whole group; and
- a parent with **Clip children** can hide child content outside its bounds.

The picker prevents an element from choosing itself as its parent. The server validates the complete hierarchy—including indirect cycles, missing parents, and non-container parents—when saving.

### 10.6 Containers

A `container` can contain:

- **Clip children**; and
- optional Ink-driven content.

Existing containers can also carry background, border, padding, opacity, and bevel values in `story.json`. The center preview renders those values, but the current inspector does not provide controls for editing them. For style changes, use the technical workflow in `EDITOR-AUTHORING-SPEC.md` or ask a project maintainer.

Containers are useful as groups: parent related elements to them so they move and scale together.

### 10.7 Images

For an `image`, enter **Asset path** as a project-relative path under `assets/`, for example:

```text
assets/icons/isometric/map.png
```

The current inspector does not provide an image-file picker, so type or paste the path carefully. The runtime data model also supports fit, pixelation, and alt-text settings, but those settings are not currently editable in the browser inspector. See `EDITOR-AUTHORING-SPEC.md` if they must change.

Always point to an existing project asset. The server rejects generic image paths that do not begin with `assets/`.

### 10.8 Text and Ink content

A `text` element can use:

- **Literal text** — fixed authored text;
- **Ink lines** — current output lines from the scene's Ink story; or
- **Ink choices** — the current Ink choices rendered as controls.

A `container` can host **Ink lines** or **Ink choices** directly. For fixed literal copy, use a child `text` element; current runtime containers do not render literal container text.

**Ink lines** supports tag-to-style mappings. Available presets are:

- `default`
- `heading`
- `warning`
- `success`
- `dim`
- `divider`

The tag name must match the tag emitted by Ink. For example, an Ink line tagged `# warn` can map `warn` to the `warning` preset.

**Ink choices** supports `default` or `terminal-command` controls and can run **After choice** actions.

### 10.9 Styling limits in the current editor

Existing overlay styles are rendered in the center preview, but the current right inspector does not expose general style fields. Backgrounds, borders, padding, opacity, typography, overflow, cursor, and bevel remain part of the `story.json` data model rather than the newcomer UI.

For a style-only change, first check `EDITOR-AUTHORING-SPEC.md` and preserve the existing element structure. Font measurements that scale with the overlay design size commonly use values such as:

```css
calc(var(--overlay-scale) * 17px)
```

After any style change, check the relevant phone, desktop, wide, and custom viewport sizes so text does not clip or overflow.

---

## 11. Create overlay interactions

A generic `hotspot` is an interaction region. It renders as a real accessible button at runtime.

### Hotspot fields

- **Accessible label** — player meaning for assistive technology; do not leave the default `Activate` on finished work.
- **Presentation**:
  - `inspect` shows an inspect/help affordance;
  - `control` behaves visually like a control;
  - `invisible` has no hover treatment but remains interactive.
- **Activate actions** — ordered actions that run when clicked/tapped.

### Available actions

| Action | Result |
|---|---|
| **Go to scene** | Enters another story scene. |
| **Give item** | Adds an existing item to inventory. |
| **Open Ink knot** | Opens/runs a knot from the current scene's Ink file. |
| **Set local view** | Changes the active overlay view without leaving the scene. |

Click **+ action** to add an action. Use **×** to remove one.

Actions run from top to bottom. For a control that changes a terminal page and opens its Ink content, a common order is:

1. **Set local view**;
2. **Open Ink knot**.

For a control that leaves the scene, keep **Go to scene** last so earlier local work is not obscured by navigation.

Reference pickers are populated from existing scenes, items, views, and Ink knots. A `[missing ...]` option means the saved reference no longer exists.

### Example: reusable Exit control

1. Add a `hotspot` over the visible Exit art.
2. Set **Accessible label** to `Leave terminal`.
3. Set **Presentation** to `control`.
4. Under **Activate actions**, add **Go to scene**.
5. Choose the destination scene.
6. Save and test in the real game.

### Example: local terminal page

1. Add a view named `log` under **Scene-local views**.
2. Mark the log-page content **Visible in views → log**.
3. Add a `hotspot` over the LOG icon.
4. Add **Set local view → log**.
5. Optionally add **Open Ink knot → log** after it.
6. Switch the editor's preview view to `log` and inspect the result.

---

## 12. Use exploration tools

These controls appear only when the selected scene has `kind: "exploration"`.

Each button is a toggle. Click the active button again to return to normal selection.

### + Area

Shows the cyan walkable polygon. Drag its numbered corner handles to shape the floor area in which the character can move.

### + Grid

Shows the movement grid.

- Drag the green origin handle to reposition the grid pivot.
- Drag the orange rotation handle to align the grid with scene perspective.

### + Blocked

Click a grid tile to toggle it blocked/unblocked. Drag across several tiles to paint a stroke. Blocked tiles appear as red squares.

### + Spawn

Drag the orange spawn marker to set the character's starting location.

### Exploration checking

- Keep the spawn marker inside the walkable polygon.
- Do not place the character on a blocked tile; the editor highlights a sprite that overlaps one.
- Align the grid with the floor perspective.
- Test actual movement and collision in the runtime after saving.

---

## 13. Preview in the real game

The center canvas is an authoring preview, not a complete game simulation. It does not prove that scene transitions, inventory, Ink progression, repeatability, or responsive layout work in play.

### Open a specific scene

After saving, use:

```text
http://127.0.0.1:8765/index.html?scene=SCENE_ID
```

For example:

```text
http://127.0.0.1:8765/index.html?scene=terminal_ui
```

Reload the runtime tab after each saved editor change.

### What to test

For an ordinary scene:

- background and palette;
- sprite position and animation;
- dialogue and Ink knot behavior;
- hitbox cursor/label/action;
- inventory behavior; and
- leaving and revisiting the scene.

For an overlay scene:

- every hotspot with mouse and keyboard;
- every view transition;
- Ink lines and choices;
- item/scene references;
- text clipping at relevant phone, desktop, wide, and custom sizes; and
- nested/clipped elements.

For a classic hitbox intended for navigation, activate it, revisit the source scene, and activate it again. If it must work twice, confirm **Repeatable hitbox** is enabled.

---

## 14. Asset locations

The editor lists assets from these project folders:

| Asset | Folder | Typical saved reference |
|---|---|---|
| Background | `assets/backgrounds/` | background basename, without `.png` |
| Palette | `assets/palettes/` | palette basename |
| Music | `assets/audio/` | filename such as `scene_theme.mp3` |
| Item icon | `assets/items/` | `assets/items/key.png` |
| Sprite frames | `assets/sprites/` | a glob such as `assets/sprites/nyx/alley/frame_*.png` |
| Generic image | anywhere under `assets/` | `assets/icons/isometric/map.png` |
| Ink | `ink/` | `ink/terminal_ui.ink` |

If a newly added file is not in a picker:

1. check its folder and extension;
2. make sure the editor server is still running;
3. reload the editor page; and
4. confirm the filename is not an intentionally hidden background variant/sidecar.

Image generation for this project must go through `tools/gen_asset.py`; do not create untracked ad-hoc generations without provenance.

---

## 15. Security and safe operation

The scene editor writes `story.json`. The same development server also exposes protected API routes for Ink writes and asset uploads, even though the current scene-editor page does not present those as ordinary newcomer controls. Treat the server as a local development tool, not a public website.

By default, `npm start` binds to `127.0.0.1`, so only the same computer can reach it. Keep that default unless remote access is deliberate and secured.

For non-loopback binding, the server refuses to start unless `EDITOR_TOKEN` is a non-whitespace secret of at least 16 characters. Write requests also require a matching request origin, and the editor may ask for the token after an authorization failure.

Even with those checks:

- do not expose the editor to the public internet;
- do not paste tokens into screenshots, documentation, commits, or chat;
- do not leave an externally bound editor running unattended; and
- prefer a local browser on the development machine.

The editor performs an atomic `story.json` replacement, but it does not create a versioned backup for every save. Git is still the history and review mechanism.

---

## 16. Troubleshooting

### The page does not open

- Confirm `npm start` is still running.
- Look for `Editor server: http://127.0.0.1:8765` in the terminal.
- If port 8765 is already occupied, stop the old project server before starting another copy.

### Save says `ERROR`

Read the full status text. Common causes include:

- a scene ID that is not lowercase/underscore format;
- a missing target scene, item, overlay view, parent, or Ink knot;
- duplicate overlay element IDs;
- overlay coordinates outside `0`–`1`;
- zero-width/zero-height overlay elements;
- an image path outside `assets/`; or
- a broken parent hierarchy.

Fix the named field and save again. The invalid story is not written when validation fails.

### The editor says `SAVE ERROR 401`

The server requires an editor token. Enter the token only if you intentionally started a secured non-loopback server and know its configuration. Otherwise stop that server and restart normally with `npm start` on loopback.

### A box is hard to select

- For a generic element, select its row in the left **Scene overlay** tree.
- Choose the correct **Preview view** when the scene has local overlay views.
- Temporarily lock or hide neighboring generic overlay handles.
- Existing sprites and classic hitboxes can only be selected from the canvas in the current editor; once selected, use numeric inspector fields for fine placement.

### I cannot drag an overlay element

Check **Locked** in the inspector. A locked overlay ignores pointer movement. Also confirm it is visible in the currently previewed view.

### An overlay exists in the editor but not at runtime

Check:

- **Visible in views** includes the active runtime view;
- its parent is visible in that view;
- the image path exists;
- the element has nonzero `w` and `h`;
- a clipping parent is not cutting it off; and
- the runtime page was reloaded after saving.

Remember: **Visible in editor** controls the editor handle, not runtime visibility.

### A hotspot does nothing

- Give it at least one **Activate actions** action.
- Check for `[missing ...]` in the action picker.
- Confirm its width and height cover the intended clickable area.
- Confirm a later overlay is not intercepting the pointer.
- Test in the runtime, not only the authoring canvas.

### A classic hitbox worked once and then stopped

That is the default one-shot behavior. Enable **Repeatable hitbox** if the interaction must work after revisiting or repeated use.

### Ink knots do not appear in a picker

- Set a valid **Ink file** on the scene.
- Confirm the file exists under `ink/`.
- Use standard knot declarations such as `=== knot_name ===`.
- Reload the editor after external Ink edits if the picker remains stale.

### Music appears in the editor but not in the game

- Use an MP3 in `assets/audio/`.
- Check browser autoplay restrictions by interacting with the page first.
- Verify the selected filename and reload the runtime after saving.
- For a medley, check row order and whether `fadeAt` is on the destination row you intended.

### Sprite says `(no frames)`

The **Frames glob** did not resolve any image files. Check the path, scene folder, filename pattern, and extension.

### I saved the wrong change

1. Stop editing.
2. Run `git diff -- story.json`.
3. Identify the exact unwanted section.
4. Revert only that section or ask someone familiar with the current uncommitted work.

Do not blindly reset the whole repository; unrelated work may be present.

---

## 17. Before you finish

Use this checklist:

- [ ] The top status says **Saved**, not **Unsaved changes**.
- [ ] New scene and item IDs are stable and descriptive; overlay IDs are unique.
- [ ] No picker shows `[missing ...]`.
- [ ] Navigation hitboxes that must work again have **Repeatable hitbox** enabled.
- [ ] Overlay elements were checked in every preview view.
- [ ] The scene was tested at the relevant phone, desktop, wide, and custom viewport sizes.
- [ ] The saved scene was tested through `index.html?scene=...`.
- [ ] Runtime hotspots, Ink, items, music, and navigation were exercised.
- [ ] `git diff -- story.json` contains only intentional changes.

For the precise data model and implementation contract, read:

- `EDITOR-AUTHORING-SPEC.md`
- `SPEC.md`
- `AGENTS.md`
