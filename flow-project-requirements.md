# Flow — Project Requirements

**Document type:** Product Requirements / Initial Software Requirements Specification  
**Product:** Flow  
**Version:** 1.0 (Initial Web MVP)  
**Status:** Draft baseline
**Primary release:** Offline-first web application
**Supported platform:** Visual Studio Code webview extension

---

## 1. Product overview

Flow is an offline-first visual project documentation application. It allows developers to manually describe an application or software project as a collection of nodes, add detailed information to each node, and connect nodes to represent hierarchy, relationships, and execution or dependency flows.

The main interface is a large visual canvas. Users create nodes, connect them, arrange them, and explore the resulting project map. Selecting a node opens its details for editing. The canvas updates as the user changes the structure.

Flow is intended to help developers understand a project from its highest-level areas down to individual features and low-level steps. It is a documentation and mapping tool; it does not initially inspect source code or generate documentation automatically.

All core functionality must work offline after the application has been loaded and installed or cached. Project data is stored locally on the user's device. No account, backend service, or internet connection is required for normal use.

## 2. Product vision

Provide one clear visual place where developers can manually build and maintain a structured map of a software project, from the overall project down to individual features and their connections.

**Product principle:** The structured project data is the source of truth. The flowchart is a visual representation of that data, not a separate diagram that must be maintained independently.

## 3. Goals

1. Let a user create and manage one or more local projects.
2. Let a user create nodes at different levels of detail.
3. Let a user establish parent-child hierarchy between nodes.
4. Let a user connect any relevant nodes, including nodes in different branches or at the project level.
5. Present the structure and relationships as an interactive, dynamically updated graph.
6. Let a user document each node with useful descriptive information.
7. Save all changes locally and automatically.
8. Allow users to back up, export, and restore their project data.
9. Keep the core domain logic and data format reusable by a future VS Code extension.

## 4. Non-goals for the first release

The initial web MVP will not include:

- AI-generated documentation, code analysis, or AI chat.
- Cloud storage, account registration, or cloud synchronization.
- Real-time multi-user collaboration, simultaneous editing, comments, or permissions.
  Read-only sharing over the local network is defined separately in §7.11.
- Backend APIs or a hosted database requirement.
- Automatic source-code scanning or repository indexing.
- Task management, sprint planning, issue tracking, or project execution tracking.
- Billing, subscriptions, or analytics accounts.

## 5. Target users and primary use cases

### Target users

- Software developers documenting applications they build or maintain.
- Individual developers who want a visual overview of a codebase's features.
- Small development teams who want to create project maps locally before any collaboration capability exists.

### Primary use cases

- Create a project and add its top-level areas or modules.
- Expand a module into features, sub-features, and detailed steps.
- Connect separate branches to show dependencies or cross-feature relationships.
- Document inputs, outputs, behavior, conditions, and related features.
- Select and edit nodes directly from the canvas or project tree.
- Navigate a large project map using zoom, pan, search, and collapse/expand controls.
- Close the application and reopen it with the project unchanged.
- Export a project as a backup and import it on the same or another supported device.

## 6. Core terminology

| Term | Meaning |
|---|---|
| Workspace | The local Flow environment containing the user's projects. |
| Project | A top-level container for one documented application or system. |
| Node | An item represented on the canvas. A node may represent a project area, module, feature, sub-feature, process, decision, or other documented item. |
| Parent-child relationship | A hierarchical relationship used to organize nodes into levels. A child belongs to one parent in the initial model. |
| Connection / edge | A relationship drawn between two nodes. Connections may cross hierarchy branches and are not limited to parent-child relationships. |
| Canvas | The interactive visual area where nodes and their connections are displayed. |
| Node details | The editable documentation associated with a node. |

**Important model distinction:** A node's place in the hierarchy and its connections to other nodes are separate concepts. A node can have one parent in the hierarchy while also having multiple incoming and outgoing connections to other nodes.

## 7. Functional requirements

Priority definitions: **MUST** = required for MVP; **SHOULD** = strongly recommended for MVP; **FUTURE** = outside the initial release.

