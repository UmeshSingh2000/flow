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
npm test           # core, protocol, CLI, and share-server tests
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

### Package and share

- `npm run package` builds, installs, and reloads the extension locally.
- `npx @vscode/vsce package` creates a shareable `flow-<version>.vsix`.
- Other users install it with `code --install-extension flow-<version>.vsix`, or
  from the Marketplace after publishing with
  `npx @vscode/vsce publish -p <PAT>`.
- The terminal CLI and Claude integration are installed from inside the extension
  with **Flow: Set Up Everything (CLI + Claude)**, so users do not need to clone
  this repository. The individual installer commands remain available.

## Terminal control and workspace linking

This feature is VS Code-only. A terminal process cannot reach the webview's local
database, so the extension host owns a small command channel and the CLI talks to it.
Nothing is written to the repository: all shared state lives under the per-user Flow
application-data directory (`~/.local/share/flow` on Linux, `~/Library/Application
Support/flow` on macOS, `%LOCALAPPDATA%\flow` on Windows).

Rebuild and reinstall the extension (`npm run package`) before using the CLI so the
extension host includes the command channel.

### One-click setup

After installing the extension, open the Command Palette and run
**Flow: Set Up Everything (CLI + Claude)**. It:

1. installs the `flow` launcher and reports Node.js / `PATH` requirements;
2. installs the Claude skill and `/flow-help` command;
3. registers the MCP server with the official
   `claude mcp add --scope user` command when the Claude Code CLI is available;
4. opens Flow and links the current workspace.

The first time you run **Flow: Open** in a workspace, Flow offers this setup once.
It never writes to the repository. It writes only to Flow's app-data directory,
`~/.claude`, and the terminal launcher, and it runs only the fixed
`claude mcp list` / `claude mcp add` commands. The extension itself must be
installed first (Marketplace or `.vsix`); that step cannot be automated from
inside the extension.

If a different `flow` command or a non-Flow Claude skill already exists, setup
skips that piece and reports it instead of overwriting. If Claude Code is not on
`PATH`, it shows and copies the registration command.

### Install the CLI manually

The one-click command above does this. To install only the CLI, run
**Flow: Install Terminal CLI** from the Command Palette.

It:

- writes a `flow` launcher to `~/.local/bin` (Linux/macOS) or
  `%LOCALAPPDATA%\flow\bin` (Windows), or to `FLOW_CLI_DIR` if set;
- copies the CLI into Flow's app-data directory so extension updates do not
  break the installed command;
- reports whether Node.js and the install directory are on `PATH`.

Open a new terminal and run `flow status`. The CLI requires **Node.js 20+**;
VS Code's bundled Node is not exposed on `PATH`. For development,
`npm link` from this repository still works.

### Workspace linking

Open a folder in VS Code, then run **Flow: Open**. On the first open, Flow creates a
project named after the folder and links it to that workspace; later opens select the
same project. To link an existing project instead, select it in Flow and run **Flow:
Link Workspace to Active Project** (or `flow link`).

The mapping is stored in `workspaces.json` in Flow's app-data directory, keyed by the
workspace path. It is per user and per machine, and it never touches the repository.

### CLI

```bash
flow status                         # linked project, counts, storage state
flow list --type module             # tree of nodes with external keys
flow get module/auth --json         # one node with Markdown and connections
flow apply plan.json --dry-run      # validate and preview a batch
flow apply plan.json                # apply atomically
flow open                           # open/reveal the Flow panel
flow result <id> --wait             # result of a plan queued while Flow was closed
```

`apply` exits `3` when the request was queued because VS Code/Flow was not running;
it is applied the next time the extension starts. Files are read (`plan.json`) but
never written. A plan is all-or-nothing and idempotent: nodes are matched by
`externalKey`, so re-running a plan updates instead of duplicating.

Before a real (non-dry-run) apply, the extension writes a portable backup of the
project to `<appdata>/backups/`. It keeps the 10 most recent files, subject to a
200 MB total cap. The backup path is printed with the result; restore it through the
normal import flow.

```json
{
  "provenance": { "tool": "claude-code", "sourceFiles": ["src/auth/session.ts"] },
  "ops": [
    {
      "op": "upsert-node",
      "key": "module/auth",
      "type": "module",
      "title": "Auth",
      "parent": "@root",
      "markdown": "## Purpose\n..."
    },
    {
      "op": "connect",
      "source": "module/auth",
      "target": "module/database",
      "type": "depends-on"
    }
  ]
}
```

