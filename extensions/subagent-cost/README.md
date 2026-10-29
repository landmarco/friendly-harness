# Subagent Cost

Shows per-session subagent spend in the pi footer, split by billing source. It
sits alongside the rewind-hook `◆` status line.

## What it shows

```
◆ subagents: $0.01 | 281k codex
```

- **`$X`** - metered spend (e.g. OpenRouter) from subagent runs.
- **`281k codex`** - total input+output tokens spent on OpenAI Codex subagents
  (your ChatGPT subscription, not metered in dollars).
- **`|`** separates the two **billing groups** (metered dollars vs Codex
  subscription tokens) so they don't run into one another.

## Why it exists

Subagents run as separate nested pi sessions, so their usage never lands in
the parent session's `$` meter in the footer. This reads the pi-subagents
history sqlite instead.

## Scoping

Totals come only from `subagent_tasks` rows whose `session_id` **and `cwd`**
match this pi process's session. Concurrent sessions (friendly-harness vs
another project) each show only their own subagent spend.

## Data sources

| Thing          | Source                                                 |
| -------------- | ------------------------------------------------------ |
| Subagent usage | `~/.local/share/pi/subagents/subagents-history.sqlite` |

## Limits

- Only tasks already written to the sqlite history are counted (i.e. tasks
  that reached a terminal state). A task still running is not in the total
  until it completes.
- Codex spend is shown in tokens only - the weekly _percentage_ was dropped
  because OpenAI's figure lives behind browser-only endpoints that reject
  plain Node requests (HTTP 403), so an accurate percentage isn't reliably
  available to the harness.

## Install

Placed under `extensions/subagent-cost/`, it auto-loads via `/reload` (repo
`extensions/` is symlinked into `~/.pi/agent/extensions/`).
