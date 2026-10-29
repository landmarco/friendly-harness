# Remote control: phone to desktop pi sessions

Control a Friendly Harness session from your phone, or from any other machine,
over SSH and tmux. The session survives disconnects, so you can start work at
the desk, detach, and pick it up later from a phone.

Two independent pieces:

1. **SSH + tmux** - a normal pi TUI that lives in a marked tmux session.
2. **Speech-to-text** - optional; local dictation on the laptop or phone.

## Prerequisites

On the desktop:

- a normal user account with a home directory
- OpenSSH server and tmux
- an SSH key on the phone or a way to generate one
- optional: Tailscale for a private network without port forwarding

The examples below are for Linux. On macOS, install tmux with Homebrew and
enable Remote Login in System Settings.

## One-time setup on the desktop

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install openssh-server tmux
sudo systemctl enable --now ssh

# Fedora
sudo dnf install openssh-server tmux
sudo systemctl enable --now sshd
```

Check that the server is running:

```bash
systemctl status ssh        # or sshd on Fedora
```

### Reach it safely

Tailscale is the simplest option: both devices join the same private tailnet,
and there is no public port to expose.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4             # e.g. 100.x.y.z
```

Accept the login prompt, install Tailscale on the phone, and sign in to the
same account. If you prefer a LAN address or a normal SSH port-forward, use
that instead; the rest of this page does not care.

### tmux config

pi uses modified Enter keys. Put this in `~/.tmux.conf`:

```tmux
set -g extended-keys on
set -g extended-keys-format csi-u
```

Reload tmux after editing:

```bash
tmux source-file ~/.tmux.conf
```

The `extended-keys-format` line needs tmux 3.5 or newer. On older tmux, drop
that line and reload.

### SSH key for the phone

Generate a key in the phone's SSH app (Blink, Termius, Termux, or similar) and
copy its public half to the desktop. On the desktop:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Append the phone's public key to `~/.ssh/authorized_keys`:

```bash
cat >> ~/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAA...your-phone-public-key... phone
EOF
```

Then restart SSH:

```bash
sudo systemctl restart ssh   # or sshd
```

Connect from the phone to `$USER@<tailscale-ip>` (or the tailnet hostname).
Accept the host-key prompt on the first connection.

## Daily use

Every `fpi` session runs in a marked tmux session, so all of them are
attachable from anywhere:

```bash
fpi --attach my-app             # join if running, else start a session there
fpi --worktree my-app fix-x     # join or start an isolated worktree
fpi --attach                    # menu of every running harness session
fpi --list                      # what is running
```

Legacy spellings still work:

```bash
fpi-attach my-app               # = fpi --attach my-app
fpi-attach -r my-app fix-x      # = fpi --worktree my-app fix-x
fpi-attach -l                   # = fpi --list
```

- Detach with `Ctrl+B`, then `D`. The session keeps running.
- Re-attach with the same command from any device.
- From inside tmux, `fpi --attach` switches the client instead of nesting.
- Phone keyboards often lack `Shift+Enter`; use the app's arrow-key row or
  send a single line and let pi work from it.

A detached pi session can keep spending tokens while it is mid-turn. An idle
session spends nothing. `fpi-cost` works from the phone too.

## Speech-to-text (optional)

Everything here runs locally; no audio goes to a cloud service.

**Laptop:** [SpeechNote](https://github.com/davzoman/speechnote) has a CLI
called `snapi` that wraps whisper.cpp. Download the latest release for your
platform, unpack it somewhere on `PATH`, then:

```bash
snapi models download large-v3
snapi tools speak
```

Dictation lands in the clipboard; paste into the pi editor. A smaller model
such as `large-v3-turbo` is faster on modest hardware.

**Phone:** the SpeechNote app is also available for iOS and Android. Dictate,
copy, and paste into the SSH terminal. It runs on the phone and needs no
account.

Quality is close to proprietary voice input for clean prose, but expect a
short delay instead of word-by-word streaming.

## Troubleshooting

- **`fpi-attach` says tmux is not installed**: install tmux and retry.
- **Session stuck**: `tmux kill-session -t <name>`; the next `fpi` starts
  fresh.
- **Phone cannot reach the desktop**: check both devices are on the same
  tailnet (`tailscale status`) and that SSH is running.
- **pi renders oddly in tmux**: check the extended-keys lines and your tmux
  version (`tmux -V`).
- **Keyboard shortcuts do not arrive**: use the app's "send Ctrl+..." menu;
  most mobile terminals have one.
