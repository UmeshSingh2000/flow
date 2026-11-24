'use strict';

/**
 * Claude Code integration content shared by the CLI (`flow install-skill`)
 * and the VS Code extension (`Flow: Install Claude Integration`).
 *
 * Keep these lists in sync with src/core/types.ts.
 */

const NODE_TYPE_NAMES = [
  'project',
  'module',
  'feature',
  'sub-feature',
  'process',
  'decision',
];

const CONNECTION_TYPE_NAMES = [
  'depends-on',
  'calls',
  'leads-to',
  'related-to',
];

const SKILL_MARKDOWN = `---
name: flow
description: Read and update this repository's Flow documentation project through the flow CLI or MCP tools. Use when the user asks to document code in Flow, update Flow nodes, or keep Flow docs in sync with the repository.
---

# Flow documentation sync

Flow stores a visual project map: nodes (modules, features, processes,
decisions) with hierarchy, Markdown documentation, and graph connections.

## Tools

Prefer the MCP tools when available:

- \`flow_status\` — linked project and counts.
- \`flow_list_nodes\` — stable external keys, paths, types.
- \`flow_get_node\` — full Markdown and connections for one node.
- \`flow_apply_plan\` — atomic, validated batch apply (dryRun defaults to true).

Without MCP, use the CLI: \`flow status\`, \`flow list --json\`,
\`flow get <key> --json\`, \`flow apply plan.json --dry-run\`, then
\`flow apply plan.json\`.

## Workflow

1. Run \`flow status\` and \`flow list --json\` to learn the existing project.
2. Read the repository code relevant to the user's request. Do not invent
   architecture that the code does not show.
3. Build a plan with stable, path-like external keys
   (\`module/auth\`, \`module/auth/login\`, \`file:src/auth/session.ts\`).
   Reuse existing keys from \`flow list\`; never re-key an existing node.
4. Run the plan with dryRun / \`--dry-run\` and check the diff.
5. Apply it. Report the summary to the user.

## Plan format

\`\`\`json
{
  "provenance": { "tool": "claude-code", "sourceFiles": ["src/auth/session.ts"] },
  "ops": [
    {
      "op": "upsert-node",
      "key": "module/auth",
      "type": "module",
      "title": "Auth",
      "parent": "@root",
      "markdown": "## Purpose\\n..."
    },
    {
      "op": "upsert-node",
      "key": "module/auth/session",
      "type": "feature",
      "title": "Session handling",
      "parent": "module/auth",
      "details": { "purpose": "...", "behavior": "..." }
    },
    {
      "op": "connect",
      "source": "module/auth/session",
      "target": "module/database",
      "type": "depends-on"
    }
  ]
}
\`\`\`

- \`upsert-node\`: creates by \`key\` or updates the existing node. Idempotent.
- \`update-node\`: updates \`key\` (external key, node id, or \`@root\`).
- \`reparent-node\`: \`{ "key": "...", "parent": "..." | null }\`.
- \`connect\`: ensures one edge; repeated plans update rather than duplicate.
- Node types: ${NODE_TYPE_NAMES.join(', ')}.
- Connection types: ${CONNECTION_TYPE_NAMES.join(', ')}.
- Parents may be external keys, node ids, or \`@root\` (project root).
- Every operation must reference a node that exists or is created by the same plan.

## Safety

- Never run destructive shell commands; this task only reads code and writes
  Flow documentation.
- Do not delete nodes or concepts you did not create.
- Keep Markdown focused on purpose, inputs, outputs, behavior, and failure modes.
- If a dry run reports errors, fix the plan rather than bypassing validation.
`;

const FLOW_HELP_COMMAND = `---
description: List the Flow terminal commands
---

Run \`flow help --json\` and summarize the available Flow commands for the user.
If the command is missing, install it from VS Code: Command Palette →
\`Flow: Install Terminal CLI\`.
`;

const MCP_REGISTER_COMMAND = 'claude mcp add --scope user flow -- flow mcp';

module.exports = {
  NODE_TYPE_NAMES,
  CONNECTION_TYPE_NAMES,
  SKILL_MARKDOWN,
  FLOW_HELP_COMMAND,
  MCP_REGISTER_COMMAND,
};
