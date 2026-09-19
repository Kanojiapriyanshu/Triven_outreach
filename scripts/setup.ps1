# Windows setup — equivalent of `make setup`.  Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -e .
try { .\.venv\Scripts\python.exe -m playwright install chromium } catch { Write-Warning "Chromium install failed — Maps scraping disabled until you run: .venv\Scripts\python -m playwright install chromium" }
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host "Created .env — fill in your Gmail App Passwords." }
.\.venv\Scripts\toe.exe init
.\.venv\Scripts\toe.exe doctor
Write-Host "`nDone. Try:  .venv\Scripts\toe seed ; .venv\Scripts\toe run --dry-run ; .venv\Scripts\toe dashboard"