### 7.1 Project management

- **FR-PROJ-01 — MUST:** The user must be able to create a project with a name.
- **FR-PROJ-02 — MUST:** The user must be able to rename a project.
- **FR-PROJ-03 — MUST:** The user must be able to open and switch between locally stored projects.
- **FR-PROJ-04 — MUST:** The user must be able to delete a project after a confirmation step.
- **FR-PROJ-05 — SHOULD:** A project may include a short description and optional metadata such as creation and last-modified dates.
- **FR-PROJ-06 — MUST:** A newly created project must have a clear root or starting point for its project map.

### 7.2 Node management

- **FR-NODE-01 — MUST:** The user must be able to create a node on the canvas.
- **FR-NODE-02 — MUST:** The user must be able to add a child node from a selected node.
- **FR-NODE-03 — MUST:** The user must be able to edit a node's title and description.
- **FR-NODE-04 — MUST:** The user must be able to move nodes around the canvas.
- **FR-NODE-05 — MUST:** The user must be able to delete a node after a confirmation step.
- **FR-NODE-06 — MUST:** The user must be able to choose or change a node type.
- **FR-NODE-07 — SHOULD:** The user should be able to duplicate a node, including selected documentation fields.
- **FR-NODE-08 — MUST:** Nodes must have stable identifiers so relationships remain valid when titles change or nodes are moved.
- **FR-NODE-09 — MUST:** The initial hierarchy must support multiple levels of nesting; there must not be a fixed shallow depth limit imposed by the UI.
- **FR-NODE-10 — MUST:** The UI must visually distinguish the project/root node, regular feature nodes, and any additional node types supported by the MVP.

### 7.3 Node documentation

- **FR-DOC-01 — MUST:** Each node must support a title and a description.
- **FR-DOC-02 — SHOULD:** A node should support optional structured fields such as purpose, inputs, outputs, preconditions, main behavior, success result, failure result, and notes.
- **FR-DOC-03 — MUST:** The user must be able to edit node documentation from a properties panel or detail view.
- **FR-DOC-04 — MUST:** Changes to node documentation must be saved locally.
- **FR-DOC-05 — SHOULD:** The interface should indicate when a node has additional documentation, without requiring the user to open it.

### 7.4 Node hierarchy

- **FR-HIER-01 — MUST:** The user must be able to create a parent-child relationship by adding a child to a selected node.
- **FR-HIER-02 — MUST:** The project tree must display the hierarchy.
- **FR-HIER-03 — MUST:** The user must be able to expand and collapse branches in the project tree.
- **FR-HIER-04 — SHOULD:** The user should be able to move a node to a different parent, with confirmation or clear handling of the resulting hierarchy change.
- **FR-HIER-05 — MUST:** The application must prevent a node from becoming its own ancestor or creating a cycle in the parent-child hierarchy.

### 7.5 Connections and graph relationships

- **FR-CONN-01 — MUST:** The user must be able to connect two existing nodes using visible connection handles or an equivalent simple interaction.
- **FR-CONN-02 — MUST:** Connections must be allowed between nodes in different branches of the hierarchy.
- **FR-CONN-03 — MUST:** Top-level nodes or project areas must be connectable to one another.
- **FR-CONN-04 — MUST:** A node may have multiple incoming and outgoing connections.
- **FR-CONN-05 — MUST:** The user must be able to select and delete a connection.
- **FR-CONN-06 — SHOULD:** A connection should optionally have a label or relationship type, such as depends on, calls, leads to, or related to.
- **FR-CONN-07 — MUST:** Connections must be stored independently of node positions and parent-child hierarchy.
- **FR-CONN-08 — MUST:** The application must prevent duplicate connections of the same type between the same pair of nodes unless a future feature explicitly supports them.
- **FR-CONN-09 — MUST:** The application must prevent invalid self-connections unless a future use case explicitly supports them.

### 7.6 Visual canvas and navigation

