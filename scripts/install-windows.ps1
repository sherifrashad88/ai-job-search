# One-time installer for Windows 10/11.
# Run in PowerShell from the repo folder:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#
# What it does, in order (each step is skipped when already done):
#   1. Claude Code  - official installer (https://claude.ai/install.ps1)
#   2. Bun          - official installer (https://bun.sh/install.ps1), runs the job-board search tools
#   3. LaTeX        - asks first, installs MiKTeX with winget
#   4. Python packages pypdf + openpyxl, and the job-board tools' dev types
#   5. Keeps your copy private: renames the shared repo remote to "upstream"
#   6. Runs tools\doctor.py and prints your next step

$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..")
$Root = (Get-Location).Path

function Say($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Have($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.local\bin;$env:Path"
}

# Python: `py` launcher first, then python (never the Microsoft Store alias).
$Py = $null
foreach ($candidate in @("py", "python")) {
    if (Have $candidate) {
        & $candidate -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
        if ($LASTEXITCODE -eq 0) { $Py = $candidate; break }
    }
}
if (-not $Py) {
    Write-Host "Python 3.10+ is required. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run this script again."
    exit 1
}
if (-not (Have "git")) {
    Write-Host "Git is required. Run:  winget install --id Git.Git -e   then open a new PowerShell and run this script again."
    exit 1
}

Say "1/6 Claude Code"
if (Have "claude") { Write-Host "already installed: $(claude --version)" }
else { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; Refresh-Path }

Say "2/6 Bun"
if ((Have "bun") -or (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe")) { Write-Host "already installed" }
else { Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression }
Refresh-Path

Say "3/6 LaTeX (compiles your CV and cover letter to PDF)"
if ((Have "lualatex") -and (Have "xelatex")) { Write-Host "already installed" }
elseif (Have "winget") {
    $answer = Read-Host "LaTeX is missing. Install MiKTeX now with winget? [y/N]"
    if ($answer -match '^[yY]') {
        winget install --id MiKTeX.MiKTeX -e --accept-source-agreements --accept-package-agreements
        Refresh-Path
        Write-Host "Open 'MiKTeX Console' once and allow it to install missing packages automatically ('Always')."
    } else { Write-Host "Skipped. Install later from https://miktex.org/download (CVs cannot compile until then)." }
}
else { Write-Host "LaTeX is missing. Install MiKTeX from https://miktex.org/download" }

Say "4/6 Python packages and job-board tools"
& $Py -m pip install --user --quiet pypdf openpyxl
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed - run: $Py -m pip install --user pypdf openpyxl" }
& $Py tools\install_portal_clis.py

Say "5/6 Keeping your copy private"
$origin = git remote get-url origin 2>$null
if ($origin -match "github.com/sherifrashad88/ai-job-search") {
    git remote rename origin upstream
    git remote set-url --push upstream "DISABLED-shared-repo-never-push-your-profile"
    Write-Host "Renamed the shared repo remote to 'upstream'. Get updates later with:  git pull upstream"
} elseif (-not $origin) { Write-Host "No git remote (downloaded as ZIP?) - nothing to change." }
else { Write-Host "origin is $origin - leaving it. Make sure that repository is PRIVATE before pushing your profile." }
New-Item -ItemType Directory -Force -Path sponsor_raw | Out-Null

Say "6/6 Readiness check"
& $Py tools\doctor.py

Write-Host @"

Next step: open a NEW PowerShell window, then run

    cd "$Root"
    claude

Log in with your own Claude account when asked, then type:  /setup
Full guide: docs\friend-install-guide.md
"@
