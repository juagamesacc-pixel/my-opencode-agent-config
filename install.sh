#!/usr/bin/env bash
#
# my-opencode-agent-config installer
#
# Usage:
#   ./install.sh [rulebook|config|full] [--yes]
#
#   rulebook   Provision bun (if missing) and install the rulebook CLI so
#              `rulebook` is callable from anywhere
#              (wrapper in ~/.local/bin or /usr/local/bin, plus bashrc PATH if needed).
#   config     Install the whole OpenCode config from this repo into
#              ~/.config/opencode (backs up an existing config first).
#   full       Do both rulebook + config. (default)
#   --yes      Skip all interactive prompts.
#
# bun provisioning (runs automatically when bun is not already installed):
#   - if `bun` is already on PATH or in a standard location -> no download, reuse it
#   - else if bin/bun-linux-aarch64-v1.4.2.tar.gz is bundled in this repo -> extract, no download
#   - else download the tarball from GitHub raw (prompts for consent; ~35 MB).
#     NOTE: repo is private, so the download needs a GitHub token (gh auth token
#     or $GITHUB_TOKEN); otherwise warn and skip.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
ASSUME_YES=0
MODE="full"
BIN_DIR=""

for a in "$@"; do
  case "$a" in
    rulebook|config|full) MODE="$a" ;;
    --yes|-y)             ASSUME_YES=1 ;;
    *) echo "Unknown arg: $a" >&2; exit 2 ;;
  esac
done

RED='\033[1;31m'; GRN='\033[1;32m'; YLW='\033[1;33m'; NC='\033[0m'
say()  { echo -e "${GRN}[install]${NC} $*"; }
warn() { echo -e "${YLW}[warn]${NC} $*"; }
die()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

confirm() { # $1 = prompt
  [ "$ASSUME_YES" -eq 1 ] && return 0
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" || "$ans" == "yes" ]]
}

# ---------------------------------------------------------------------------
# bun: locate, install (from repo tarball or GitHub download), or no-op
# ---------------------------------------------------------------------------
BUN_VERSION="1.4.2"
BUN_ARCH="aarch64"                      # this build: linux-aarch64
BUN_TARBALL="bun-linux-${BUN_ARCH}-v${BUN_VERSION}.tar.gz"
BUN_REPO_URL="https://raw.githubusercontent.com/juagamesacc-pixel/my-opencode-agent-config/main/bin/${BUN_TARBALL}"
BUN_INSTALL_DIR="$HOME/.bun/bin"
BUN_BIN=""

find_bun() {
  # 1) already on PATH
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
    return 0
  fi
  # 2) standard install locations
  for cand in "$HOME/.bun/bin/bun" /root/.bun/bin/bun /usr/local/bin/bun /usr/bin/bun /opt/bun/bin/bun; do
    if [ -x "$cand" ]; then
      BUN_BIN="$cand"
      return 0
    fi
  done
  return 1
}