- **FR-CAN-01 — MUST:** The canvas must occupy the primary area of the editor.
- **FR-CAN-02 — MUST:** The canvas must display nodes and their connections.
- **FR-CAN-03 — MUST:** The canvas must update when nodes or connections are added, edited, moved, or deleted.
- **FR-CAN-04 — MUST:** The user must be able to pan around the canvas.
- **FR-CAN-05 — MUST:** The user must be able to zoom in and out.
- **FR-CAN-06 — MUST:** The user must be able to fit the complete graph or current visible graph into the viewport.
- **FR-CAN-07 — MUST:** Selecting a node must visibly highlight it and open its properties panel.
- **FR-CAN-08 — SHOULD:** The canvas should provide a minimap for navigating larger graphs.
- **FR-CAN-09 — SHOULD:** The user should be able to collapse or expand a node's descendants to control visual complexity.
- **FR-CAN-10 — SHOULD:** The editor should provide a subtle grid or alignment guides to help position nodes.
- **FR-CAN-11 — MUST:** Canvas interaction controls must not make node editing or connection creation difficult to discover.

### 7.7 Editor layout

The initial desktop editor should contain three primary areas:

1. **Left sidebar:** Flow identity, current project, add-node action, and a collapsible hierarchical project tree.
2. **Main canvas:** The large interactive node graph, connection controls, zoom controls, fit-to-view action, and optional minimap.
3. **Right properties panel:** Details for the currently selected node or connection. It may be collapsed when nothing is selected.

- **FR-UI-01 — MUST:** The editor must make the canvas the main visual focus.
- **FR-UI-02 — MUST:** The user must be able to create a node without navigating away from the editor.
- **FR-UI-03 — MUST:** The user must be able to select a node from either the canvas or the project tree.
- **FR-UI-04 — MUST:** Selecting an item in the tree must locate or highlight the corresponding canvas node.
- **FR-UI-05 — SHOULD:** The interface should adapt to smaller screens, but desktop editing is the first design priority.
- **FR-UI-06 — SHOULD:** A command palette should make common actions (create a project or node, connect nodes, rename, switch views, navigate to a node) available from one searchable surface, reachable from a visible control and a keyboard shortcut.

### 7.8 Local persistence and data portability

- **FR-DATA-01 — MUST:** Project data must be stored on the user's device; a remote server must not be required for core functionality.
- **FR-DATA-02 — MUST:** The web implementation must use a local SQLite-based persistence approach where supported, such as SQLite compiled to WebAssembly with browser-managed persistent storage (for example, OPFS).
- **FR-DATA-03 — MUST:** Changes must be persisted automatically without requiring a manual Save button for every edit.
- **FR-DATA-04 — MUST:** The user must be able to export a project or workspace backup to a portable file.
- **FR-DATA-05 — MUST:** The user must be able to import a previously exported backup.
- **FR-DATA-06 — MUST:** Import must validate the backup and show a useful error instead of silently accepting corrupt or unsupported data.
- **FR-DATA-07 — MUST:** The application must handle interrupted writes and unexpected closure as safely as reasonably possible.
- **FR-DATA-08 — SHOULD:** The application should show a storage or save status indicator, including warnings when persistent storage is unavailable or has been denied.
- **FR-DATA-09 — MUST:** The data layer must be abstracted so that the web storage implementation can later be replaced or complemented by native SQLite in the VS Code extension.

**Browser storage limitation:** A browser application generally cannot silently write a database file to an arbitrary folder on the user's computer. The MVP should use browser-managed local persistent storage and provide an explicit export action to create a portable `.sqlite` backup where supported. The UI must clearly explain this behavior. The later VS Code extension can store a database directly in a workspace or extension-managed local location, subject to user permission.

### 7.9 Offline operation

- **FR-OFF-01 — MUST:** After the initial app assets are available locally, the user must be able to open and use the core editor without an internet connection.
- **FR-OFF-02 — MUST:** Creating, editing, connecting, moving, and deleting nodes must work offline.
- **FR-OFF-03 — MUST:** Reading and editing locally stored projects must not call a remote API.
- **FR-OFF-04 — SHOULD:** The web app should be installable as a Progressive Web App (PWA) where supported.
- **FR-OFF-05 — MUST:** The interface must not present offline operation as dependent on an online account or service.

