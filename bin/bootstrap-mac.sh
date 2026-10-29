#!/usr/bin/env bash
# Optional macOS bootstrap for Friendly Harness.
# Installs Homebrew, Node, and tmux, then prints the next step.
set -euo pipefail

skip_node=false
skip_tmux=false

usage() {
  echo "usage: $0 [--skip-node] [--skip-tmux]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-node) skip_node=true; shift ;;
    --skip-tmux) skip_tmux=true; shift ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

ensure_brew_on_path() {
  command -v brew >/dev/null 2>&1 && return 0
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return 0
  fi
  if [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
    return 0
  fi
  return 1
}

if ! ensure_brew_on_path; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ensure_brew_on_path || {
    echo "Homebrew installed but not on PATH; open a new terminal and retry." >&2
    exit 1
  }
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$repo_root/Brewfile" ]]; then
  brew bundle --file="$repo_root/Brewfile"
fi

if [[ "$skip_node" == false ]] && ! command -v node >/dev/null 2>&1; then
  brew install node
fi

if [[ "$skip_tmux" == false ]] && ! command -v tmux >/dev/null 2>&1; then
  brew install tmux
fi

cat <<'EOF'

bootstrap-mac: done.

Next:
  ./bin/pi /login     connect an AI provider
  ./bin/fpi --help    list the session launchers
EOF
