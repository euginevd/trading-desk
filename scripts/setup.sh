#!/usr/bin/env bash
# One-time setup: installs the GitHub CLI, gitleaks, Trivy, lefthook, uv and Terraform if missing, then the
# Git hooks and the Python environment, and reports what the machine has. Windows (winget), macOS (Homebrew)
# and Linux (Homebrew, or checked downloads into ~/.local/bin, as in an agent's cloud container).
# Usage: bash scripts/setup.sh           install what's missing, then report
#        bash scripts/setup.sh --check   report only, changing nothing; exits 1 if something is missing
set -uo pipefail

case "${1:-}" in
  "" | --check) ;;
  *) echo "Usage: bash scripts/setup.sh [--check]"; exit 1 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Run this inside the repo, with git installed."; exit 1; }
cd "$root" || exit 1

# winget adds tools to the Windows user PATH, which an open shell doesn't see until it's reloaded.
reload_path() {
  command -v powershell.exe >/dev/null && command -v cygpath >/dev/null || return 0
  local user
  user=$(cygpath -p "$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')" | tr -d '\r')") || return 0
  export PATH="$PATH:$user"
}
reload_path

# The exact version the pipeline pins for a tool, read from the workflows.
exact() {
  case "$1" in
    gitleaks) grep -ho 'gitleaks/gitleaks:v[0-9.]*' .github/workflows/security.yml ;;
    trivy) grep -ho 'aquasec/trivy:[0-9.]*' .github/workflows/security.yml ;;
    uv) grep -ho 'astral-sh/uv:[0-9.]*' .github/workflows/ci.yml ;;
    terraform) grep -ho 'TF_VERSION: [0-9.]*' .github/workflows/aws.yml ;;
  esac 2>/dev/null | head -1 | grep -o '[0-9][0-9.]*$'
}

# Linux with no Homebrew, such as an agent's cloud container: the pipeline's own version of each tool, from
# its release page into ~/.local/bin, kept only if it matches the release's SHA-256.
fetch() {
  local cmd=$1 v arch base file sums want tmp bin="$HOME/.local/bin"
  mkdir -p "$bin" && export PATH="$bin:$PATH"
  case "$cmd" in
    gh) echo "Install gh by hand (https://cli.github.com); the rest carries on without it."; return 0 ;;
    # From PyPI, at least a week old (AGENTS.md rule 24).
    lefthook) uv tool install --quiet --exclude-newer "7 days" lefthook; return ;;
  esac
  v=$(exact "$cmd") || return 1
  arch=$(uname -m)
  case "$cmd-$arch" in
    gitleaks-x86_64) file="gitleaks_${v}_linux_x64.tar.gz" ;;
    gitleaks-aarch64) file="gitleaks_${v}_linux_arm64.tar.gz" ;;
    trivy-x86_64) file="trivy_${v}_Linux-64bit.tar.gz" ;;
    trivy-aarch64) file="trivy_${v}_Linux-ARM64.tar.gz" ;;
    terraform-x86_64) file="terraform_${v}_linux_amd64.zip" ;;
    terraform-aarch64) file="terraform_${v}_linux_arm64.zip" ;;
    uv-x86_64 | uv-aarch64) file="uv-$arch-unknown-linux-gnu.tar.gz" ;;
    *) echo "No download of $cmd for $arch: install it by hand."; return 1 ;;
  esac
  case "$cmd" in
    gitleaks) base="https://github.com/gitleaks/gitleaks/releases/download/v$v"; sums="gitleaks_${v}_checksums.txt" ;;
    trivy) base="https://github.com/aquasecurity/trivy/releases/download/v$v"; sums="trivy_${v}_checksums.txt" ;;
    terraform) base="https://releases.hashicorp.com/terraform/$v"; sums="terraform_${v}_SHA256SUMS" ;;
    uv) base="https://github.com/astral-sh/uv/releases/download/$v"; sums="$file.sha256" ;;
  esac
  tmp=$(mktemp -d) || return 1
  if ! curl -fsSL -o "$tmp/$file" "$base/$file" || ! curl -fsSL -o "$tmp/sums" "$base/$sums"; then
    echo "Could not download $cmd $v from $base."
    rm -rf "$tmp"; return 1
  fi
  want=$(grep -E "[ *]$file\$" "$tmp/sums" | awk '{print $1}')
  if [ -z "$want" ] || [ "$want" != "$(sha256sum "$tmp/$file" | awk '{print $1}')" ]; then
    echo "$cmd $v doesn't match its published checksum: not installed."
    rm -rf "$tmp"; return 1
  fi
  mkdir "$tmp/out"
  case "$file" in
    *.zip) python3 -m zipfile -e "$tmp/$file" "$tmp/out" ;;
    *) tar -xzf "$tmp/$file" -C "$tmp/out" ;;
  esac
  command install -m 755 "$(find "$tmp/out" -type f -name "$cmd" | head -1)" "$bin/$cmd"
  rm -rf "$tmp"
}

