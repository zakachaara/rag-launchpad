#!/usr/bin/env bash
# =============================================================================
#  RAG LaunchPad — one-line installer
#
#  Run with:
#    curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/rag-launchpad/main/install.sh | sh
#
#  What it does:
#    1. Checks prerequisites (git, python 3.10+, node 18+, ollama)
#    2. Clones the repo into ~/rag-launchpad  (or the dir you set via INSTALL_DIR)
#    3. Creates a Python venv and installs backend deps
#    4. Installs frontend npm deps
#    5. Starts all services and prints the URLs
#
# =============================================================================

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/zakachaara/rag-launchpad.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rag-launchpad}"

# ── Colours (safe to use — every modern terminal supports ANSI) ──────────────
RED='\033[0;31m'; CRIMSON='\033[38;5;160m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[•]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${RESET} $*" >&2; exit 1; }
divider() { echo -e "${CRIMSON}────────────────────────────────────────────────${RESET}"; }

# ── Banner ───────────────────────────────────────────────────────────────────
divider
echo -e "${CRIMSON}${BOLD}"
echo "  ██████╗  █████╗  ██████╗  "
echo "  ██╔══██╗██╔══██╗██╔════╝  "
echo "  ██████╔╝███████║██║  ███╗ "
echo "  ██╔══██╗██╔══██║██║   ██║ "
echo "  ██║  ██║██║  ██║╚██████╔╝ "
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  LaunchPad installer"
echo -e "${RESET}"
divider

# ── Guard against placeholder URL ────────────────────────────────────────────
if [[ "$REPO_URL" == *"YOUR_USERNAME"* ]]; then
  error "Repo URL is still a placeholder.\nEdit REPO_URL in this script before publishing."
fi

# =============================================================================
#  1. PREREQUISITES
# =============================================================================
divider
info "Checking prerequisites…"

# git
if ! command -v git &>/dev/null; then
  error "git is not installed.\n  macOS:  xcode-select --install\n  Linux:  sudo apt install git  /  sudo dnf install git"
fi
success "git $(git --version | awk '{print $3}')"

# Python 3.10+
if ! command -v python3 &>/dev/null; then
  error "Python 3 not found. Install Python 3.10+ from https://python.org"
fi
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=${PY_VER%%.*}
PY_MINOR=${PY_VER##*.}
if [[ "$PY_MAJOR" -lt 3 || ( "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ) ]]; then
  error "Python 3.10+ required (found $PY_VER).\n  Download: https://python.org/downloads"
fi
success "Python $PY_VER"

# Node 18+ (non-fatal)
HAS_NODE=false
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | tr -d 'v')
  NODE_MAJOR=${NODE_VER%%.*}
  if [[ "$NODE_MAJOR" -ge 18 ]]; then
    success "Node v$NODE_VER"
    HAS_NODE=true
  else
    warn "Node v$NODE_VER found but 18+ is required — frontend will be skipped."
    warn "Install from https://nodejs.org"
  fi
else
  warn "Node.js not found — frontend dev server will not start."
  warn "Install from https://nodejs.org (v18+)"
fi

# Ollama
if ! command -v ollama &>/dev/null; then
  divider
  echo -e "${RED}${BOLD}  Ollama is not installed.${RESET}"
  echo ""
  echo -e "  Ollama runs the local LLM — it is ${BOLD}not${RESET} a Python package."
  echo ""
  echo -e "  ${BOLD}macOS / Linux:${RESET}"
  echo -e "    curl -fsSL https://ollama.com/install.sh | sh"
  echo ""
  echo -e "  ${BOLD}Windows:${RESET}"
  echo -e "    https://ollama.com/download"
  echo ""
  echo -e "  After installing Ollama, re-run this installer."
  divider
  exit 1
fi
success "Ollama $(ollama --version 2>/dev/null | head -1 || echo '(version unknown)')"

# =============================================================================
#  2. CLONE / UPDATE
# =============================================================================
divider
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Directory already exists — pulling latest changes…"
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  success "Updated to latest $BRANCH."
else
  info "Cloning $REPO_URL → $INSTALL_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  success "Cloned."
fi

# =============================================================================
#  3. PYTHON SETUP
# =============================================================================
divider
BACKEND_DIR="$INSTALL_DIR/orchestrator"
VENV_DIR="$BACKEND_DIR/venv"

# Call venv binaries directly — no `source activate` needed.
# This works whether the script is run via bash or piped through sh.
VENV_PYTHON="$VENV_DIR/bin/python3"

info "Creating Python virtual environment at $VENV_DIR …"
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
  success "Virtual environment created."
else
  info "Virtual environment already exists — skipping creation."
fi

# Verify the venv python is usable
if [[ ! -x "$VENV_PYTHON" ]]; then
  error "Virtual environment creation failed — $VENV_PYTHON not found."
fi
success "venv Python: $($VENV_PYTHON --version)"

info "Upgrading pip inside the virtual environment…"
"$VENV_PYTHON" -m pip install --upgrade pip --quiet

info "Installing Python dependencies…"
"$VENV_PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt" --quiet
success "Python dependencies installed."

# =============================================================================
#  4. FRONTEND SETUP
# =============================================================================
FRONTEND_DIR="$INSTALL_DIR/frontend"

if [[ "$HAS_NODE" == true && -f "$FRONTEND_DIR/package.json" ]]; then
  divider
  info "Installing frontend dependencies…"
  (cd "$FRONTEND_DIR" && npm install --silent)
  success "Frontend dependencies installed."
fi

# =============================================================================
#  5. HAND OFF TO start.sh
# =============================================================================
divider
success "Installation complete!"
echo ""
info "Launching RAG LaunchPad…"
echo ""

exec bash "$INSTALL_DIR/start.sh"
