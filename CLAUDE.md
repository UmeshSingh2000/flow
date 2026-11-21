# Claude Code Instructions — Flow

These instructions apply to all work in this repository.

## 1. Read the project requirements first

- Read `flow-project-requirements.md` before implementing or changing product functionality.
- Treat that document as the primary product specification for the initial web MVP.
- If an implementation detail is not specified, inspect the existing codebase and choose the simplest maintainable option that fits the product principles. Do not invent additional product scope.
- Keep requirements and implementation aligned. When a meaningful requirement changes, update the requirements document as part of the same task when appropriate.

## 2. Product context and MVP boundaries

Flow is an offline-first visual project documentation application. Users manually create projects, nodes, hierarchical parent-child relationships, and graph connections. They document each node and explore the project through an interactive canvas.

The structured project data is the source of truth. The canvas and project tree are two views of the same data.

For the initial web MVP, focus on:
- Project creation and management.
- Creating, editing, moving, nesting, and deleting nodes.
- Connecting any valid nodes, including nodes in different branches and project-level areas.
- Editing node documentation in a properties panel.
- Keeping the project tree and canvas synchronized.
- Local persistence, backup export, and restore/import.
- Offline operation after the app has been loaded and cached.

Do not implement AI, cloud sync, accounts, collaboration, remote APIs, automatic source-code analysis, billing, or the VS Code extension as part of the MVP unless the user explicitly changes the scope.

## 3. Architecture principles

- Keep domain logic independent from React components and browser APIs.
- Keep project, node, hierarchy, connection, validation, and graph operations reusable so a future VS Code extension can share them.
- Put persistence behind a clear repository/storage interface. Browser storage and future extension storage must be replaceable adapters.
- Keep browser-only functionality (PWA registration, OPFS access, browser file pickers, and browser-specific APIs) outside shared domain logic.
- Use TypeScript for application and domain code unless the existing project has a well-founded alternative.
- Prefer a simple, modular architecture over premature abstraction or unnecessary packages.
- Inspect the existing project structure and package manager before changing dependencies or scripts. Do not assume npm, pnpm, or yarn; follow the repository's lockfile and existing conventions.

## 4. Critical graph and data-model rules

Keep these concepts separate:

1. **Hierarchy:** a node's optional `parentId` determines where it sits in the project tree. In the initial model, a node has at most one parent.
2. **Connections:** graph edges represent relationships between nodes and are independent of hierarchy. Nodes may have multiple incoming and outgoing edges, including edges across different hierarchy branches.
3. **Canvas layout:** node positions are presentation data and must not determine hierarchy or connection semantics.

Additional rules:
- Use stable IDs for projects, nodes, and edges. Never use titles or array positions as identifiers.
- Renaming or moving a node must not break its connections.
- Validate that a node cannot become its own ancestor and that parent-child hierarchy cannot contain cycles.
- Reject invalid self-connections and duplicate connections of the same type between the same source and target, consistent with the requirements.
- Keep all node and edge references scoped to their owning project.
- Define and test node deletion behavior, including descendants and connected edges. Make destructive behavior clear to the user and require confirmation in the UI.
- Validate imported data before inserting it. Handle missing references, duplicate IDs, invalid parent chains, unsupported schema versions, and malformed edges with clear errors.
- Version the persisted schema and the portable export format. Add migrations when the schema changes; do not silently reinterpret old data.

## 5. Local-first and offline requirements

- Local user data is the source of truth. Core editing must never require a server, account, or internet connection.
- Follow the requirements document's SQLite-based browser persistence direction. Prefer a verified SQLite-WASM solution with OPFS persistence where the supported browser environment allows it.
- Do not silently substitute `localStorage` or an in-memory store as the authoritative database.
- Verify browser support, transaction behavior, persistence permissions, and failure modes for the selected SQLite/OPFS library before relying on it.
- If a fallback is necessary, document its limits and ensure the user is told when persistent storage is unavailable.
- Auto-save changes safely and promptly. Surface meaningful storage errors; never show a successful save state when persistence failed.
- Provide explicit backup export and validated import/restore. Do not overwrite existing projects without clear user consent.
- Do not send project content, node details, or graph data to remote services.
- Ensure the app shell and required static assets can be cached for offline launches. Test offline behavior rather than assuming that a PWA manifest alone makes the app offline-capable.

## 6. UI and interaction principles

The editor is the primary product experience. Keep it focused and uncluttered.