# Installs a tool with winget on Windows, Homebrew on macOS and Linux, or a checked download on Linux.
install() {
  local cmd=$1 winget_id=$2 brew_name=$3
  command -v "$cmd" >/dev/null && return 0
  if command -v winget >/dev/null; then
    winget install --id "$winget_id" --exact --accept-source-agreements --accept-package-agreements || return 1
    reload_path
  elif command -v brew >/dev/null; then
    brew install "$brew_name" || return 1
  elif [ "$(uname -s)" = Linux ]; then
    fetch "$cmd" || return 1
    [ "$cmd" = gh ] && return 0
  else
    echo "Install $cmd by hand from its website, then run this again."
    return 1
  fi
  command -v "$cmd" >/dev/null || { echo "$cmd installed: open a new terminal, then run this again."; return 1; }
}

# A tool's installed version as major.minor.
installed() {
  { "$1" --version 2>/dev/null || "$1" version 2>/dev/null; } | grep -Eo '[0-9]+\.[0-9]+' | head -1
}

# The major.minor the pipeline pins for a tool, read from the workflows; nothing for a tool it doesn't pin.
pinned() {
  case "$1" in
    gitleaks) grep -ho 'gitleaks/gitleaks:v[0-9]*\.[0-9]*' .github/workflows/security.yml ;;
    trivy) grep -ho 'aquasec/trivy:[0-9]*\.[0-9]*' .github/workflows/security.yml ;;
    uv) grep -ho 'astral-sh/uv:[0-9]*\.[0-9]*' .github/workflows/ci.yml ;;
    terraform) grep -ho 'TF_VERSION: [0-9]*\.[0-9]*' .github/workflows/aws.yml ;;
  esac 2>/dev/null | head -1 | grep -o '[0-9]*\.[0-9]*$'
}

# One line per thing the workflow needs. A version that differs from the pipeline's is a note, not a failure.
report() {
  local missing=0 tool have want
  line() { printf '  %-10s %s\n' "$1" "$2"; }
  for tool in git gh gitleaks trivy lefthook uv terraform; do
    if ! command -v "$tool" >/dev/null; then
      line "$tool" "MISSING"
      missing=$((missing + 1))
      continue
    fi
    have=$(installed "$tool")
    want=$(pinned "$tool")
    if [ -z "$have" ]; then
      line "$tool" "MISSING: found, but it doesn't run"
      missing=$((missing + 1))
    elif [ -n "$want" ] && [ "$have" != "$want" ]; then
      line "$tool" "$have, the pipeline uses $want: install $want with winget or brew"
    else
      line "$tool" "$have"
    fi
  done
  # Node and Docker only when an app needs them, and installed by hand: setup doesn't install them.
  local extra=()
  ls apps/*/package.json >/dev/null 2>&1 && extra+=(node npm)
  { ls apps/*/Dockerfile || ls docker-compose.yml; } >/dev/null 2>&1 && extra+=(docker)
  for tool in "${extra[@]}"; do
    if command -v "$tool" >/dev/null && [ -n "$(installed "$tool")" ]; then
      line "$tool" "$(installed "$tool")"
    else
      line "$tool" "MISSING: an app needs it; install it by hand"
      missing=$((missing + 1))
    fi
  done
  if command -v gh >/dev/null; then
    if gh auth status --hostname github.com >/dev/null 2>&1; then
      line "gh sign-in" "ok"
    else
      line "gh sign-in" "MISSING: not confirmed; run gh auth login, or check the network"
      missing=$((missing + 1))
    fi
  fi
  if grep -qs lefthook "$(git rev-parse --git-path hooks/pre-push)"; then
    line "push hook" "ok"
  else
    line "push hook" "MISSING: pushes from this clone aren't scanned"
    missing=$((missing + 1))
  fi
  if [ -f pyproject.toml ] && [ ! -d .venv ]; then
    line "python env" "MISSING"
    missing=$((missing + 1))
  fi
  return "$missing"
}

if [ "${1:-}" = --check ]; then
  echo "This machine:"
  report && { echo "Ready."; exit 0; }
  echo "Not ready: see MISSING above; bash scripts/setup.sh installs the tools, the hook and the Python environment."
  exit 1
fi

install gh GitHub.cli gh || exit 1
install gitleaks Gitleaks.Gitleaks gitleaks || exit 1
install trivy AquaSecurity.Trivy trivy || exit 1
install uv astral-sh.uv uv || exit 1
install lefthook evilmartians.lefthook lefthook || exit 1
install terraform Hashicorp.Terraform hashicorp/tap/terraform || exit 1
lefthook install || exit 1
[ -f pyproject.toml ] && { uv sync || exit 1; }

echo "This machine:"
report || { echo "Not ready: see MISSING above."; exit 1; }
echo "Done: the tools, the Git hooks and the Python environment are ready."
echo "Check the scan: bash .lefthook/pre-push-scan.sh"
