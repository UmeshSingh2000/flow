# Flow

An offline-first visual project documentation app. Flow lets you describe a software
project as a graph of nodes — project → modules → features → sub-features — with
documentation on each node and explicit relationships that can cross branches.

This repository is the **first working prototype** of the web MVP described in
[`flow-project-requirements.md`](./flow-project-requirements.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle
npm run preview    # serve the production build
```

## VS Code extension

Package and install the existing editor as a VS Code extension with one command:

```bash
npm run package
```

The command builds the webview assets, creates `flow-<version>.vsix`, and runs
`code --install-extension ... --force`. If your VS Code executable is not named
`code`, set `VSCODE_EXECUTABLE` before running the command.

After installation, run **Flow: Open** from the VS Code Command Palette. The web
application is built and served from separate extension files, so `npm run dev`,
`npm run build`, and `npm run preview` continue to run normally.

Flow starts empty. Create a project (or import a backup) to start mapping.

## What works

| Area | Implemented |
|---|---|
| Projects | Create, rename (with description), switch, delete with confirmation; each project has a protected root node |
| Nodes | Create at root or as a child, edit title/type/description, drag on canvas, duplicate, delete from the card (hover/selection) or the properties panel with descendant-aware confirmation |
| Hierarchy | Parent–child nesting to any depth, tree with expand/collapse, re-parent via the properties panel, self/descendant cycle prevention |
| Node documentation | Eight structured fields (purpose, inputs, outputs, preconditions, behavior, success/failure result, notes) plus description; a dot on the card marks nodes with docs |
| Markdown | Per-node Markdown with a rendered preview in the properties panel and a full-screen editor that rises from the bottom; a Write/Preview toggle switches between the editor and the sanitized render, and Escape closes it |
| Images | Attach up to six images per node by picking files in the panel or dropping them on the canvas — onto a node to attach there, onto empty space to create a node named after the file; node cards show a thumbnail, clicking one opens a full-screen lightbox |
| Connections | Drag a handle to connect any two nodes, including across branches; release a connector on empty canvas to pick a node type, creating a connected node at that spot; optional label and relationship type; disconnect by hovering the line for its × button, from the node's *Connected nodes* list, or by selecting the edge and deleting it; duplicate and self connections are rejected |
| Canvas | Pan, zoom, fit-to-view, minimap, dotted grid, click to select, tree selection locates and centres the node |
| Search | Filters the project tree by title/description while keeping matching ancestors |
| Layout | Left sidebar collapses from the brand header and reopens from an edge button; the properties panel appears only while something is selected, so the canvas reclaims both areas |
| Persistence | Autosave (400 ms debounce) to IndexedDB, save-state indicator, security-net in-memory fallback with a visible warning |
| Portability | Versioned JSON backup export (single project or whole workspace) and validated import that never overwrites an existing project |
| Offline | No network requests after load; all editing works disconnected |
| Guided tour | A blocking first-run tour that walks a new user from creating a project through nodes, nesting, documentation, Markdown, connections, canvas navigation and backups; restartable from the sidebar |

Keyboard: `Delete`/`Backspace` deletes the selected connection, or asks to confirm
deletion of the selected node; `Escape` clears selection and closes dialogs.

### Guided tour

New users get a blocking tour the first time the workspace is empty. It is built from
three small pieces:

- `src/guide/steps.ts` — pure step data (title, text, tips, `data-guide` targets and the
  action each step requires). Helpers such as `projectMaxDepth` and `nodesSignature`
  read a plain `Project`, so the tour logic is testable without a browser.
- `src/state/guideStore.ts` — the step machine: `start`, `next`, `finish`, and
  `evaluate`, which advances a step once its requirement is met. It also decides when to
  auto-start and remembers completion in `localStorage`.
- `src/ui/Guide.tsx` — the overlay: four blockers leave a hole over the highlighted
  control, so the guided action is the only thing that can be clicked while the tour
  runs. Keyboard shortcuts are suspended too, except inside the dialogs the tour itself
  opens. Explanatory steps use a Next button; action steps advance by themselves.

Steps are: welcome → create project → add node → nest a child → document the node →
write Markdown → connect two nodes → move around the canvas → backups → done.
`Skip tour` exits at any point.

The tour auto-starts only when the workspace is empty and it has never been finished.
It can be started at any time from **Settings** in the bottom-left of the sidebar, which
shows whether the tour was completed and offers *Start*/*Replay the tour*. Settings also
holds backup import and workspace export.

## Architecture

```
src/
  core/            framework-independent domain (no React, DOM, or storage)
    types.ts       node/connection/project model
    graph.ts       pure operations: add, move, re-parent, connect, delete, duplicate
    validation.ts  backup parsing, schema versioning, reference + cycle checks
    id.ts          stable id generation
  storage/         the persistence boundary (FR-DATA-09 / ARCH-02)
    repository.ts  StorageAdapter interface
    indexeddb.ts   browser implementation
    memory.ts      visible fallback when IndexedDB is unavailable
  state/
    store.ts       zustand store: state, actions, debounced autosave
  ui/              React components + React Flow canvas
```

Data flows one way: UI → store → pure core functions → `StorageAdapter`. No component
writes to storage directly, and `core/` can be reused by a future VS Code webview.

### Persistence and backups

Projects are stored whole in IndexedDB (`flow-workspace` database, `projects` and
`meta` stores). Saves are debounced by 400 ms, flushed when the tab is hidden or
closed, and surfaced as *Saving… / Saved on this device / Save failed*.

Backups are JSON so they are portable between the web app and any future host:

```json
{
  "format": "flow-backup",
  "version": 2,
  "exportedAt": "2026-11-21T08:00:00.000Z",
  "projects": [
    {
      "id": "p_…",
      "name": "Example project",
      "description": "An example of a project map",
      "createdAt": "…",
      "updatedAt": "…",
      "nodes": [
        {
          "id": "n_…",
          "projectId": "p_…",
          "parentId": null,
          "type": "project",
          "title": "Example project",
          "description": "A project root node",
          "markdown": "# Overview\n\nFree-form **Markdown** documentation.",
          "details": { "purpose": "", "inputs": "", "outputs": "", "preconditions": "", "behavior": "", "successResult": "", "failureResult": "", "notes": "" },
          "position": { "x": 0, "y": 330 },
          "createdAt": "…",
          "updatedAt": "…"
        }
      ],
      "connections": [
        { "id": "c_…", "projectId": "p_…", "source": "n_…", "target": "n_…", "type": "leads-to", "label": "autosaves", "createdAt": "…", "updatedAt": "…" }
      ]
    }
  ]
}
```

Schema version 2 added the optional node `markdown` field and version 3 the node
`images` array. Older backups still import: missing fields are normalized (empty
string / empty array) rather than rejected, and projects loaded from an older
IndexedDB database are upgraded the same way on load.

Images are stored inline as `data:image/...` URLs so they travel with a backup. To
keep that affordable they are downscaled to a 1400px longest edge and re-encoded as
WebP (JPEG fallback) on intake; small animated GIFs pass through untouched, source
files over 12 MB are refused, and imports reject payloads above ~3 MB per image.

Import rejects invalid JSON, unknown formats, future schema versions, missing nodes,
broken parent references, hierarchy cycles, duplicate ids, self-connections, and
duplicate edges, listing the problems instead of partially applying the file. A
project whose id already exists is imported under a fresh identity
(`… (imported)`) rather than overwriting local work.

## Deliberate deviations from the v1.0 spec

- **Storage is IndexedDB, not SQLite-WASM + OPFS (FR-DATA-02).** This is the one MVP
  MUST not met. The `StorageAdapter` interface exists precisely so a SQLite adapter
  can be dropped in without touching `core/`, `state/`, or the UI; see “Next steps”.
  Export is versioned JSON rather than a `.sqlite` file.
- **No service worker/PWA manifest (FR-OFF-04, SHOULD).** The app makes no network
  calls and keeps working after it has loaded, but the shell is not precached for a
  cold offline start.
- **No canvas-level descendant collapse (FR-CAN-09, SHOULD).** Branches collapse in
  the project tree only.
- **Desktop-first.** Below 980 px the properties panel is hidden (FR-UI-05 SHOULD).
- Custom node types, Markdown descriptions, and workspace-level merging remain the
  open product decisions listed in §16 of the requirements.

## Next steps

1. Add `storage/sqlite.ts` (SQLite WASM + OPFS SAHPool) implementing `StorageAdapter`,
   with the IndexedDB adapter retained as the fallback for unsupported browsers, plus
   schema versioning/migrations inside the adapter.
2. Precache the app shell with a service worker and add a web app manifest.
3. Collapse/expand descendants on the canvas; optional per-branch focus mode.
4. Unit-test the pure core (`graph.ts`, `validation.ts`) — cycle detection, cascade
   deletion, connect rules, and backup round-trips.
5. Extract `core/` into a workspace package and host the editor in a VS Code webview.