install_bun() {
  if find_bun; then
    say "bun already available at $BUN_BIN — version $("$BUN_BIN" --version 2>/dev/null || echo '?')"
    return 0
  fi
  warn "bun not found on this system."

  local tarball_src=""
  # preferred: tarball bundled with the repo clone — no download
  if [ -f "$REPO_DIR/bin/$BUN_TARBALL" ]; then
    tarball_src="$REPO_DIR/bin/$BUN_TARBALL"
    say "Using bundled bun tarball from this repo (no download): bin/$BUN_TARBALL"
  else
    # fallback: download from GitHub raw (private repo needs a token)
    local gh_token="${GITHUB_TOKEN:-}"
    if [ -z "$gh_token" ] && command -v gh >/dev/null 2>&1; then
      gh_token="$(gh auth token 2>/dev/null || true)"
    fi
    if command -v curl >/dev/null 2>&1; then
      local dl=(curl -fL --progress-bar -o "$BUN_TARBALL" "$BUN_REPO_URL")
    elif command -v wget >/dev/null 2>&1; then
      local dl=(wget -q -O "$BUN_TARBALL" "$BUN_REPO_URL")
    else
      die "Neither curl nor wget available; cannot download bun. Get it from https://bun.sh/docs/installation"
    fi
    if [ -n "$gh_token" ]; then
      dl+=(-H "Authorization: token $gh_token")
    else
      warn "No GitHub token found (\$GITHUB_TOKEN or gh auth) — private-repo download will likely fail."
    fi
    if confirm "Download bun ${BUN_VERSION} from GitHub raw (~35 MB, mobile-data consent needed)? [y/N]"; then
      "${dl[@]}"
      tarball_src="$BUN_TARBALL"
    else
      warn "Skipped bun download — rulebook/plugin require bun. Install later via: bun install"
      return 1
    fi
  fi

  local tmpdir
  tmpdir="$(mktemp -d)"
  tar xzf "$tarball_src" -C "$tmpdir"
  mkdir -p "$BUN_INSTALL_DIR"
  mv "$tmpdir/bun" "$tmpdir/bunx" "$BUN_INSTALL_DIR/"
  rm -rf "$tmpdir"
  BUN_BIN="$BUN_INSTALL_DIR/bun"
  if [ -f "$BUN_TARBALL" ] && [ "$BUN_TARBALL" != "$REPO_DIR/bin/$BUN_TARBALL" ]; then rm -f "$BUN_TARBALL"; fi
  say "bun installed at $BUN_BIN — version $("$BUN_BIN" --version)"

  # ensure ~/.bun/bin is on PATH for future shells
  if ! grep -qE "PATH=.*.bun/bin" "$HOME/.bashrc" 2>/dev/null; then
    printf '\n# bun\n' >> "$HOME/.bashrc"
    printf 'export PATH="$HOME/.bun/bin:$PATH"\n' >> "$HOME/.bashrc"
    say "Added $HOME/.bun/bin to PATH in ~/.bashrc"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# bashrc: idempotently ensure the background-subagents flag (+ PATH for ~/.local/bin)
# ---------------------------------------------------------------------------
ensure_bashrc() {
  local rc="$HOME/.bashrc"
  [ -f "$rc" ] || touch "$rc"
  local changed=0

  if ! grep -qF "OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS" "$rc"; then
    printf '\n# opencode: enable background subagent lanes\n' >> "$rc"
    printf 'export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true\n' >> "$rc"
    changed=1
  fi
  if [ "$BIN_DIR" = "$HOME/.local/bin" ] && ! grep -qF "export PATH=\$HOME/.local/bin" "$rc" 2>/dev/null && ! grep -qE "PATH=.*\$HOME/.local/bin" "$rc" 2>/dev/null; then
    printf '\n# opencode: rulebook wrapper dir on PATH\n' >> "$rc"
    printf 'export PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    changed=1
  fi
  [ "$changed" -eq 1 ] && say "bashrc updated ($rc)" || say "bashrc already configured"
}

# ---------------------------------------------------------------------------
# rulebook CLI install
# ---------------------------------------------------------------------------
install_rulebook() {
  # bun is the preferred runtime for the rulebook MCP/CLI — provision it first
  if ! install_bun; then
    warn "Skipping rulebook install: bun unavailable and not downloaded."
    return 1
  fi

  if [ "$REPO_DIR" != "$CONFIG_DIR" ]; then
    say "Copying rulebook/ -> $CONFIG_DIR/rulebook/"
    mkdir -p "$CONFIG_DIR/rulebook"
    cp -f "$REPO_DIR"/rulebook/rulebook.ts    "$CONFIG_DIR/rulebook/"
    cp -f "$REPO_DIR"/rulebook/rulebook.py    "$CONFIG_DIR/rulebook/"
    [ -f "$REPO_DIR/rulebook/README.md"  ] && cp -f "$REPO_DIR"/rulebook/README.md  "$CONFIG_DIR/rulebook/" || true
    [ -f "$REPO_DIR/rulebook/rulebook.db" ] && cp -f "$REPO_DIR"/rulebook/rulebook.db "$CONFIG_DIR/rulebook/" || true
  else
    say "Repo is already the config dir; using in-place rulebook"
  fi
  local ts="$CONFIG_DIR/rulebook/rulebook.ts"
  local py="$CONFIG_DIR/rulebook/rulebook.py"
  [ -f "$ts" ] || [ -f "$py" ] || die "rulebook files not found in $CONFIG_DIR/rulebook/"

  # choose wrapper dir: prefer a dir already on PATH, else ~/.local/bin
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    BIN_DIR=/usr/local/bin
  else
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
  fi

  local wrapper="$BIN_DIR/rulebook"
  cat > "$wrapper" <<EOF
#!/usr/bin/env bash
# rulebook CLI wrapper (installed by my-opencode-agent-config/install.sh)
# Prefers bun (absolute path) because agent shell PATHs often lack python3.
RB_DIR="$CONFIG_DIR/rulebook"
BUN="$BUN_BIN"

if [ -x "\$BUN" ] && [ -f "\$RB_DIR/rulebook.ts" ]; then
  exec "\$BUN" "\$RB_DIR/rulebook.ts" "\$@"
elif command -v bun >/dev/null 2>&1 && [ -f "\$RB_DIR/rulebook.ts" ]; then
  exec "\$(command -v bun)" "\$RB_DIR/rulebook.ts" "\$@"
elif command -v python3 >/dev/null 2>&1 && [ -f "\$RB_DIR/rulebook.py" ]; then
  exec python3 "\$RB_DIR/rulebook.py" "\$@"
else
  echo "rulebook: neither bun nor python3 found, and/or rulebook files missing in \$RB_DIR" >&2
  exit 1
fi
EOF
  chmod +x "$wrapper"
  say "Installed 'rulebook' at $wrapper (bun-first)"
  ensure_bashrc

  # post-install sanity
  if command -v rulebook >/dev/null 2>&1; then
    say "OK: 'rulebook' resolves to $(command -v rulebook)"
  else
    warn "'rulebook' not on current PATH yet — open a new shell (or run: export PATH=\"\$HOME/.local/bin:\$PATH\")"
  fi
}

# ---------------------------------------------------------------------------
# config install (from a fresh clone into ~/.config/opencode)
# ---------------------------------------------------------------------------
install_config() {
  if [ "$REPO_DIR" = "$CONFIG_DIR" ]; then
    say "Repo IS the config dir — nothing to copy (you are already running it in place)."
    return 0
  fi

  local items=(opencode.jsonc opencode.jsonc.bak oh-my-opencode-slim.json tui.json \
               package.json package-lock.json oh-my-opencode-slim skills rulebook \
               .oh-my-opencode-slim .gitignore)
  local missing=()

  say "Installing config from $REPO_DIR -> $CONFIG_DIR"
  if [ -d "$CONFIG_DIR" ] && [ -n "$(ls -A "$CONFIG_DIR" 2>/dev/null)" ]; then
    local bak="$CONFIG_DIR.bak.$(date +%Y%m%d-%H%M%S)"
    if confirm "Existing config found at $CONFIG_DIR. Back it up to $bak and replace? [y/N]"; then
      mv "$CONFIG_DIR" "$bak"
      say "Backed up existing config to $bak"
    else
      die "Aborted by user."
    fi
  fi

  mkdir -p "$CONFIG_DIR"
  for it in "${items[@]}"; do
    if [ -e "$REPO_DIR/$it" ]; then
      cp -a "$REPO_DIR/$it" "$CONFIG_DIR/"
      say "  copied $it"
    else
      missing+=("$it")
    fi
  done
  [ ${#missing[@]} -gt 0 ] && warn "skipped (not in repo): ${missing[*]}"

  # node_modules: regenerate from package.json/lock (network needed)
  if [ -f "$CONFIG_DIR/package.json" ] && [ ! -d "$CONFIG_DIR/node_modules" ]; then
    if command -v npm >/dev/null 2>&1; then
      if confirm "node_modules missing. Run 'npm install' now (downloads packages)? [y/N]"; then
        ( cd "$CONFIG_DIR" && npm install --no-audit --no-fund ) || warn "npm install finished with issues"
      else
        warn "Skipped npm install — run 'cd $CONFIG_DIR && npm install' later."
      fi
    else
      warn "npm not available; install node deps later with: cd $CONFIG_DIR && npm install"
    fi
  fi

  ensure_bashrc
  say "Config installed at $CONFIG_DIR"
}

# ---------------------------------------------------------------------------
case "$MODE" in
  rulebook) install_rulebook ;;
  config)   install_bun || warn "bun unavailable; config installed but MCP/rulebook will need bun"
            install_config ;;
  # config first in full mode: installing rulebook first would create content in
  # CONFIG_DIR and make config-install treat the fresh dir as "existing config".
  full)     install_config; install_rulebook ;;
esac
say "Done."