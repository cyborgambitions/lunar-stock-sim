<#
.SYNOPSIS
    Launches Lunara with Grok (xAI) integration.
.DESCRIPTION
    Sets the xAI API key (pre-configured) and starts the Lunara web app.
#>

# === YOUR ACTUAL XAI API KEY IS SET HERE (from your previous working setup) ===
# Replace the value below with your real key if it ever changes.
$env:XAI_API_KEY = "xai-n8BBtOAgq3EBrWc49LnnKcpQd9bMlSPwudSQFj4bHoRxaqQaY1sGzsanZmDAtSqv2SRO"
$env:LUNARA_XAI_KEY = $env:XAI_API_KEY

function grok {
    [CmdletBinding()]
    param(
        [switch]$Terminal,
        [string]$LunaraPath = "C:\Users\MelG2\OneDrive\Documents\GitHub\Lunara"
    )

    if (-not (Test-Path $LunaraPath)) {
        Write-Host "Lunara directory not found at: $LunaraPath" -ForegroundColor Red
        return
    }

    Write-Host "Using pre-configured xAI API key for Grok Orbital Advisor." -ForegroundColor Green

    Push-Location $LunaraPath
    Write-Host ""
    Write-Host "Launching Lunara with Grok Agent (full interface)..." -ForegroundColor Cyan

    try {
        if ($Terminal) {
            Write-Host "(Terminal mode)" -ForegroundColor DarkGray
            python main.py
        } else {
            Write-Host "(Web version - 3D Lunar Surface, Earthrise, Moon Base Alpha Art, Grok Orbit, Trading, etc.)" -ForegroundColor DarkGray
            Write-Host "Open http://localhost:8765 in your browser." -ForegroundColor DarkGray
            python -m server.main
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "grok command loaded. Type 'grok' to launch the full perfect interface." -ForegroundColor Green
Write-Host "Use 'grok -Terminal' for console mode." -ForegroundColor DarkGray