Preferred desktop layout:
- **Left sidebar:** Flow identity, current project, add-node action, and collapsible project hierarchy.
- **Main canvas:** the largest area; displays nodes and edges and supports pan, zoom, fit-to-view, node dragging, selection, and connection creation.
- **Right properties panel:** shows editable details for the selected node or edge; may collapse when nothing is selected.

Interaction expectations:
- Users can add a node from the editor without navigating away.
- Users can add a child from a selected node.
- Users can create connections by dragging from a connection handle or another clear interaction.
- Users can connect nodes across branches; do not restrict edges to parent-child links.
- Selecting a node in the tree selects and locates the same node on the canvas, and selecting it on the canvas highlights it in the tree.
- Canvas changes, tree changes, properties changes, and persisted data must remain synchronized.
- Include useful empty states and clear validation/error messages.
- Use confirmation for destructive actions.
- Keep node cards concise; put detailed documentation in the properties panel.
- Use a restrained, clean developer-tool visual style: light neutral surfaces, subtle borders, readable typography, and one restrained accent color. Avoid excessive gradients, shadows, animation, or decorative UI.
- Make controls keyboard-accessible where practical and provide visible focus states.

## 7. Implementation workflow

Before coding:
1. Inspect the repository, current branch/status, package manager, and existing conventions.
2. Read the relevant sections of `flow-project-requirements.md`.
3. Identify the smallest change that satisfies the requested behavior.
4. Check whether an existing component, utility, or dependency already solves the problem.

While coding:
- Make focused changes; avoid unrelated refactors.
- Reuse existing patterns and components where they are sound.
- Keep components small and domain operations testable.
- Avoid `any` unless there is a documented reason; validate data at external boundaries.
- Handle loading, empty, error, and success states intentionally.
- Do not add dependencies for trivial functionality.
- Do not hardcode sample project content into production behavior; use seed/demo data only when explicitly useful and clearly separated from user data.
- Never put secrets, credentials, or machine-specific paths into source control.

After coding:
1. Run the relevant tests and checks using scripts that actually exist in `package.json` or the repository documentation.
2. Run type checking and linting when configured.
3. Build the app when the change could affect the production build.
4. Fix errors introduced by the change. Report any checks that could not be run and why.
5. Summarize what changed, important design decisions, and any remaining limitations.

Do not claim a feature works unless it has been implemented and appropriately verified.

## 8. Testing expectations

Prioritize tests for domain behavior and data safety, especially:
- Creating, updating, moving, and deleting projects and nodes.
- Parent-child hierarchy rules and cycle prevention.
- Cross-branch connections, multiple incoming/outgoing edges, and edge deletion.
- Duplicate/self-edge validation.
- Referential integrity and project isolation.
- Node deletion and descendant/edge handling.
- Import validation, export/restore round trips, and schema migrations.
- Persistence after reload and behavior when storage fails.
- Offline operation after the app shell has been cached.

For UI changes, verify the primary user flow: create a node, add a child, connect nodes in different branches, select a node, edit its details, and confirm the views stay synchronized.

## 9. Dependency and library guidance

- Prefer established, maintained libraries when they materially reduce risk or implementation effort.
- React Flow (`@xyflow/react`) is a suitable candidate for the graph canvas, but inspect the current app and verify the installed version/API before using it.
- Do not assume a particular SQLite-WASM package until browser compatibility and OPFS behavior have been verified.
- Keep graph rendering concerns separate from domain graph validation and persistence.
- Avoid coupling the domain model to a specific graph UI library's internal node/edge types. Map between library types and Flow's own domain types at the UI boundary.

## 10. Future VS Code compatibility

The extension is a future platform, not part of the current web MVP. Preserve portability without building extension infrastructure prematurely:
- Keep domain models and graph operations platform-independent.
- Keep storage APIs behind interfaces.
- Keep the export/import format documented and versioned.
- Reuse the React editor in a VS Code webview only where practical; do not assume all browser APIs are available in a webview.
- Do not make the web app depend on VS Code APIs or extension-specific packages.

## 11. Decision priority

When making tradeoffs, prioritize in this order:
1. Data integrity and user ownership of local project data.
2. Correct graph and hierarchy behavior.
3. A clear, reliable editing experience.
4. Offline functionality.
5. Maintainability and future platform reuse.
6. Visual polish and optional enhancements.

If a requested change conflicts with the requirements or these principles, explain the conflict briefly and propose the smallest safe adjustment. Follow the user's explicit direction when they intentionally revise the product requirements.
