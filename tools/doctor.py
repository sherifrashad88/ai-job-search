#!/usr/bin/env python3
"""Readiness check for a fresh install: is this laptop ready to run the job search?

Run it from the repo root after downloading the repo, and again whenever
something stops working:

  python3 tools/doctor.py            # checklist with install hints for this OS
  python3 tools/doctor.py --fix      # also installs the Python packages and portal CLIs
  python3 tools/doctor.py --json     # machine-readable (used by /setup)

It only reads the machine and the repo. `--fix` runs exactly two installers:
`python -m pip install --user pypdf openpyxl` and `tools/install_portal_clis.py`.
It never installs system software (Claude Code, Bun, LaTeX, Git): those print
the official one-line installer for this OS instead. The scripts/ installers
do those.

Exit 0 when every required item passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYSTEM = platform.system()  # "Darwin", "Windows", "Linux"

HINTS = {
    "git": {
        "Darwin": "xcode-select --install   (or: brew install git)",
        "Windows": "winget install --id Git.Git -e   (Git for Windows also gives Claude Code its Bash shell)",
        "Linux": "sudo apt install git   (or your distro's package manager)",
    },
    "claude": {
        "Darwin": "curl -fsSL https://claude.ai/install.sh | bash",
        "Windows": "irm https://claude.ai/install.ps1 | iex   (in PowerShell)",
        "Linux": "curl -fsSL https://claude.ai/install.sh | bash",
    },
    "bun": {
        "Darwin": "curl -fsSL https://bun.sh/install | bash",
        "Windows": 'powershell -ExecutionPolicy Bypass -c "irm https://bun.sh/install.ps1 | iex"   (or: winget install Oven-sh.Bun)',
        "Linux": "curl -fsSL https://bun.sh/install | bash",
    },
    "latex": {
        "Darwin": "brew install --cask mactex-no-gui   (or the MacTeX installer from tug.org/mactex)",
        "Windows": "winget install MiKTeX.MiKTeX   (or the installer from miktex.org)",
        "Linux": "sudo apt install texlive-luatex texlive-xetex texlive-latex-extra texlive-fonts-extra",
    },
    "pdftotext": {
        "Darwin": "brew install poppler",
        "Windows": "choco install poppler",
        "Linux": "sudo apt install poppler-utils",
    },
}

PLACEHOLDER = re.compile(r"\[[A-Z][A-Z0-9_]{2,}\]")


def hint(key: str) -> str:
    return HINTS[key].get(SYSTEM, HINTS[key]["Linux"])


def run(cmd: list[str], timeout: int = 20) -> str | None:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None
    out = (proc.stdout or proc.stderr or "").strip()
    return out.splitlines()[0] if out else ""


def find_bun() -> str | None:
    found = shutil.which("bun")
    if found:
        return found
    # The official installer puts bun in ~/.bun/bin and only fixes PATH for new shells.
    home = Path.home() / ".bun" / "bin" / ("bun.exe" if SYSTEM == "Windows" else "bun")
    return str(home) if home.is_file() else None


def find_claude() -> tuple[bool, str]:
    """Is Claude Code usable here, and what to show for it.

    `shutil.which` only sees the CLI installer's binary. The desktop app ships
    its own copy outside PATH, so a friend who runs the job search from Claude
    Desktop (playbook section 6) would otherwise get a MISSING line that no fix
    command can ever clear.
    """
    path = shutil.which("claude")
    if path:
        return True, run([path, "--version"]) or "found"
    desktop = os.environ.get("CLAUDE_CODE_EXECPATH", "")
    if desktop and Path(desktop).is_file():
        return True, (run([desktop, "--version"]) or "found") + " (desktop app - not on PATH, which is fine)"
    if os.environ.get("CLAUDECODE") or os.environ.get("CLAUDE_CODE_ENTRYPOINT"):
        return True, "this check is running inside Claude Code"
    binary = "claude.exe" if SYSTEM == "Windows" else "claude"
    for candidate in (Path.home() / ".local" / "bin" / binary, Path.home() / ".claude" / "local" / binary):
        if candidate.is_file():
            return True, f"{candidate} (installed but not on PATH yet - open a new terminal)"
    return False, "not found"


def item(name, ok, required, detail, fix=None):
    return {"name": name, "ok": bool(ok), "required": required, "detail": detail, "fix": fix}


def check_tools() -> list[dict]:
    items = []
    version = sys.version_info
    items.append(item(
        "Python 3.10+", version >= (3, 10), True,
        f"Python {version.major}.{version.minor}.{version.micro}",
        "Install Python 3.10+ from python.org (Windows: tick 'Add python.exe to PATH')",
    ))
    git = shutil.which("git")
    items.append(item("Git", git, True, run([git, "--version"]) if git else "not found", hint("git")))
    claude_ok, claude_detail = find_claude()
    items.append(item(
        "Claude Code", claude_ok, True, claude_detail,
        hint("claude") + "  - then run `claude` once and log in with your own Claude Pro/Max account",
    ))
    bun = find_bun()
    detail = (run([bun, "--version"]) or "found") if bun else "not found"
    if bun and not shutil.which("bun"):
        detail += " (installed but not on PATH yet - open a new terminal)"
    items.append(item("Bun (job-board search tools)", bun, True, detail, hint("bun")))
    for engine in ("lualatex", "xelatex"):
        path = shutil.which(engine)
        items.append(item(
            f"LaTeX: {engine}", path, True,
            "found" if path else "not found - CVs and cover letters cannot compile to PDF",
            hint("latex"),
        ))
    pdftotext = shutil.which("pdftotext")
    items.append(item("pdftotext (optional ATS fallback)", pdftotext, False, "found" if pdftotext else "not found", hint("pdftotext")))
    for module, why, required in (
        ("pypdf", "ATS text check of the compiled CV", False),
        ("openpyxl", "importing the government sponsor .xlsx files", False),
    ):
        present = importlib.util.find_spec(module) is not None
        items.append(item(
            f"Python package: {module}", present, required,
            ("installed" if present else "missing") + f" - {why}",
            f"{sys.executable} -m pip install --user {module}   (or run this tool with --fix)",
        ))
    cli_dirs = sorted((ROOT / ".agents" / "skills").glob("*/cli/package.json"))
    missing = [p.parent.parent.name for p in cli_dirs if not (p.parent / "node_modules").is_dir()]
    items.append(item(
        "Job-board CLI dev types installed", not missing, False,
        "all installed" if not missing else f"not yet installed: {', '.join(missing)} (they still run with plain bun)",
        f"{Path(sys.executable).name} tools/install_portal_clis.py   (or run this tool with --fix)",
    ))
    return items


def check_workspace() -> list[dict]:
    items = []
    token = os.environ.get("JSEARCH_API_TOKEN")
    items.append(item(
        "JSearch API key (US job board)", token, False,
        "set" if token else "JSEARCH_API_TOKEN is not set - /scrape skips JSearch and uses LinkedIn/freehire only",
        "Get a free key on RapidAPI (search 'JSearch'), then set it permanently - see docs/friend-install-guide.md step 7",
    ))
    claude_md = ROOT / "CLAUDE.md"
    text = claude_md.read_text(encoding="utf-8") if claude_md.is_file() else ""
    profile = text.split("## Repo Structure", 1)[0]
    left = sorted(set(PLACEHOLDER.findall(profile)))
    items.append(item(
        "Profile filled in (/setup)", text and not left, False,
        "done" if text and not left else f"{len(left)} placeholder(s) left, e.g. {', '.join(left[:3])}",
        "Start Claude Code in this folder and type /setup",
    ))
    auth = re.search(r"### Work Authorization & Sponsorship\n(.*?)(\n## |\Z)", text, re.S)
    block = auth.group(1) if auth else ""
    needs = re.search(r"\*\*Needs employer sponsorship:\*\*\s*(\S+)", block)
    klass = re.search(r"\*\*Sponsor-data class:\*\*\s*(\w+)", block)
    needs_value = needs.group(1).lower() if needs else ""
    class_value = klass.group(1).lower() if klass else ""
    wants_data = needs_value in ("now", "future", "yes") and class_value in ("e3", "h1b", "h1b1")
    data = ROOT / "sponsor_data.json"
    if wants_data:
        items.append(item(
            f"Sponsor data for {class_value.upper()}", data.is_file(), False,
            "sponsor_data.json found" if data.is_file() else "profile needs sponsorship but sponsor_data.json is missing - the Sponsor Strength score is skipped",
            "Follow tools/README_SPONSOR_TOOL.md (download the DOL files into sponsor_raw/, then run the import command)",
        ))
    remotes = run(["git", "-C", str(ROOT), "remote", "-v"]) is not None
    origin = run(["git", "-C", str(ROOT), "remote", "get-url", "origin"]) if remotes else None
    shared = origin and "github.com/sherifrashad88/ai-job-search" in origin
    items.append(item(
        "Private by default (no push target to the shared repo)", not shared, False,
        "ok" if not shared else f"origin points at the shared public repo ({origin}) - your profile must never be pushed there",
        "git remote rename origin upstream   (the installer scripts do this; pull updates with: git pull upstream)",
    ))
    return items


def apply_fixes() -> list[str]:
    done = []
    missing = [m for m in ("pypdf", "openpyxl") if importlib.util.find_spec(m) is None]
    if missing:
        cmd = [sys.executable, "-m", "pip", "install", "--user", *missing]
        code = subprocess.call(cmd)
        done.append(f"{' '.join(cmd)} -> exit {code}")
    if find_bun():
        env = dict(os.environ)
        bun_dir = str(Path(find_bun()).parent)
        env["PATH"] = bun_dir + os.pathsep + env.get("PATH", "")
        cmd = [sys.executable, str(ROOT / "tools" / "install_portal_clis.py")]
        code = subprocess.call(cmd, env=env, cwd=str(ROOT))
        done.append(f"install_portal_clis.py -> exit {code}")
    else:
        done.append("skipped install_portal_clis.py: Bun is not installed yet")
    return done


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fix", action="store_true", help="install the Python packages and portal CLI dev types")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    fixes = apply_fixes() if args.fix else []
    tools = check_tools()
    workspace = check_workspace()
    required_ok = all(i["ok"] for i in tools + workspace if i["required"])
    result = {
        "os": SYSTEM,
        "ready": required_ok,
        "tools": tools,
        "workspace": workspace,
        "fixes_run": fixes,
    }
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if required_ok else 1

    for line in fixes:
        print(f"[fix] {line}")
    for title, group in (("Software", tools), ("Your workspace", workspace)):
        print(f"\n{title}")
        for i in group:
            mark = "OK  " if i["ok"] else ("MISSING" if i["required"] else "TODO")
            print(f"  [{mark:<7}] {i['name']}: {i['detail']}")
            if not i["ok"] and i["fix"]:
                print(f"            fix: {i['fix']}")
    print()
    if required_ok:
        print("Ready. Open Claude Code in this folder (type `claude`) and run /setup if you have not yet.")
    else:
        print("Not ready yet: install the MISSING items above, open a NEW terminal, and run this check again.")
    return 0 if required_ok else 1


if __name__ == "__main__":
    sys.exit(main())
