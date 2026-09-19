# Windows equivalent of `make run` (dry) / `make live`.
#   powershell -File scripts\run.ps1          # dry mode
#   powershell -File scripts\run.ps1 -Live    # real sending (needs ALLOW_SENDING=true)
param([switch]$Live)
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Live) { .\.venv\Scripts\toe.exe run --live } else { .\.venv\Scripts\toe.exe run }
