# amazon-operator-stack — one-line installer (Windows PowerShell).
#
# Thin wrapper around the real wizard. Checks Node, runs npm install,
# then hands off to the Clack-based setup wizard.
#
# Usage:  .\install.ps1
#         (If PowerShell blocks the script, run it once with:
#          powershell -ExecutionPolicy Bypass -File .\install.ps1)

$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "amazon-operator-stack — installer" -ForegroundColor Cyan
Write-Host ""

# iCloud / OneDrive safety
if ($RepoDir -match "iCloud" -or $RepoDir -match "OneDrive") {
    Write-Host "Heads-up: this folder is inside a cloud sync directory." -ForegroundColor Yellow
    Write-Host "Cloud sync occasionally creates duplicate folders that break Node builds."
    Write-Host "Recommended: clone the repo to a local folder (e.g. C:\dev\)."
    Write-Host ""
    $continue = Read-Host "Continue anyway? [y/N]"
    if ($continue -ne "y" -and $continue -ne "Y") {
        Write-Host "Aborted. Move the folder and re-run."
        exit 0
    }
}

# Node version check
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCheck) {
    Write-Host "Node.js not found. Install Node 20+ from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}

$nodeVersion = (node -v) -replace 'v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Host "Node v$nodeVersion is too old. Install Node 20+ from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}
Write-Host "OK  Node v$nodeVersion" -ForegroundColor Cyan

# npm install
Write-Host "→  Installing dependencies..." -ForegroundColor Cyan
Set-Location $RepoDir
npm install --silent

# Hand off to the wizard
Write-Host ""
Write-Host "→  Starting the setup wizard..." -ForegroundColor Cyan
Write-Host ""
npm run setup
