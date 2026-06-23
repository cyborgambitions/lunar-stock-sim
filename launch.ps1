<#
.SYNOPSIS
    Launches Lunara with Grok (xAI) integration.
.DESCRIPTION
    Sets the xAI API key (pre-configured) and starts the Lunara web app.
#>

# === LUNARA Launch Helper (Windows PowerShell) ===
#
# IMPORTANT: NEVER put your real XAI API key in this file!
# GitHub will block the push (Push Protection) and it's a security risk.
#
# How to use:
#   1. Set your key in the current terminal session first:
#        $env:XAI_API_KEY = "xai-your-real-key-here"
#
#   2. Then run one of:
#        . .\launch.ps1
#        grok
#
# This file is safe to commit.

function grok {
    [CmdletBinding()]
    param(
        [switch]$Terminal,
        [string]$LunaraPath = "C:\Users\MelG2\OneDrive\Documents\GitHub\Lunara"
    )

    if (-not $env:XAI_API_KEY -or $env:XAI_API_KEY -like "*PLACEHOLDER*") {
        Write-Host "ERROR: XAI_API_KEY not set in this session." -ForegroundColor Red
        Write-Host "Run this first (replace with your real key):" -ForegroundColor Yellow
        Write-Host '  $env:XAI_API_KEY = "xai-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"' -ForegroundColor Cyan
        Write-Host ""
        Write-Host "For Render: make sure XAI_API_KEY is set in the dashboard Environment variables." -ForegroundColor DarkGray
        return
    }

    if (-not (Test-Path $LunaraPath)) {
        Write-Host "Lunara directory not found at: $LunaraPath" -ForegroundColor Red
        return
    }

    Push-Location $LunaraPath

    Write-Host "LUNARA - Grok Orbital Agent ready." -ForegroundColor Green
    Write-Host ""

    try {
        if ($Terminal) {
            Write-Host "Starting terminal mode (if available)..." -ForegroundColor DarkGray
            # Terminal Rich version is optional / experimental.
            # Main experience is the web version.
            python -m server.main
        } else {
            Write-Host "Starting web server (http://localhost:8765)..." -ForegroundColor Cyan
            Write-Host "Open in browser and use the Grok Orbital Agent modal." -ForegroundColor DarkGray
            python -m server.main
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "LUNARA helper loaded." -ForegroundColor Green
Write-Host "Usage:" -ForegroundColor DarkGray
Write-Host "  . .\launch.ps1" -ForegroundColor White
Write-Host "  grok                 # web version (recommended)" -ForegroundColor White
Write-Host "  grok -Terminal       # terminal mode" -ForegroundColor White
Write-Host ""
Write-Host "Remember to set the key first: " -NoNewline -ForegroundColor Yellow
Write-Host '$env:XAI_API_KEY = "xai-..."' -ForegroundColor Cyan