### 7.10 Search and export

- **FR-UTIL-01 — SHOULD:** The user should be able to search node titles and descriptions within the current project.
- **FR-UTIL-02 — SHOULD:** Selecting a search result should locate and select the corresponding node.
- **FR-UTIL-03 — MUST:** The user must be able to export a restorable project backup.
- **FR-UTIL-04 — FUTURE:** Export documentation to Markdown, PDF, or image formats may be added after the initial editor is stable.

### 7.11 Local-network read-only sharing

LAN sharing is an optional extension of the MVP available when Flow runs inside the VS Code extension. It must not make core editing depend on a server, account, or internet connection.

- **FR-SHARE-01 — MUST:** The sharer must be able to start and stop a read-only share of the active project from the editor.
- **FR-SHARE-02 — MUST:** Sharing must be hosted by a small HTTP server run by the extension host on the local network. No database, cloud service, account, or third-party signaling service may be required.
- **FR-SHARE-03 — MUST:** Starting a share must produce a LAN URL, a share identifier, and an access password. A password is generated by default and may be chosen by the sharer.
- **FR-SHARE-04 — MUST:** A guest must supply the password before project content is returned, and failed attempts must be rate-limited.
- **FR-SHARE-05 — MUST:** The guest view must be strictly read-only. The share server must expose no write route, and the guest interface must not offer edit, delete, connect, or import actions.
- **FR-SHARE-06 — MUST:** The sharer's edits must appear in the guest view within a few seconds without the guest reloading the page.
- **FR-SHARE-07 — MUST:** A share must stop when the sharer stops it, switches or deletes the shared project, closes the editor or extension host, or reaches a bounded lifetime (4 hours by default). Stopping must invalidate the link.
- **FR-SHARE-08 — MUST:** Snapshots must use the versioned backup format and must be validated by the guest before rendering. Invalid or unsupported snapshots must show a clear error instead of partial data.
- **FR-SHARE-09 — MUST:** Project content must not be persisted on the guest device, sent to a remote service, or written to a database.
- **FR-SHARE-10 — MUST:** The interface must disclose that the link uses plain HTTP on the local network, that the password controls access but does not encrypt the board, and that sharing should be used only on trusted networks.
- **FR-SHARE-11 — SHOULD:** The sharer should see the link and password and be able to copy them, and should be warned when no LAN address is detected or when the share has ended.

## 8. Suggested initial node types

Keep node types simple in the first version. The following are suggested defaults and can be expanded later:

| Type | Intended use |
|---|---|
| Project | Root or project-level container. |
| Module | A major area of the application, such as Authentication or Payments. |
| Feature | A user-facing or system-level capability. |
| Sub-feature | A smaller part of a feature. |
| Process | A step or operation in a workflow. |
| Decision | A branching condition with possible outcomes. |

The user should be able to change a node's type. The type should influence visual presentation, but it must not restrict which nodes can be connected unless a future rule is explicitly introduced.

## 9. Initial data model requirements

The implementation may choose its exact schema, but it must represent at least the following entities and concepts.

### Project

- `id` — stable unique identifier.
- `name` — required project name.
- `description` — optional description.
- `created_at` and `updated_at` — timestamps.

### Node

- `id` — stable unique identifier.
- `project_id` — owning project.
- `parent_id` — optional parent node identifier for hierarchy.
- `type` — project area, module, feature, sub-feature, process, decision, or supported custom type.
- `title` — required title.
- `description` — optional description.
- `details` — optional structured documentation fields or versioned JSON payload.
- `position_x` and `position_y` — canvas coordinates.
- `created_at` and `updated_at` — timestamps.

### Connection

- `id` — stable unique identifier.
- `project_id` — owning project.
- `source_node_id` — source node.
- `target_node_id` — destination node.
- `type` — optional relationship type.
- `label` — optional user-defined label.
- `created_at` and `updated_at` — timestamps, if needed.

