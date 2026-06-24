#!/usr/bin/env python3
"""
Lunara Debug Agent for Terminals

An interactive terminal-based debug agent to help diagnose and fix
common issues with the Lunara app (server, SSE, assets, env, git, etc).

Run with:
    python debug_agent.py

Or add to PATH / alias.
"""

import os
import sys
import subprocess
import time
import json
from pathlib import Path

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich import print as rprint
    HAS_RICH = True
except ImportError:
    HAS_RICH = False
    def rprint(*args, **kwargs):
        print(*args)

console = Console() if HAS_RICH else None

PROJECT_ROOT = Path(__file__).parent.resolve()
STATIC_DIR = PROJECT_ROOT / "static"
TEXTURES_DIR = STATIC_DIR / "textures"
SERVER_MAIN = PROJECT_ROOT / "server" / "main.py"

def cprint(msg, style=""):
    if HAS_RICH:
        rprint(f"[{style}]{msg}[/{style}]" if style else msg)
    else:
        print(msg)

def header(title):
    if HAS_RICH:
        console.rule(f"[bold cyan]{title}[/bold cyan]")
    else:
        print(f"\n=== {title} ===")

def check_env():
    header("Environment Check")
    key = os.getenv("XAI_API_KEY", "")
    if key and key.startswith("xai-"):
        cprint(f"✓ XAI_API_KEY looks valid (length: {len(key)})", "green")
    else:
        cprint("✗ XAI_API_KEY not set or invalid!", "red")
        cprint("  Set it with:  $env:XAI_API_KEY = 'xai-...'", "yellow")

    cprint(f"Python: {sys.version.split()[0]}", "dim")
    cprint(f"Working dir: {PROJECT_ROOT}", "dim")

    # Check venv
    if (PROJECT_ROOT / "venv").exists():
        cprint("✓ venv folder present", "green")
    else:
        cprint("! No venv detected (using system python?)", "yellow")

def check_server():
    header("Server Status")
    try:
        import requests
        r = requests.get("http://localhost:8765/", timeout=3)
        cprint(f"✓ Server responding (HTTP {r.status_code})", "green")
        
        # Quick API check
        try:
            r2 = requests.get("http://localhost:8765/api/stocks", timeout=5)
            data = r2.json()
            cprint(f"✓ /api/stocks returned {len(data.get('stocks', []))} items", "green")
        except Exception as e:
            cprint(f"✗ /api/stocks failed: {e}", "red")
    except Exception as e:
        cprint(f"✗ Cannot reach http://localhost:8765 : {e}", "red")
        cprint("  Start with: python -m server.main   (after setting key)", "yellow")

def check_sse():
    header("SSE / Long Stream Test")
    cprint("The long stream is at: http://localhost:8765/api/market/stream", "dim")
    cprint("To test manually:", "dim")
    cprint("  curl -N http://localhost:8765/api/market/stream", "cyan")
    cprint("In browser DevTools, you should see a persistent connection.", "dim")

    try:
        import requests
        # Just check if endpoint exists and is streaming type
        r = requests.get("http://localhost:8765/api/market/stream", stream=True, timeout=4)
        content_type = r.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            cprint("✓ Endpoint returns text/event-stream", "green")
            # read a few lines
            lines = 0
            for line in r.iter_lines(decode_unicode=True):
                if line and lines < 2:
                    cprint(f"  Sample: {line[:80]}...", "dim")
                    lines += 1
                if lines >= 2:
                    break
            r.close()
        else:
            cprint(f"? Unexpected content-type: {content_type}", "yellow")
    except Exception as e:
        cprint(f"✗ SSE test failed: {e}", "red")

def check_assets():
    header("Assets & Textures")
    moon = TEXTURES_DIR / "moon_1024.jpg"
    if moon.exists():
        size = moon.stat().st_size / 1024
        cprint(f"✓ moon_1024.jpg present ({size:.1f} KB)", "green")
    else:
        cprint("✗ moon_1024.jpg MISSING!", "red")
        cprint("  Fix: mkdir -p static\\textures && curl -L -o static\\textures\\moon_1024.jpg https://threejs.org/examples/textures/planets/moon_1024.jpg", "yellow")

    if (STATIC_DIR / "index.html").exists():
        cprint("✓ static/index.html present", "green")
    else:
        cprint("✗ static/index.html missing", "red")

def git_info():
    header("Git Status")
    try:
        result = subprocess.run(["git", "status", "--short"], cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=5)
        if result.stdout.strip():
            cprint("Changes detected:", "yellow")
            cprint(result.stdout.strip())
        else:
            cprint("✓ Working tree clean", "green")

        result2 = subprocess.run(["git", "log", "--oneline", "-3"], cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=5)
        cprint("\nRecent commits:", "dim")
        cprint(result2.stdout.strip())
    except Exception as e:
        cprint(f"Git check failed: {e}", "red")

