#!/usr/bin/env bash
# One-time installer for macOS (also works on Linux).
# Run from anywhere:   bash scripts/install-mac.sh
#
# What it does, in order (each step is skipped when already done):
#   1. Claude Code  - official installer (https://claude.ai/install.sh)
#   2. Bun          - official installer (https://bun.sh/install), runs the job-board search tools
#   3. LaTeX        - asks first (large download), via Homebrew on macOS
#   4. Python packages pypdf + openpyxl, and the job-board tools' dev types
#   5. Keeps your copy private: renames the shared repo remote to "upstream"
#   6. Runs tools/doctor.py and prints your next step
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
OS="$(uname -s)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

PY=""
for candidate in python3 python; do
  if have "$candidate" && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$candidate"; break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 or newer is required. Install it from https://www.python.org/downloads/ and run this script again."
  exit 1
fi

if ! have git; then
  echo "Git is required. On macOS run:  xcode-select --install   then run this script again."
  exit 1
fi

say "1/6 Claude Code"
if have claude; then
  echo "already installed: $(claude --version 2>/dev/null | head -1)"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
fi

say "2/6 Bun"
if have bun || [ -x "$HOME/.bun/bin/bun" ]; then
  echo "already installed"
else
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"

say "3/6 LaTeX (compiles your CV and cover letter to PDF)"
if have lualatex && have xelatex; then
  echo "already installed"
elif [ "$OS" = "Darwin" ] && have brew; then
  printf "LaTeX is missing. Install MacTeX via Homebrew now? It is a large download (~5 GB). [y/N] "
  read -r answer
  if [ "${answer:-n}" = "y" ] || [ "${answer:-n}" = "Y" ]; then
    brew install --cask mactex-no-gui && eval "$(/usr/libexec/path_helper)"
  else
    echo "Skipped. Install later from https://tug.org/mactex/ (CVs cannot compile until then)."
  fi
elif [ "$OS" = "Darwin" ]; then
  echo "LaTeX is missing. Download and run the MacTeX installer: https://tug.org/mactex/"
else
  echo "LaTeX is missing. Install with: sudo apt install texlive-luatex texlive-xetex texlive-latex-extra texlive-fonts-extra"
fi

say "4/6 Python packages and job-board tools"
"$PY" -m pip install --user --quiet pypdf openpyxl || echo "pip install failed - run: $PY -m pip install --user pypdf openpyxl"
"$PY" tools/install_portal_clis.py || echo "install_portal_clis.py reported a problem (the search tools still run with plain bun)"

say "5/6 Keeping your copy private"
origin="$(git remote get-url origin 2>/dev/null || true)"
case "$origin" in
  *github.com/sherifrashad88/ai-job-search*)
    git remote rename origin upstream
    git remote set-url --push upstream "DISABLED-shared-repo-never-push-your-profile"
    echo "Renamed the shared repo remote to 'upstream'. Get updates later with:  git pull upstream"
    ;;
  "") echo "No git remote (downloaded as ZIP?) - nothing to change." ;;
  *)  echo "origin is $origin - leaving it. Make sure that repository is PRIVATE before pushing your profile." ;;
esac
mkdir -p sponsor_raw

say "6/6 Readiness check"
"$PY" tools/doctor.py
cat <<EOF

Next step: open a NEW terminal window, then run

    cd "$ROOT"
    claude

Log in with your own Claude account when asked, then type:  /setup
Full guide: docs/friend-install-guide.md
EOF