### Data model rules

- A project's nodes and connections must not be mixed with another project unless an explicit future cross-project feature is designed.
- Hierarchy (`parent_id`) and graph connections must remain separate.
- Node titles are not identifiers; changing a title must not break relationships.
- Deleting a node must have defined behavior for its descendants and connected edges. The MVP should ask the user to confirm and clearly state whether descendants will also be deleted or moved.
- Imported data must be checked for missing nodes, broken references, duplicate IDs, invalid parent chains, and invalid edges.
- The database schema must include a schema version and support migrations.

## 10. User experience requirements

- The interface should be simple and focused rather than looking like a large enterprise dashboard.
- Use a light theme as the initial default, with a neutral background, subtle borders, compact typography, and one restrained accent color.
- Avoid excessive gradients, decorative illustrations, heavy shadows, and unnecessary panels.
- Nodes must be readable at normal zoom and should show concise information; full documentation belongs in the properties panel.
- Common actions must be discoverable: add node, add child, connect, edit, delete, zoom, pan, and fit to view.
- Provide empty states that explain how to create the first node and connection.
- Use confirmation for destructive actions and provide clear validation messages.
- Keyboard accessibility should be considered for selecting nodes, navigating controls, and editing fields.

## 11. Non-functional requirements

### Performance

- The editor should remain responsive during normal editing of a project with at least 100 nodes and 200 connections on a typical modern desktop browser.
- Node edits and connection changes should appear on the canvas without a full page reload.
- Large graph rendering should avoid unnecessary React re-renders where practical.

### Reliability and data safety

- Local changes should be committed promptly and consistently.
- The application should provide clear errors when local storage is unavailable, full, or inaccessible.
- Users should be encouraged to export backups; browser-managed storage can be cleared by the user or browser.
- Import and migration operations must avoid silently overwriting existing project data.

### Privacy and security

- The MVP must not upload project content to a server.
- The MVP must not require user registration or collect project content analytics.
- Any optional diagnostics added later must be opt-in and must not include project documentation by default.
- Imported files must be validated before being loaded.
- Local-network sharing must be opt-in, read-only, password-gated, time-bounded, and disclosed as unencrypted HTTP traffic. Shared content must be limited to the one project the sharer selected.

### Maintainability and portability

- Use TypeScript for shared application logic and UI code where practical.
- Separate the graph/documentation domain logic from browser-specific storage and UI concerns.
- Define storage interfaces so the web app and future VS Code extension can use different storage adapters.
- Keep project export format versioned and documented.
- Avoid tying core graph operations directly to React components or browser APIs.

## 12. Recommended technical direction

These are implementation recommendations rather than mandatory product behavior:

- **Frontend:** React + TypeScript.
- **Build tooling:** Vite or an equivalent modern frontend build tool.
- **Graph canvas:** React Flow (`@xyflow/react`) or an equivalent node-based graph library.
- **Styling:** A consistent component system with CSS variables or a utility CSS framework.
- **Local database:** SQLite compiled to WebAssembly with OPFS-backed persistence where supported by the target browsers.
- **Offline delivery:** PWA manifest and service worker to cache the app shell and static assets.
- **State management:** A small predictable state layer; keep graph domain operations in framework-independent modules.
- **Future VS Code integration:** VS Code extension host plus a webview that can reuse the React editor and shared packages.

The team should verify browser support and storage behavior for the chosen SQLite-WASM/OPFS implementation before committing to it. A fallback strategy must be documented for browsers that do not support the chosen persistent storage mode.

## 13. Architecture requirements for a future VS Code extension

The VS Code extension is not part of the MVP, but the web app must avoid decisions that make future reuse unnecessarily difficult.