Operations: `upsert-node`, `update-node`, `reparent-node`, `connect`. There is no
delete operation. `parent` accepts an external key, a node id, or `@root`.

### Claude Code / MCP

The one-click setup does this automatically. To do it manually:

1. Run **Flow: Install Terminal CLI**.
2. Run **Flow: Install Claude Integration**. This writes the Flow skill and
   `/flow-help` command to `~/.claude` (or `CLAUDE_CONFIG_DIR`) and shows the
   exact MCP command. It does not modify `~/.claude.json` or any repository.
3. Restart Claude Code.
4. Register the server (user scope works from every repository):

```bash
claude mcp add --scope user flow -- flow mcp
```

If `flow` is not on `PATH`, use the `node "<appdata>/tools/cli/flow.mjs" mcp`
variant that the integration command prints. The CLI-only path is also
available:

```bash
flow install-skill
```

The server exposes `flow_status`, `flow_list_nodes`, `flow_get_node`, and
`flow_apply_plan` (dry-run by default) over stdio.

Restart Claude Code after registration. Run `/mcp` to confirm the `flow` server
is connected and `/flow-help` to list the terminal commands.

### Safety

- The command channel is a Unix socket or Windows named pipe inside Flow's app-data
  directory (mode `0700`/`0600`), not a network listener.
- Requests are validated, capped by size and operation count, and applied through the
  same domain validation as the UI.
- The CLI and extension never call a shell, never delete project data, and never write
  to the workspace.
- If Flow is closed, writes are queued in the app-data directory, not in the repo.
- Every real apply first writes a portable backup under `<appdata>/backups/`.

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
| Terminal and AI control | In the VS Code extension, a workspace links to one project automatically. The `flow` CLI and an MCP server can read nodes and apply validated, atomic documentation plans; generated nodes record provenance. |
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
    operations.ts  validated, atomic terminal/MCP plans (upsert/update/connect)
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
    vscodeBridge.ts theme, command, and host integration for VS Code
  extension/
    extension.cjs    VS Code webview host, workspace link, message routing
    shareServer.cjs  password-gated, read-only LAN HTTP server
    protocol.cjs     app-data paths, workspace keys, request validation
    commandServer.cjs Unix-socket/named-pipe command channel and offline queue
cli/
  flow.mjs         terminal CLI, MCP server, Claude skill installer

tests/
  operations.test.cjs    plan validation, atomicity, idempotency
  protocol.test.cjs      paths, workspace keys, request validation
  commandServer.test.cjs socket routing, workspace isolation, queue drain
  cli.test.cjs           help, queueing, install-skill, MCP initialize
  shareServer.test.cjs   share server authentication and lifecycle tests
```

The data flow is UI → store → pure core operations → `StorageAdapter`. The terminal
path is CLI/MCP → extension host → webview store → the same core operations and
storage. UI components do not write to storage directly, and the core does not depend
on React or browser APIs. The same editor UI is bundled into the VS Code webview; the
extension host separately runs the LAN share server and the command channel.

## Current limitations

- Browser persistence uses IndexedDB, not SQLite-WASM with OPFS. The storage interface
  keeps the persistence implementation replaceable, but IndexedDB is the current
  authoritative browser store.
- The web app does not yet precache its shell with a service worker/PWA, so offline use
  requires the app assets to have already loaded.
- Descendant collapse is available in the project tree, not on the canvas.
- The editor is desktop-first; the properties panel is hidden on narrow screens.
- Terminal control is VS Code-only. The web build has no command channel.
- Multi-root workspaces link only the first folder. Workspace links are per user and
  per machine, so cloning a repository elsewhere does not share the link.
- Plans cannot delete nodes or projects; deletion stays a deliberate UI action.
- MCP calls require Flow to be running. The CLI can queue plans while it is closed.
- There is no file-hash manifest yet, so an agent should use `flow list` / `flow get`
  to scope updates instead of trusting every node to be current.
- The terminal CLI and MCP server require Node.js 20 or newer on `PATH`.
- One-click setup can register MCP automatically only when the `claude` CLI is on
  the extension host's `PATH`; otherwise it shows the command to copy.
- PATH changes take effect in a new terminal, not one that is already open.
- Docs are stored per VS Code profile and machine. Move them with export/import;
  project links do not transfer.

See [`flow-project-requirements.md`](./flow-project-requirements.md) for the product
requirements and intended boundaries.
