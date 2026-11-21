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

On first launch Flow seeds a demo project (“Product architecture”) so the canvas is
not empty. To start from scratch, delete the project from the project menu.

## What works

| Area | Implemented |
|---|---|
| Projects | Create, rename (with description), switch, delete with confirmation; each project has a protected root node |
| Nodes | Create at root or as a child, edit title/type/description, drag on canvas, duplicate, delete with descendant-aware confirmation |
| Hierarchy | Parent–child nesting to any depth, tree with expand/collapse, re-parent via the properties panel, self/descendant cycle prevention |
| Node documentation | Eight structured fields (purpose, inputs, outputs, preconditions, behavior, success/failure result, notes) plus description; a dot on the card marks nodes with docs |
| Connections | Drag a handle to connect any two nodes, including across branches; optional label and relationship type; select + delete; duplicate and self connections are rejected |
| Canvas | Pan, zoom, fit-to-view, minimap, dotted grid, click to select, tree selection locates and centres the node |
| Search | Filters the project tree by title/description while keeping matching ancestors |
| Persistence | Autosave (400 ms debounce) to IndexedDB, save-state indicator, security-net in-memory fallback with a visible warning |
| Portability | Versioned JSON backup export (single project or whole workspace) and validated import that never overwrites an existing project |
| Offline | No network requests after load; all editing works disconnected |

Keyboard: `Delete`/`Backspace` deletes the selected connection, or asks to confirm
deletion of the selected node; `Escape` clears selection and closes dialogs.

## Architecture

```
src/
  core/            framework-independent domain (no React, DOM, or storage)
    types.ts       node/connection/project model
    graph.ts       pure operations: add, move, re-parent, connect, delete, duplicate
    validation.ts  backup parsing, schema versioning, reference + cycle checks
    seed.ts        first-run demo project
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
  "version": 1,
  "exportedAt": "2026-11-21T08:00:00.000Z",
  "projects": [
    {
      "id": "p_…",
      "name": "Product architecture",
      "description": "A map of how it all fits",
      "createdAt": "…",
      "updatedAt": "…",
      "nodes": [
        {
          "id": "n_…",
          "projectId": "p_…",
          "parentId": null,
          "type": "project",
          "title": "Flow",
          "description": "Offline-first project workspace",
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
