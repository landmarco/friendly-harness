# Prewalk Extension

Smart model plans and starts, cheap model finishes.

Based on Can Bölük's "Prewalk Technique" — a frontier model starts execution
(explores, writes a TODO, makes one real edit), then swaps to a cheaper model
mid-context to finish, avoiding the double-read cost of plan-only handoffs.

## Usage

| Command                     | What it does                                    |
| --------------------------- | ----------------------------------------------- |
| `/prewalk`                  | Arm with `sol` smart, `deepseek` target         |
| `/prewalk <target>`         | Arm with current model, custom target           |
| `/prewalk <smart> <target>` | Arm with custom smart + target, switch to smart |
| `/prewalk off`              | Disarm                                          |

### Aliases

`/prewalk` accepts short names, so you never type a provider path at the
gate:

| Alias      | Model                                          |
| ---------- | ---------------------------------------------- |
| `sol`      | `openai-codex/gpt-6.2-sol`                     |
| `smart`    | same as `sol`                                  |
| `deepseek` | `openrouter/deepseek/deepseek-v4.1-flash-1017` |
| `cheap`    | same as `deepseek`                             |

```
/prewalk                  # sol starts, deepseek finishes
/prewalk sol deepseek     # same thing, spelled out
/prewalk deepseek         # stay on the current smart model, cheap finishes
/prewalk off              # disarm
```

Full provider/model paths still work and are passed through unchanged.

## How it works

1. On arm, injects a system prompt nudge to write a TODO.md and start implementing.
2. Watches for a TODO file write followed by a code edit/write.
3. On that turn boundary, swaps to the cheaper target model.
4. After handoff, injects a nudge to verify the TODO is complete.
