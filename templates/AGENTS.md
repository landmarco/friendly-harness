# Project instructions

This file is loaded by pi whenever a session starts in this project. Keep it
short and project-specific.

## Workspace

- The harness lives beside this project at `~/codetools/friendly-harness`.
  Shared rules, model routing, and preferences are in
  `.pi/agent/AGENTS.md` there.
- This file is for context that only applies to this project.

## Rules

- Read neighbouring files before editing; match the project's naming,
  formatting, and test style.
- Start with the smallest change that satisfies the ask.
- Run the project's own scripts for lint, test, build, and deploy.
- `git status` before substantial changes. Never revert, clean, stage, or
  commit the user's pre-existing work unless asked.
- Do not commit, push, merge, or rebase unless asked.
- Put scratch files in `friendly-harness/artifacts/<project>/`, never loose in
  this repo.
