#!/usr/bin/env bash
# =============================================================================
#  RAG LaunchPad — setup & launch
#  Usage:
#    First run:   ./start.sh --setup
#    Normal run:  ./start.sh
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; CRIMSON='\033[38;5;160m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}[•]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[!]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[✗]${RESET} $*"; exit 1; }
divider() { echo -e "${CRIMSON}────────────────────────────────────────────────${RESET}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/orchestrator"
FRONTEND_DIR="$SCRIPT_DIR/frontend"          # adjust if your frontend lives elsewhere
VENV_DIR="$SCRIPT_DIR/orchestrator/venv"
LOG_DIR="$SCRIPT_DIR/logs"
BACKEND_LOG="$LOG_DIR/orchestrator.log"
OLLAMA_LOG="$LOG_DIR/ollama.log"
PIDS_FILE="$SCRIPT_DIR/.pids"

mkdir -p "$LOG_DIR"

# =============================================================================
#  PREREQUISITES CHECK
# =============================================================================
check_prerequisites() {
  divider
  info "Checking prerequisites…"

  # Python 3.10+
  if ! command -v python3 &>/dev/null; then
    error "Python 3 not found. Install Python 3.10+ from https://python.org"
  fi
  PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
  PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
  if [[ "$PY_MAJOR" -lt 3 || ("$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10) ]]; then
    error "Python 3.10+ required (found $PY_VERSION). Please upgrade."
  fi
  success "Python $PY_VERSION"

  # Node / npm (for frontend)
  if ! command -v node &>/dev/null; then
    warn "Node.js not found — frontend dev server will not start."
    warn "Install from https://nodejs.org (v18+) or skip if using a built frontend."
    HAS_NODE=false
  else
    NODE_VERSION=$(node --version)
    success "Node $NODE_VERSION"
    HAS_NODE=true
  fi

  # Ollama — MUST be installed separately; not a pip package
  if ! command -v ollama &>/dev/null; then
    divider
    echo -e "${RED}${BOLD}  Ollama is not installed.${RESET}"
    echo ""
    echo -e "  Ollama is a ${BOLD}prerequisite${RESET} — it runs the local LLM server and"
    echo -e "  is NOT installed by pip. Install it first:"
    echo ""
    echo -e "  ${BOLD}macOS / Linux:${RESET}"
    echo -e "    curl -fsSL https://ollama.com/install.sh | sh"
    echo ""
    echo -e "  ${BOLD}Windows:${RESET}"
    echo -e "    Download the installer from https://ollama.com/download"
    echo ""
    echo -e "  Then re-run this script."
    divider
    exit 1
  fi
  OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
  success "Ollama ($OLLAMA_VERSION)"
}


# =============================================================================
#  SETUP  (run once with --setup)
# =============================================================================
setup() {
  divider
  info "Setting up Python virtual environment…"

  if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR"
    success "Virtual environment created at venv/"
  else
    info "Virtual environment already exists — skipping creation."
  fi

  # Activate
  VENV_PYTHON="$VENV_DIR/bin/python3"

  info "Installing Python dependencies…"
  "$VENV_PYTHON" -m pip install --upgrade pip --quiet
  "$VENV_PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt" --quiet
  success "Python dependencies installed."

  # Frontend
  if [[ "$HAS_NODE" == true && -f "$FRONTEND_DIR/package.json" ]]; then
    divider
    info "Installing frontend dependencies…"
    (cd "$FRONTEND_DIR" && npm install --silent)
    success "Frontend dependencies installed."
  fi

  divider
  success "Setup complete. Run ${BOLD}./start.sh${RESET} to launch."
}

# =============================================================================
#  START OLLAMA (if not already running)
# =============================================================================
start_ollama() {
  if curl -sf http://127.0.0.1:11434 &>/dev/null; then
    success "Ollama server already running."
    return 0
  fi

  info "Starting Ollama server…"
  ollama serve >> "$OLLAMA_LOG" 2>&1 &
  OLLAMA_PID=$!
  echo "ollama:$OLLAMA_PID" >> "$PIDS_FILE"

  # Wait up to 10 s for Ollama to be ready
  for i in $(seq 1 10); do
    if curl -sf http://127.0.0.1:11434 &>/dev/null; then
      success "Ollama server ready (pid $OLLAMA_PID)."
      return 0
    fi
    sleep 1
  done
  error "Ollama server did not start in time. Check $OLLAMA_LOG"
}

# =============================================================================
#  START BACKEND
# =============================================================================
start_backend() {
  divider
  info "Starting Orchestrator API (FastAPI)…"

  (
    cd "$BACKEND_DIR"
    "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port 8000 >> "$BACKEND_LOG" 2>&1
  ) &
  BACKEND_PID=$!
  echo "backend:$BACKEND_PID" >> "$PIDS_FILE"

  # Wait for it to be ready
  for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:8000/health &>/dev/null; then
      success "Orchestrator API ready at ${BOLD}http://127.0.0.1:8000${RESET} (pid $BACKEND_PID)"
      success "API docs at ${BOLD}http://127.0.0.1:8000/docs${RESET}"
      return 0
    fi
    sleep 1
  done
  error "Backend did not start in time. Check $BACKEND_LOG"
}

# =============================================================================
#  START FRONTEND
# =============================================================================
start_frontend() {
  if [[ "$HAS_NODE" != true ]]; then
    warn "Skipping frontend — Node.js not installed."
    return 0
  fi
  if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
    warn "No package.json found at $FRONTEND_DIR — skipping frontend."
    return 0
  fi

  divider
  info "Starting frontend dev server…"
  (
    cd "$FRONTEND_DIR"
    npm run dev >> "$LOG_DIR/frontend.log" 2>&1
  ) &
  FRONTEND_PID=$!
  echo "frontend:$FRONTEND_PID" >> "$PIDS_FILE"

  # Detect the port from npm dev output (Vite / Next.js both print it)
  for i in $(seq 1 15); do
    FRONTEND_URL=$(grep -oE 'http://localhost:[0-9]+' "$LOG_DIR/frontend.log" 2>/dev/null | head -1 || true)
    if [[ -n "$FRONTEND_URL" ]]; then
      success "Frontend ready at ${BOLD}$FRONTEND_URL${RESET} (pid $FRONTEND_PID)"
      return 0
    fi
    sleep 1
  done
  # Non-fatal — server may still be starting
  warn "Frontend server started (pid $FRONTEND_PID) — check $LOG_DIR/frontend.log for URL."
}

# =============================================================================
#  STOP  (cleanup on exit or ./start.sh --stop)
# =============================================================================
stop_all() {
  if [[ ! -f "$PIDS_FILE" ]]; then
    warn "No running services found (.pids file missing)."
    return 0
  fi

  info "Stopping all RAG LaunchPad services…"
  while IFS=: read -r name pid; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && success "Stopped $name (pid $pid)"
    fi
  done < "$PIDS_FILE"
  rm -f "$PIDS_FILE"
  success "All services stopped."
}

# =============================================================================
#  ENTRY POINT
# =============================================================================
divider
echo -e "${CRIMSON}${BOLD}"
echo "  ██████╗  █████╗  ██████╗      "
echo "  ██╔══██╗██╔══██╗██╔════╝      "
echo "  ██████╔╝███████║██║  ███╗     "
echo "  ██╔══██╗██╔══██║██║   ██║     "
echo "  ██║  ██║██║  ██║╚██████╔╝     "
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  LaunchPad"
echo -e "${RESET}"
divider

ARG="${1:-}"

case "$ARG" in
  --setup)
    check_prerequisites
    HAS_NODE=${HAS_NODE:-false}
    setup
    ;;
  --stop)
    stop_all
    ;;
  "")
    # Normal launch
    check_prerequisites

    # Clean up stale pids file from a previous run
    rm -f "$PIDS_FILE"

    # Trap Ctrl-C / exit to kill child processes
    trap 'echo ""; info "Shutting down…"; stop_all' INT TERM EXIT

    start_ollama
    start_backend
    start_frontend

    divider
    success "${BOLD}RAG LaunchPad is running!${RESET}"
    echo ""
    echo -e "  Backend API  →  ${BOLD}http://127.0.0.1:8000${RESET}"
    echo -e "  API docs     →  ${BOLD}http://127.0.0.1:8000/docs${RESET}"
    echo -e "  Ollama       →  ${BOLD}http://127.0.0.1:11434${RESET}"
    echo -e "  Logs         →  ${BOLD}$LOG_DIR/${RESET}"
    echo ""
    echo -e "  Press ${BOLD}Ctrl-C${RESET} to stop all services."
    divider

    # Keep the script alive so the trap fires on Ctrl-C
    wait
    ;;
  *)
    echo "Usage: $0 [--setup | --stop]"
    echo ""
    echo "  (no args)   Start all services"
    echo "  --setup     Create venv and install all dependencies (run once)"

    echo "  --stop      Stop all running services"
    exit 1
    ;;
esac
