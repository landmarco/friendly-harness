---
name: previous-work
description: Search past agent sessions across pi, Cursor, and Claude Code when asked about earlier work. Use when the user asks "what did we do about X", "did we already discuss/try/fix X", "find that earlier session", "review previous work", or when a task smells like a repeat of something already done. Knows where each tool stores its JSONL transcripts and how to search them without tripping over ignore files.
---

# Previous Work

Raw transcript archaeology across pi, Cursor, and Claude Code. For distilled
lessons, `AGENTS.local.md` Learnings is already in context (`memory` skill) -
check it first; only dig transcripts when you need what actually happened.

## Where sessions live

| Agent       | Path                                                                         | Shape                      |
| ----------- | ---------------------------------------------------------------------------- | -------------------------- |
| pi          | `.pi/agent/sessions/*.jsonl`                                                 | timestamp + uuid filenames |
| Cursor      | `~/.cursor/projects/<encoded-project>/agent-transcripts/<uuid>/<uuid>.jsonl` | one dir per chat           |
| Claude Code | `~/.claude/projects/<encoded-project>/*.jsonl`                               | one store per cwd          |

The project segment is the working directory with path separators and some
punctuation replaced by dashes. For example, a project at
`/home/you/code/my-app` appears as `-home-you-code-my-app` under
`~/.claude/projects/` and as `home-you-code-my-app` under
`~/.cursor/projects/`. List the directory to see the actual names rather than
guessing.

## How to search

pi sessions are hidden from rg by the repo `.ignore` (`sessions/` pattern) -
always pass `--no-ignore`:

```bash
rg --no-ignore -li 'search term' .pi/agent/sessions/
rg -li 'search term' ~/.cursor/projects/
rg -li 'search term' ~/.claude/projects/
```

Then narrow inside a hit (JSONL, one message per line):

```bash
rg --no-ignore -i 'term' <file> | head -5     # locate lines
ls -t <dir> | head                             # most recent first
```

Filenames carry the date (pi) or check file mtime (Cursor/Claude) to order by
recency when the user says "yesterday" or "last week".

## Ground rules

- Transcripts contain secrets and personal info. Quote the minimum that
  answers the question, and leave it in the transcript otherwise.
- Cite where the answer came from (which store, which file, the date) so the
  user can reopen the session.
- Not found is a real answer: say which stores you searched and with what
  terms instead of guessing.
- Durable lessons discovered while digging go to `AGENTS.local.md` Learnings
  (`memory` skill) so the next search is unnecessary.
