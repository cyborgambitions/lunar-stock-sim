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
# Recommended for persistence:
#   Create a .env file in this folder (it is gitignored):
#     XAI_API_KEY=xai-your-real-key-here
#
#   The helper will load it automatically if $env:XAI_API_KEY is not already set.
#
# Alternative:
#   $env:XAI_API_KEY = "xai-..."
#
# Then: . .\launch.ps1 ; grok

# Auto-load XAI_API_KEY from .env if present and not already in env
if (-not $env:XAI_API_KEY) {
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*XAI_API_KEY\s*=\s*(.+)\s*$') {
                $env:XAI_API_KEY = $matches[1].Trim('"').Trim("'")
            }
        }
    }
}

function grok {
    [CmdletBinding()]
    param(
        [switch]$Terminal,
        [string]$LunaraPath = "C:\Users\MelG2\OneDrive\Documents\GitHub\Lunara"
    )

    if (-not $env:XAI_API_KEY -or $env:XAI_API_KEY -like "*PLACEHOLDER*") {
        Write-Host "ERROR: XAI_API_KEY not set." -ForegroundColor Red
        Write-Host "Options:" -ForegroundColor Yellow
        Write-Host "  1. Create .env in this folder with: XAI_API_KEY=xai-..." -ForegroundColor Cyan
        Write-Host "  2. Or set in this session: " -NoNewline -ForegroundColor Cyan
        Write-Host '$env:XAI_API_KEY = "xai-..."' -ForegroundColor Cyan
        Write-Host ""
        Write-Host "For Render: Set XAI_API_KEY in the Render dashboard (Environment variables)." -ForegroundColor DarkGray
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
Write-Host ""
Write-Host "Debug helper:   python debug_agent.py" -ForegroundColor DarkGray
Write-Host "  Commands: env | start | kill | port | sse | texture | git | push | grok | quick | diag" -ForegroundColor DarkGray