def test_apis():
    header("Quick API Tests")
    try:
        import requests
        for endpoint in ["/api/stocks", "/api/crypto", "/api/news"]:
            try:
                r = requests.get(f"http://localhost:8765{endpoint}", timeout=6)
                data = r.json()
                count = len(data.get("stocks", data.get("cryptos", data.get("news", []))))
                cprint(f"✓ {endpoint}: {r.status_code} ({count} items)", "green")
            except Exception as e:
                cprint(f"✗ {endpoint}: {e}", "red")
    except ImportError:
        cprint("Install requests: pip install requests", "yellow")

def diagnose():
    header("Full Diagnostics")
    check_env()
    check_server()
    check_assets()
    check_sse()
    git_info()

def show_fixes():
    header("Common Fixes")
    fixes = [
        ("Set key", '$env:XAI_API_KEY = "xai-..."'),
        ("Start server", "python -m server.main"),
        ("Hard refresh", "Ctrl + Shift + R in browser"),
        ("Missing texture", "Download moon_1024.jpg into static/textures/"),
        ("SSE not updating", "Check /api/market/stream in Network tab"),
        ("GraphQL error", "Fixed in latest - restart server"),
        ("JS errors", "Hard refresh + make sure no syntax errors"),
    ]
    for name, cmd in fixes:
        cprint(f"• {name}:", "bold")
        cprint(f"  {cmd}", "cyan")

def start_server():
    header("Start Server")
    key = os.getenv("XAI_API_KEY", "")
    if not key or not key.startswith("xai-"):
        cprint("ERROR: XAI_API_KEY not set!", "red")
        cprint('Run:  $env:XAI_API_KEY = "xai-..."', "yellow")
        return

    cprint("Attempting to start server...", "cyan")
    try:
        # Run in new window on Windows
        subprocess.Popen(
            [sys.executable, "-m", "server.main"],
            cwd=PROJECT_ROOT,
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        )
        cprint("Server starting in new console window...", "green")
        cprint("Give it a few seconds then check with 'server'", "dim")
    except Exception as e:
        cprint(f"Failed to auto-start: {e}", "red")
        cprint("Manual command:", "yellow")
        cprint("  python -m server.main", "cyan")

def kill_server():
    header("Kill Server Processes")
    try:
        if os.name == 'nt':
            # Windows
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True, timeout=5
            )
            lines = [l for l in result.stdout.splitlines() if ":8765" in l]
            pids = set()
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 5:
                    pids.add(parts[-1])
            if pids:
                for pid in pids:
                    subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
                cprint(f"Killed processes on port 8765: {', '.join(pids)}", "green")
            else:
                cprint("No process found listening on :8765", "yellow")
        else:
            subprocess.run(["pkill", "-f", "server.main"], check=False)
            cprint("Tried to kill server.main processes", "green")
    except Exception as e:
        cprint(f"Kill failed: {e}", "red")

def check_port():
    header("Port 8765 Status")
    try:
        result = subprocess.run(
            ["netstat", "-ano"], capture_output=True, text=True, timeout=5
        )
        lines = [l for l in result.stdout.splitlines() if ":8765" in l]
        if lines:
            cprint("Processes listening on port 8765:", "yellow")
            for line in lines:
                cprint("  " + line.strip())
        else:
            cprint("✓ Port 8765 is free", "green")
    except Exception as e:
        cprint(f"Port check failed: {e}", "red")

def download_texture():
    header("Download Moon Texture")
    moon_path = TEXTURES_DIR / "moon_1024.jpg"
    TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

    url = "https://threejs.org/examples/textures/planets/moon_1024.jpg"
    cprint(f"Downloading to {moon_path} ...", "cyan")

    try:
        import requests
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            moon_path.write_bytes(r.content)
            cprint(f"✓ Downloaded ({len(r.content)//1024} KB)", "green")
        else:
            cprint(f"Failed HTTP {r.status_code}", "red")
    except Exception:
        # Fallback to curl / PowerShell
        try:
            if os.name == 'nt':
                cmd = f'powershell -Command "Invoke-WebRequest -Uri \'{url}\' -OutFile \'{moon_path}\' -UseBasicParsing"'
                subprocess.run(cmd, shell=True, check=True)
                cprint("✓ Download attempted via PowerShell", "green")
            else:
                subprocess.run(["curl", "-L", "-o", str(moon_path), url], check=True)
                cprint("✓ Downloaded via curl", "green")
        except Exception as e:
            cprint(f"Download failed: {e}", "red")
            cprint("Manual: curl -L -o static/textures/moon_1024.jpg " + url, "yellow")

