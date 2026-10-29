#!/usr/bin/env bash
# fpi-common.sh - shared helpers for the Friendly Harness launchers.
# Sourced by bin/fpi and the thin bin/fpi-romp / bin/fpi-attach shims.
# Never run standalone.

set -euo pipefail

# --- roots ------------------------------------------------------------------
fh_init() {
    HARNESS_ROOT="${FH_HARNESS_ROOT:-${HARNESS_DIR:-$HOME/codetools/friendly-harness}}"
    CODE_ROOT="${FH_CODE_ROOT:-$HOME/codetools}"
    CODE_ROOT="${CODE_ROOT%/}"
    WORKTREE_ROOT="$CODE_ROOT/.worktrees"
    PI="$HARNESS_ROOT/bin/pi"
}

fh_require_pi() {
    [[ -x "$PI" ]] || { echo "Friendly Harness: missing launcher $PI" >&2; exit 1; }
}

fh_require_tmux() {
    command -v tmux >/dev/null 2>&1 || {
        echo "Friendly Harness: tmux is not installed." >&2
        echo "Install it first:  sudo apt install tmux" >&2
        return 1
    }
}

# Non-fatal tmux availability probe.
fh_have_tmux() { command -v tmux >/dev/null 2>&1; }

# --- budget gate -------------------------------------------------------------
# Wraps fpi-cost --warn semantics: warns past 75%, refuses (exit 1) past 100%
# unless FPI_ALLOW_OVER_BUDGET=1. Run once when creating a session, not on join.
fh_budget_gate() {
    local status=0
    "$HARNESS_ROOT/bin/fpi-cost" --warn || status=$?
    if [[ $status -eq 2 && -z "${FPI_ALLOW_OVER_BUDGET:-}" ]]; then
        echo "Refusing to start while over budget."
        exit 1
    fi
}

