# agents-local

Loads gitignored personal context and keeps `work/` in sync with
`AGENTS.local.md`.

## Setup

1. Registered in repo `package.json` under `pi.extensions`.
2. Create `AGENTS.local.md` next to `AGENTS.md`.
3. File is gitignored - never committed.

## Behavior

On each session (`resources_discover`):

- Collects every `AGENTS.local.md` that applies, in load order:
  1. the harness root's, and
  2. the nearest one walking up from cwd (stopping at the repo boundary).
     Both are loaded, harness first, so a project file is read last and wins on
     conflict. When cwd is inside the harness itself both lookups resolve to the
     same path and it is loaded once.
- Locates the harness from `PI_CODING_AGENT_DIR` (`<harness>/.pi/agent`, set by
  `bin/pi`). That works whether the harness is an ancestor of the project
  (`harness/work/my-app`) or a sibling (`codetools/friendly-harness` beside
  `codetools/my-app`) - an upward walk can only ever find an ancestor. Falls
  back to the upward walk for `AGENTS.md` + `work/` when the variable is unset.
- Where a `work/` dir exists, scans it and rewrites the table between
  `<!-- agents-local:work-sync -->` markers in the harness `AGENTS.local.md`.
  Harnesses without `work/` skip this entirely.
- Preserves your description text for projects that still exist; adds new rows
  with README/package.json hints; drops removed directories.

On `before_agent_start`, appends the collected files under `## Personal
Context`, each labelled with its path.

### `/insert`

Splices `AGENTS.local.md` into `README.md` immediately before the last fenced
code block (the `npm start` command). Queues that combined document for the
next prompt only - replaces the default personal-context load for that turn.

Edit descriptions in the synced table freely. Do not hand-maintain the project
list - agents-local owns rows; you own the "What it is" column.
