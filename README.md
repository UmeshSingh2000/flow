# Flow

Flow is an offline-first visual project documentation app. Build a project map from
nodes, hierarchical parent-child relationships, and explicit connections that can
cross branches. The tree, canvas, and alternate views all represent the same project
data.

Flow runs as a web app and as a Visual Studio Code extension. It starts empty: create
a project or import a backup to get started.

## Run the web app

```bash
npm install
npm run dev        # http://localhost:5173
```

Other useful scripts:

```bash
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle
npm test           # share-server tests (Node's built-in test runner)
npm run preview    # serve the production build
```

## VS Code extension

Package and install the extension with:

```bash
npm run package
```

This builds the webview assets, creates `flow-<version>.vsix`, installs it, and asks
VS Code to reload. If your VS Code executable is not named `code`, set
`VSCODE_EXECUTABLE` before running the command. After installation, run **Flow: Open**
from the Command Palette. For extension development, build the assets and launch a
development window instead:

```bash
npm run build:extension
code --extensionDevelopmentPath=. --new-window
```

The extension uses VS Code's theme until a Flow theme is explicitly chosen, then
remembers that choice in extension state. The web app offers light and dark themes in
**Settings** and remembers the choice in the browser.

## Features

| Area | Features |
|---|---|
| Projects | Create, rename, switch, and delete projects; project deletion requires confirmation. Each project has a protected root node and optional description. |
| Nodes and hierarchy | Create nodes at the root or as children, edit their title/type/description, drag them on the canvas, duplicate them, and re-parent them. Nest to any depth; the tree supports expand/collapse and search. Deletion explains descendant handling and requires confirmation. |
| Documentation | Eight structured fields (purpose, inputs, outputs, preconditions, behavior, success/failure result, notes), a description, and per-node Markdown with a rendered preview and full-screen Write/Preview editor. |
| Images | Attach up to six images to a node through the properties panel or by dropping files on a node. Dropping onto empty canvas creates a node named after the image. Cards show thumbnails; select one to open the full-screen viewer. |
| Connections | Connect any two nodes—including across branches—by dragging between handles. Drop a connector on empty canvas to create a connected node. Connections can have a relationship type and label; select or hover one to remove it. Self-connections and duplicate connections of the same type are rejected. |
| Views | Switch between the interactive **Canvas**, sortable **Table**, type-grouped **Board**, and Markdown-focused **Docs** views. Selecting nodes is synchronized; double-click an item in Table, Board, or Docs to locate it on the canvas. |
| Canvas | Pan, zoom, fit-to-view, use the minimap and dotted grid, drag nodes, and select nodes or connections. Selecting a tree item selects and centres that node on the canvas. |
| Command palette | Open **Commands** or press `Ctrl+K` (Windows/Linux) or `⌘K` (macOS) to search commands and nodes, create or edit items, connect nodes, switch views and themes, navigate, and manage backups. |
| Appearance and layout | Light and dark themes; collapse the sidebar and let the canvas reclaim space when the properties panel is closed. |
| Persistence and portability | Autosave with a 400 ms debounce to IndexedDB, visible save status, and a warning if only the in-memory fallback is available. Export a project or workspace as versioned JSON and import validated backups without overwriting existing projects. |
| Guided tour | A restartable first-run tour guides users through project creation, nodes, documentation, connections, canvas navigation, and backups. Replay it from Settings or the command palette. |
| Read-only sharing | In the VS Code extension, password-gated local-network sharing lets guests view the active project and see updates without an account or cloud service. |
| Offline use | Editing uses local project data and requires no account, backend, or remote API. The web app works offline after it has loaded; its shell is not currently precached for a cold offline launch. |

Keyboard: `Delete`/`Backspace` deletes the selected connection or asks to confirm
selected-node deletion. `Escape` clears selection and closes dialogs. The command
palette is available with `Ctrl+K` or `⌘K`.

## Read-only local-network sharing

LAN sharing is available only in the VS Code extension, whose extension host can accept
incoming connections. It serves a read-only view over the local network; the browser
web app alone cannot host a share.