def safe_git_push():
    header("Safe Git Push")
    cprint("Checking for secrets before push...", "cyan")

    # Quick secret scan
    bad = []
    for root, _, files in os.walk(PROJECT_ROOT):
        for f in files:
            if f in ("launch.ps1", ".env"):
                path = os.path.join(root, f)
                try:
                    with open(path) as fh:
                        content = fh.read()
                        if "xai-" in content and "PLACEHOLDER" not in content:
                            bad.append(path)
                except:
                    pass

    if bad:
        cprint("⚠️  Possible secrets found in:", "red")
        for b in bad:
            cprint(f"   {b}", "red")
        cprint("Do NOT push until fixed!", "bold red")
        return

    cprint("✓ No obvious secrets detected in key files", "green")
    cprint("\nRecommended commands:", "dim")
    cprint("  git add .", "cyan")
    cprint("  git commit -m \"your message\"", "cyan")
    cprint("  git push", "cyan")
    cprint("\nIf you have a tag:", "dim")
    cprint("  git push origin v1.0.0", "cyan")

def test_grok():
    header("Grok Orbital Agent Test")
    key = os.getenv("XAI_API_KEY", "")
    if not key or not key.startswith("xai-"):
        cprint("Need XAI_API_KEY for Grok test", "yellow")
        return

    try:
        import requests
        r = requests.get("http://localhost:8765/", timeout=3)
        if r.status_code != 200:
            cprint("Server not running. Start it first.", "red")
            return

        # We can't easily call /api/grok without a real question + portfolio,
        # so just confirm the endpoint exists conceptually
        cprint("✓ Server is up. Grok endpoint should be available at /api/grok (POST)", "green")
        cprint("Open the web UI and try the Grok modal.", "dim")
    except Exception as e:
        cprint(f"Test failed: {e}", "red")

def quick_status():
    header("Quick Status")
    check_env()
    check_server()
    check_assets()
    cprint("\nTip: type 'diag' for full report", "dim")

def parse_command(text):
    text = text.lower().strip()
    if any(k in text for k in ["env", "key", "environment", "secret"]):
        return "env"
    if any(k in text for k in ["server", "running", "start", "launch"]):
        return "server"
    if any(k in text for k in ["kill", "stop", "terminate"]):
        return "kill"
    if any(k in text for k in ["port", "8765", "listening"]):
        return "port"
    if any(k in text for k in ["sse", "stream", "live", "long"]):
        return "sse"
    if any(k in text for k in ["asset", "texture", "moon", "download"]):
        return "assets"
    if any(k in text for k in ["git", "commit", "push"]):
        return "git"
    if any(k in text for k in ["api", "test", "stocks", "crypto"]):
        return "apis"
    if any(k in text for k in ["grok", "orbital"]):
        return "grok"
    if any(k in text for k in ["diag", "full", "all", "status"]):
        return "diag"
    if any(k in text for k in ["fix", "help", "common", "trouble"]):
        return "fixes"
    if any(k in text for k in ["quick", "summary"]):
        return "quick"
    return text

def interactive_agent():
    header("Lunara Debug Agent for Terminals")
    cprint("Interactive debug helper for the Lunara project.", "dim")
    cprint("Examples: 'env', 'start', 'kill', 'port', 'sse', 'texture', 'git push', 'grok', 'quick', 'quit'", "dim")

    commands = {
        "env": check_env,
        "server": check_server,
        "start": start_server,
        "kill": kill_server,
        "port": check_port,
        "sse": check_sse,
        "assets": check_assets,
        "texture": download_texture,
        "git": git_info,
        "push": safe_git_push,
        "apis": test_apis,
        "grok": test_grok,
        "quick": quick_status,
        "diag": diagnose,
        "fixes": show_fixes,
        "help": lambda: cprint("Try: env | server | start | kill | port | sse | texture | git | push | grok | quick | diag | fixes | quit"),
    }

    while True:
        try:
            raw = Prompt.ask("[bold]debug>[/bold]", default="diag")
            cmd = parse_command(raw)
            if cmd in ("quit", "exit", "q"):
                cprint("Goodbye! Remember to set your key and hard-refresh.", "green")
                break
            if cmd in commands:
                commands[cmd]()
            else:
                cprint("I didn't understand. Try 'help' or one of the keywords.", "yellow")
                commands["help"]()
        except KeyboardInterrupt:
            cprint("\nExiting debug agent...", "dim")
            break
        except Exception as e:
            cprint(f"Agent error: {e}", "red")

if __name__ == "__main__":
    interactive_agent()