# --- project resolution ------------------------------------------------------
# Canonicalize a project arg: a name resolves under $CODE_ROOT; an absolute path
# may point anywhere on disk. Either way the path must already exist. Prints the
# canonical path.
fh_resolve_project() {
    local p="$1" abs=0
    [[ "$p" == /* ]] && abs=1
    [[ "$p" == /* ]] || p="$CODE_ROOT/$p"
    if [[ ! -d "$p" ]]; then
        echo "Friendly Harness: project does not exist: $p" >&2
        return 1
    fi
    p="$(cd "$p" && pwd -P)"
    case "$p" in
        "$CODE_ROOT"|"$CODE_ROOT"/*) ;;
        *)
            [[ "$abs" -eq 1 ]] || {
                echo "Friendly Harness: refusing to use a relative path outside $CODE_ROOT: $p" >&2
                return 1
            }
            ;;
    esac
    printf '%s\n' "$p"
}

# Stable project identity: path relative to $CODE_ROOT (e.g. my-app, acme/widget)
# for projects under it, ext@<hash> for anything outside. The digest keeps
# external projects out of the relative-path space and safe for .worktrees/.
fh_project_key() {
    local p="$1"
    case "$p" in
        "$CODE_ROOT"|"$CODE_ROOT"/*) printf '%s\n' "${p#"$CODE_ROOT"/}" ;;
        *) printf 'ext@%s\n' "$(fh_hash8 "$p")" ;;
    esac
}

# --- slugging ----------------------------------------------------------------
# One slug rule everywhere: lowercase, runs of non-[a-z0-9._-] become "-",
# collapsed and trimmed. Refuses to return empty.
fh_slug() {
    local s
    s="$(printf '%s' "$1" \
        | tr '[:upper:]' '[:lower:]' \
        | tr -c 'a-z0-9._-' '-' \
        | sed -E 's/-+/-/g; s/^-+//; s/-+$//')"
    [[ -n "$s" ]] || return 1
    printf '%s\n' "$s"
}

# 8-hex-char digest of a string, for short collision-resistant ids.
fh_hash8() {
    printf '%s' "$1" | cksum | awk '{ printf "%08x", $1 }'
}

# --- worktree naming ---------------------------------------------------------
fh_worktree_branch() { printf 'pi/%s\n' "$1"; }

fh_worktree_path() {
    # args: PROJECT_KEY TASK_SLUG
    printf '%s/%s/%s\n' "$WORKTREE_ROOT" "$1" "$2"
}

# --- tmux session identity ---------------------------------------------------
# Reusable, stable id so the same session is joinable from anywhere:
#   supervised: fh-<proj_slug>-<hash8>
#   worktree:   fh-<proj_slug>-<task_slug>-<hash8>
fh_session_id() {
    local mode="$1" project_key="$2" task_slug="${3:-}" proj digest
    proj="$(printf '%s' "$project_key" | tr -c '[:alnum:]._-' '-')"
    proj="${proj#-}"; proj="${proj%-}"
    if [[ "$mode" == worktree ]]; then
        digest="$(fh_hash8 "$project_key::$task_slug")"
        printf 'fh-%s-%s-%s' "$proj" "$task_slug" "$digest"
    else
        digest="$(fh_hash8 "$project_key")"
        printf 'fh-%s-%s' "$proj" "$digest"
    fi
}

# --- tmux markers + discovery ------------------------------------------------
# Mark sessions with tmux user options (@fh.*) so we can tell a Friendly Harness
# session apart from unrelated tmux windows and attach by project/task metadata
# rather than by matching a name. Markers survive detach/SSH because they live
# on the session.
fh_tmux_set_marker() {
    local session="$1"
    shift
    while [[ $# -gt 0 ]]; do
        tmux set-option -t "$session" -q "@fh.$1" "$2"
        shift 2
    done
}

fh_tmux_read_marker() {
    # args: SESSION KEY  -> value (empty if unset)
    tmux show-options -t "$1" -v "@fh.$2" 2>/dev/null || true
}

fh_tmux_is_harness() {
    [[ "$(fh_tmux_read_marker "$1" kind)" == friendly-harness ]]
}

# Session names on the default server. Empty (and exits 0) when no server runs.
fh_tmux_session_names() {
    tmux ls -F '#{session_name}' 2>/dev/null || true
}

# Print one line per running Friendly Harness session:
#   <session>|<mode>|<project_key>|<task_slug or ->|<attached 0/1>
fh_tmux_list_harness_sessions() {
    local s mode project task attached names
    names="$(fh_tmux_session_names)"
    [[ -n "$names" ]] || return 0
    while IFS= read -r s; do
        fh_tmux_is_harness "$s" || continue
        mode="$(fh_tmux_read_marker "$s" mode)"
        project="$(fh_tmux_read_marker "$s" project_key)"
        task="$(fh_tmux_read_marker "$s" task_slug)"
        attached="$(tmux display-message -p -t "$s" '#{session_attached}' 2>/dev/null)"
        printf '%s|%s|%s|%s|%s\n' "$s" "$mode" "$project" "${task:--}" "${attached:-0}"
    done <<<"$names"
}

# Print the session name(s) matching MODE + PROJECT_KEY (+ TASK_SLUG for
# worktrees). Empty when none. Used to re-join marked sessions whose name may
# predate the current naming, and to catch ambiguity.
fh_tmux_find_by_metadata() {
    local mode="$1" pkey="$2" tslug="${3:-}"
    local s m p t names
    names="$(fh_tmux_session_names)"
    [[ -n "$names" ]] || return 0
    while IFS= read -r s; do
        fh_tmux_is_harness "$s" || continue
        m="$(fh_tmux_read_marker "$s" mode)"
        p="$(fh_tmux_read_marker "$s" project_key)"
        t="$(fh_tmux_read_marker "$s" task_slug)"
        [[ "$m" == "$mode" && "$p" == "$pkey" ]] || continue
        if [[ "$mode" == worktree ]]; then [[ "$t" == "$tslug" ]] || continue; fi
        printf '%s\n' "$s"
    done <<<"$names"
}

# Create a detached tmux session running CMD (a single command string). The
# fallback shell only starts when CMD fails, so a crash is still inspectable;
# on a clean exit the window closes and the session ends, dropping you back
# to your own shell (no leftover "harness within a harness" prompt). The
# default tmux status bar is hidden too - these sessions are single-window
# and pi draws its own footer, so the green bar is just clutter.
fh_tmux_create() {
    # args: SESSION START_DIR COMMAND_STRING
    tmux new-session -d -s "$1" -c "$2" "$3 || exec ${SHELL:-bash}" \
        || { echo "Friendly Harness: failed to start tmux session" >&2; exit 1; }
    tmux set-option -t "$1" -q status off
}

fh_tmux_attach() {
    if [[ -n "${TMUX:-}" ]]; then
        exec tmux switch-client -t "$1"
    else
        exec tmux attach-session -t "$1"
    fi
}

# --- worktree helpers --------------------------------------------------------
# Carry gitignored project instruction files into a fresh worktree by copy, so
# edits stay isolated. Instruction files only - never .env or credentials.
fh_copy_instruction_files() {
    local project="$1" worktree="$2" f
    for f in AGENTS.md CLAUDE.md AGENTS.local.md .tooling.md; do
        if [[ -f "$project/$f" && ! -e "$worktree/$f" ]]; then
            cp "$project/$f" "$worktree/$f"
        fi
    done
}

# Give a brand-new project a root AGENTS.md. The harness keeps its shared
# instructions in .pi/agent/AGENTS.md, which pi does not find from a sibling
# project, so a new checkout needs its own starter file.
fh_seed_project_instructions() {
    local harness="$1" target="$2"
    [[ -f "$target/AGENTS.md" ]] && return 0
    if [[ -f "$harness/templates/AGENTS.md" ]]; then
        cp "$harness/templates/AGENTS.md" "$target/AGENTS.md"
    elif [[ -f "$harness/.pi/agent/AGENTS.md" ]]; then
        cp "$harness/.pi/agent/AGENTS.md" "$target/AGENTS.md"
    fi
}