1. Open Flow in VS Code (**Flow: Open**).
2. Open the project menu (⋯) beside the project name and choose **Share read-only...**.
3. Leave the password blank to generate one, or enter a password, then start sharing.
4. Give the guest the link and password. They open the link in a browser on the same
   network and enter the password.

Guests can pan and zoom, select nodes and connections, read documentation and Markdown,
and open images. They cannot edit, delete, connect, or import. The server exposes only
`GET` and `HEAD` routes. The guest view refreshes automatically, generally within five
seconds. A **Sharing** indicator in the canvas header reopens the share controls.

The share stops when it is stopped manually, the shared project is switched or deleted,
VS Code closes, or the four-hour lifetime expires. Snapshots are held in extension-host
memory, not in a database; guest project content is not saved on the guest device.

Sharing uses **plain HTTP**: the password gates access but does not encrypt project
content. Share only on a network you trust. Firewalls or Wi-Fi client isolation may
prevent guests from reaching the host. For a local test, open the generated link in a
browser on the same machine; if the selected LAN address is unreachable (for example,
with a VPN or multiple adapters), try replacing its host with `127.0.0.1`, keeping the
port and `/s/<id>` path.

## Data and backups

Projects are stored locally in IndexedDB (`flow-workspace`, with `projects` and `meta`
stores). Saves are debounced by 400 ms and flushed when the page is hidden or closed.
The status indicator reports **Saving...**, **Saved on this device**, or **Save failed**.
If IndexedDB is unavailable, Flow uses a visibly marked in-memory fallback; data in
that fallback is not persistent, so export a backup before closing the app.

Backups are versioned JSON and can contain one project or the whole workspace. Import
validates the file before applying it and reports malformed JSON, unsupported versions,
missing nodes, broken parent references, hierarchy cycles, duplicate IDs, self-links,
and duplicate edges. Existing projects are not overwritten: an imported project whose
ID already exists is assigned a fresh identity.

Images travel with backups as inline data URLs. Flow scales images to a 1400 px longest
edge and re-encodes them as WebP (JPEG fallback); small animated GIFs pass through.
Source files over 12 MB are refused, and import rejects payloads above approximately
3 MB per image.

## Architecture

```text
src/
  core/            framework-independent domain and validation
    types.ts       project, node, connection, and workspace models
    graph.ts       graph operations: create, move, connect, delete, duplicate
    validation.ts  versioned backup parsing and reference/cycle checks
    id.ts          stable ID generation
  storage/         persistence boundary
    repository.ts  StorageAdapter interface
    indexeddb.ts   browser persistence adapter
    memory.ts      visible, non-persistent fallback
  state/           Zustand stores, actions, autosave, guide and sharing state
  ui/              React editor, React Flow canvas, properties, tree and views
    Shared*.tsx    read-only guest experience for LAN shares
    shareBridge.ts webview-to-extension messages for sharing
    vscodeBridge.ts theme and host integration for VS Code
  extension/
    extension.cjs  VS Code webview host and message routing
    shareServer.cjs password-gated, read-only LAN HTTP server

tests/
  shareServer.test.cjs  share server authentication and lifecycle tests
```

The data flow is UI → store → pure core operations → `StorageAdapter`. UI components do
not write to storage directly, and the core does not depend on React or browser APIs.
The same editor UI is bundled into the VS Code webview; the extension host separately
runs the optional LAN share server.

## Current limitations

- Browser persistence uses IndexedDB, not SQLite-WASM with OPFS. The storage interface
  keeps the persistence implementation replaceable, but IndexedDB is the current
  authoritative browser store.
- The web app does not yet precache its shell with a service worker/PWA, so offline use
  requires the app assets to have already loaded.
- Descendant collapse is available in the project tree, not on the canvas.
- The editor is desktop-first; the properties panel is hidden on narrow screens.

See [`flow-project-requirements.md`](./flow-project-requirements.md) for the product
requirements and intended boundaries.