- **ARCH-01:** Keep project, node, hierarchy, connection, validation, and graph operations in a shared core package or framework-independent modules.
- **ARCH-02:** Keep persistence behind repository or storage interfaces.
- **ARCH-03:** Keep the graph editor UI reusable so it can be hosted in a VS Code webview.
- **ARCH-04:** Keep web-only services, such as browser storage and service-worker registration, outside the shared core.
- **ARCH-05:** Use a versioned, portable project data format so projects can move between the web app and extension.
- **ARCH-06:** Do not assume the browser and VS Code extension share the same physical database file. They should share the data model and import/export format while using platform-appropriate storage adapters.
- **ARCH-07:** Keep the read-only LAN share server in the extension host (Node), outside shared core and the web app, because browsers cannot accept incoming connections. The guest viewer may reuse the editor's rendering components in a read-only mode but must not depend on the sharer's local store.

Possible future extension capabilities include opening a Flow view in VS Code, associating a Flow project with a workspace, and storing project data locally using SQLite. These capabilities require a separate extension specification.

## 14. MVP acceptance criteria

The initial release is acceptable when all of the following can be demonstrated:

1. A user can launch Flow without creating an account.
2. A user can create, rename, open, and delete a local project.
3. A user can create a project-level node and add multiple levels of child nodes.
4. A user can edit each node's title, description, type, and supported documentation fields.
5. A user can connect two nodes that are not parent and child, including nodes from different branches.
6. A user can create multiple incoming and outgoing connections for a node.
7. A user can select and remove a connection.
8. A user can drag nodes, pan the canvas, zoom, and fit the graph to view.
9. Selecting a node opens its properties and selecting it from the tree locates it on the canvas.
10. The project tree and canvas reflect the same underlying project data.
11. All changes persist locally after closing and reopening the app.
12. Core editing works with the network disconnected after the app has been loaded and cached.
13. A user can export a project backup and import it again without losing its hierarchy, details, node positions, or connections.
14. The application clearly reports storage, import, or data-validation errors.
15. No project documentation is sent to a remote server during normal MVP usage.

## 15. Suggested implementation milestones

### Milestone 1 — Editor foundation

- Set up the web app and base editor layout.
- Add the canvas, node rendering, selection, pan, zoom, and fit-to-view controls.
- Add the left project tree and right properties panel.

### Milestone 2 — Nodes and hierarchy

- Implement project and node models.
- Create, edit, move, delete, and nest nodes.
- Synchronize the tree and canvas views.

### Milestone 3 — Graph connections

- Add connection handles and edge creation.
- Support cross-branch and project-level connections.
- Add edge selection, labels if included, and deletion.
- Validate graph references and hierarchy cycles.

### Milestone 4 — Documentation and local persistence

- Add node documentation fields.
- Implement SQLite-based local persistence.
- Add schema versioning and migrations.
- Add backup export and import.

### Milestone 5 — Offline readiness and polish

- Cache the app shell and required static assets.
- Verify offline editing and restart persistence.
- Add storage status, empty states, validation, and error handling.
- Test performance with representative project sizes.

### Future milestone — VS Code extension

- Reuse shared core, data models, graph logic, and editor UI where practical.
- Implement VS Code workspace integration and extension-specific storage.
- Support import/export compatibility with the web app.

### Future milestone — AI capabilities

AI-assisted documentation, codebase analysis, and automatic relationship suggestions may be explored after the manual documentation experience is reliable. AI must remain optional and must not be required for core editing.

## 16. Open product decisions

The following decisions can be made during implementation without blocking the initial design:

- Whether the MVP supports custom node types or only predefined types.
- Whether connection labels and relationship types are included in the first release or added immediately after basic connections.
- Whether users can re-parent nodes by dragging them in the tree or only through a properties action.
- Whether deleting a parent offers both cascade-delete and move-children options.
- Which browsers are officially supported for persistent SQLite storage.
- Whether export is per-project or for the complete workspace, or both.
- Whether Markdown editing is needed for node descriptions in the MVP.

## 17. Definition of success

Flow's first release is successful when a developer can independently create a useful map of an application, break its modules into detailed features, connect related parts across the graph, document how those parts behave, and return later to find the complete project map intact — all without needing an internet connection or an AI service.

---

**End of document — Flow Project Requirements v1.0**
