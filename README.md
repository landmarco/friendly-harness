# Friendly Harness

A portable [pi](https://github.com/earendil-works/pi-coding-agent) workspace:
skills, extensions, subagents, launchers, and a project layout that keeps your
repos where they already live. The agent is named **friendlai**.

If you are new, read the next two sections and run the setup commands. The rest
is reference.

## What you get

- A shared agent instruction file that loads in every project session.
- A `skills/` directory that pi, Cursor, and Claude Code all read.
- Small extensions for personal context, project tooling, image description,
  and subagent cost.
- `fpi`: one command for sessions, git worktrees, and tmux attach.
- Optional cost and environmental-impact reporting.

## Requirements

| Tool             | Why                                                    | Check               |
| ---------------- | ------------------------------------------------------ | ------------------- |
| Node.js >= 22.19 | pi and the impact dashboard                            | `node -v`           |
| git              | worktrees and project history                          | `git --version`     |
| tmux             | attachable sessions (optional but recommended)         | `tmux -V`           |
| curl             | fetching pi, cost checks                               | `curl --version`    |
| python3          | `fpi-cost` report                                      | `python3 --version` |
| an AI provider   | OpenRouter, OpenAI Codex, Anthropic, or a local server | `/login` inside pi  |

Linux and macOS both work. On Windows, use WSL.

## Setup

### 1. Clone the harness

The recommended location is beside your projects:

```bash
mkdir -p ~/codetools
git clone https://github.com/landmarco/friendly-harness.git ~/codetools/friendly-harness
```

The launchers work from any clone path. Bare project names resolve under
`~/codetools` by default; set `FH_CODE_ROOT` if your projects live elsewhere.

### 2. Put the launchers on PATH

Add this to your shell config (`~/.bashrc`, `~/.zshrc`, or equivalent):

```bash
export PATH="$HOME/codetools/friendly-harness/bin:$PATH"
```

Reload the shell, then check:

```bash
fpi --help
```

If you prefer not to change PATH, run `~/codetools/friendly-harness/bin/fpi`
directly.

### 3. Connect a model provider

From the harness directory, start pi once and use its login flow:

```bash
cd ~/codetools/friendly-harness
./bin/pi
```

Inside the TUI, run `/login` and follow the prompts. For OpenRouter, the key is
stored in `.pi/agent/auth.json`, which is gitignored. You can also use
environment variables such as `OPENROUTER_API_KEY` or a subscription login for
Codex.

To see what is available:

```bash
./bin/pi --list-models
```

### 4. Create your personal context

`AGENTS.local.md` is gitignored and machine-local. From the harness directory,
start from the template:

```bash
cp templates/AGENTS.local.md AGENTS.local.md
```

Edit it with your OS, project root, and anything the agent should remember
about how you work. Keep it short; it is loaded into every session.

### 5. Make a first project

```bash
fpi --new hello-world
```

That creates `~/codetools/hello-world`, seeds a starter `AGENTS.md`, makes the
initial git commit, and opens pi in a tmux session. Detach with `Ctrl+B`, then
`D`; re-attach later with `fpi --attach hello-world`.

Already have a repo? Open it instead:

```bash
fpi ~/codetools/some-existing-repo
```

## Daily use

| Command                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `fpi`                               | Supervised session in the current directory.                                 |
| `fpi <project>`                     | Supervised session in a project under `~/codetools`, or at an absolute path. |
| `fpi --new <name-or-path>`          | Create a project, seed `AGENTS.md`, commit, and open a session.              |
| `fpi --worktree <project> <task>`   | Isolated worktree on branch `pi/<task>`.                                     |
| `fpi --attach [<project> [<task>]]` | Join a running session, show a menu, or create one.                          |
| `fpi --list`                        | List running harness sessions.                                               |
| `fpi-done --list`                   | List worktrees.                                                              |
| `fpi-done <project> <task>`         | Remove one worktree.                                                         |
| `fpi-cost`                          | OpenRouter spend for the month, plus impact totals.                          |
| `fpi-impact`                        | Local browser dashboard for cost, energy, carbon, and water.                 |

Pass pi options after `--`:

```bash
fpi my-app -- --model openai-codex/gpt-6.1-sol
fpi my-app -- -p "summarize the open TODOs"
```

The legacy aliases still work: `fpi-romp <project> <task>` is
`fpi --worktree`, and `fpi-attach` is `fpi --attach`.

### Sessions and worktrees

- A **supervised session** works in your real checkout. Use it for small
  changes and interactive review.
- A **worktree session** creates `~/codetools/.worktrees/<project>/<task>` on a
  separate branch. Use it for larger changes so your checkout stays clean.
- `fpi-done` refuses to remove a worktree with uncommitted changes unless you
  pass `--force`. Add `--delete-branch` to remove the branch when it is merged.

Detach from tmux with `Ctrl+B`, then `D`. The session keeps running. Re-attach
from another terminal, or from a phone over SSH. See
[`docs/remote-control.md`](docs/remote-control.md).

## How the harness fits together

```
~/codetools/
|-- friendly-harness/    this repo
|   |-- bin/             launchers
|   |-- skills/          skills, edited here
|   |-- extensions/      pi extensions
|   |-- docs/            reference notes
|   |-- templates/       starter files for new projects
|   `-- .pi/agent/       pi state for this harness
|-- my-app/              your projects, side by side
`-- .worktrees/          created by fpi --worktree
```

The current working directory is the active project. Everything else is
someone else's repo until you say otherwise.

`bin/pi` points pi at `.pi/agent/` with `PI_CODING_AGENT_DIR`, so agent state
stays inside the harness. A normal `~/.pi` directory is fine and is ignored; set
`FPI_STRICT_PI_HOME=1` if you want its presence to be an error.

`bin/fpi` adds tmux sessions, worktrees, and a budget check on top of `bin/pi`.
It does not replace pi; it is a wrapper.

## Make it yours

| Edit this                  | What it controls                                         |
| -------------------------- | -------------------------------------------------------- |
| `.pi/agent/AGENTS.md`      | Shared instructions loaded in every project.             |
| `AGENTS.local.md`          | Machine-local context, gitignored.                       |
| `templates/AGENTS.md`      | Starter file copied into new projects.                   |
| `skills/`                  | Skills. The single source of truth.                      |
| `extensions/`              | pi extensions.                                           |
| `.pi/agent/settings.json`  | Default model, thinking level, packages, enabled models. |
| `.pi/agent/models.json`    | Extra providers and local models.                        |
| `.pi/agent/subagents.json` | Subagent models, timeouts, and tool defaults.            |

`skills/` is the only place to edit skills. Cursor and Claude Code reach it
through the `.cursor/skills` and `.claude/skills` symlinks. pi loads it through
`--skill "$root/skills"` in `bin/pi`.

Some skills in this repo are examples from the author's projects
(`realness-design`, `test-coverage`, `vuetify-to-semantic`, `zoom-to-ableton`,
`vault`). Delete or replace them when they do not fit your work.

### Model routing and reasoning

The default model is set in `.pi/agent/settings.json`. The default thinking
level is `high`, not `max`:

- `xhigh` and `max` are only available on models that advertise them.
- The default OpenRouter DeepSeek model maps `xhigh` to null, so pi would clamp
  it up to `max`.
- `high` gives the intended result on that model.

If you switch to a model that supports `xhigh`, change `defaultThinkingLevel` to
`xhigh`. If you want the absolute ceiling, use `max`.

The routing table in `.pi/agent/AGENTS.md` explains which roles use local,
cheap OpenRouter, or subscription-backed Codex models. Edit it to match the
providers you actually have.

### Cost tracking

`fpi-cost` reads the OpenRouter key from `.pi/agent/auth.json` and reports
month-to-date spend against `FPI_BUDGET_USD` (default 20). It is a warning
layer, not an enforcement layer; set a hard credit limit on the OpenRouter key
itself.

The `fpi` launchers warn past 75% and refuse to start past 100% unless
`FPI_ALLOW_OVER_BUDGET=1`.

### Impact dashboard

`fpi-impact` converts token usage into electricity, carbon, and water, and
opens a local dashboard at `http://127.0.0.1:8731`. Raw rows live in
`impact/ledger.jsonl` (gitignored). Assumptions are editable in
`impact/config.json`. Full math and sources: `impact/README.md`.

### Add-ons

Extra pi packages are listed in `.pi/agent/settings.json` and stored in
`.pi/agent/npm/` (pi's add-on cupboard, not the npm program). Update them with:

```bash
./bin/pi update --extensions
```

### Local models

Add an OpenAI-compatible server to `.pi/agent/models.json`, then add the model
to `enabledModels`. Examples for Ollama, LM Studio, and MLX:
[`docs/local-models.md`](docs/local-models.md).

## What to ignore

These are machine state, scratch, or generated output. They are gitignored:

| Ignore                          | Why                              |
| ------------------------------- | -------------------------------- |
| `.pi/agent/npm/`                | Downloaded add-ons.              |
| `.pi/agent/sessions/`           | Conversation transcripts.        |
| `.pi/agent/auth.json`           | Provider credentials.            |
| `.pi/agent/mcp-onboarding.json` | One-time UI state.               |
| `artifacts/`                    | Screenshots and throwaway files. |
| `plans/`                        | Scratch planning area.           |
| `impact/ledger.jsonl`           | Raw usage rows.                  |
| `AGENTS.local.md`               | Your personal context.           |

Put scratch work in `artifacts/<project>/`, never in a project repo and never
in `/tmp`. Clean it up when you are done.

## Troubleshooting

| Symptom                                    | Fix                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `fpi: command not found`                   | Add `bin/` to PATH, or call the full path.                                                  |
| `fpi` cannot find a bare project name      | Create `~/codetools`, or set `FH_CODE_ROOT` to your projects directory.                     |
| `~/.pi` exists                             | Harmless. The harness uses `.pi/agent/`; set `FPI_STRICT_PI_HOME=1` to make it an error.    |
| tmux is not installed                      | `sudo apt install tmux` or `brew install tmux`. Sessions still run, but are not attachable. |
| `fpi --worktree` says the repo has no HEAD | Make an initial commit, or create the project with `fpi --new`.                             |
| Warnings about models in `enabledModels`   | Remove the missing patterns from `.pi/agent/settings.json`.                                 |
| `fpi-cost` says there is no key            | Run `/login` in pi, or ignore cost tracking if you do not use OpenRouter.                   |
| `fpi-impact` port is busy                  | Set `FPI_IMPACT_PORT` to another port.                                                      |
| Node is too old                            | `nvm install 24 && nvm use 24`; the launcher also checks common nvm locations.              |

## More

- Agent instructions: `.pi/agent/AGENTS.md`
- Optional macOS bootstrap: `./bin/bootstrap-mac.sh`
- Remote control and phone setup: `docs/remote-control.md`
- Local model providers: `docs/local-models.md`
- Upstream brayness instructions, preserved as an example:
  `docs/brayness-example-AGENTS.md`

## Provenance and license

Friendly Harness is built from Scott Fryxell's
[brayness](https://github.com/scott-fryxell/brayness), following his "The
Harness Is the Thing" workflow. The skills, extensions, and `bin/pi` originate
there. Git history starts fresh here; the credit is recorded in prose, and the
upstream agent instructions are preserved at
`docs/brayness-example-AGENTS.md`.

The main departure is layout: brayness nests projects inside the harness, while
Friendly Harness keeps them as siblings. That is why shared instructions live in
`.pi/agent/AGENTS.md` instead of a root `AGENTS.md`.

Friendly Harness is licensed under GPL-3.0-or-later. Third-party notices,
including brayness (ISC), pi (MIT), and the bundled skills and d3 files, are in
[`THIRD-PARTY.md`](THIRD-PARTY.md).
