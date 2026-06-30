#!/usr/bin/env python3
"""
LUNARA - Terminal Rich UI (main.py)
Simple terminal interface using Rich for the cislunar portfolio simulator.
Run: python main.py
For the full web UI use: python app.py  or python -m server.main
"""

import os
import sys
from pathlib import Path

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich import print as rprint
    HAS_RICH = True
except ImportError:
    HAS_RICH = False
    Console = None

PROJECT_ROOT = Path(__file__).parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

console = Console() if HAS_RICH else None

def cprint(msg, style=""):
    if HAS_RICH:
        rprint(f"[{style}]{msg}[/{style}]" if style else msg)
    else:
        print(msg)

def show_banner():
    if HAS_RICH:
        console.rule("[bold cyan]LUNARA — Cislunar Economy (Terminal)[/bold cyan]")
    else:
        print("=" * 50)
        print("LUNARA — Cislunar Economy (Terminal)")
        print("=" * 50)

def show_market_summary():
    """Show a quick summary. Tries live server, falls back to demo data."""
    cprint("\n[Market Snapshot]", "bold cyan")
    try:
        import requests
        r = requests.get("http://localhost:8765/api/stocks", timeout=3)
        if r.ok:
            data = r.json()
            stocks = data.get("stocks", [])[:6]
            if HAS_RICH:
                t = Table(title="Aerospace Stocks (live or last)")
                t.add_column("Ticker", style="bold")
                t.add_column("Price", justify="right")
                t.add_column("Change %", justify="right")
                for s in stocks:
                    ch = s.get("change", 0)
                    color = "green" if ch >= 0 else "red"
                    t.add_row(s["ticker"], f"${s.get('price', 0):.2f}", f"[{color}]{ch:+.2f}%[/]")
                console.print(t)
            else:
                for s in stocks:
                    print(f"  {s['ticker']}: ${s.get('price',0):.2f} ({s.get('change',0):+.2f}%)")
            return
    except Exception:
        pass

    # Fallback demo data
    demo = [
        {"ticker": "RKLB", "price": 5.42, "change": 3.8},
        {"ticker": "ASTS", "price": 12.15, "change": -1.2},
        {"ticker": "LUNR", "price": 4.88, "change": 7.5},
    ]
    if HAS_RICH:
        t = Table(title="Demo Aerospace (start server for live)")
        t.add_column("Ticker"); t.add_column("Price"); t.add_column("Change %")
        for s in demo:
            t.add_row(s["ticker"], f"${s['price']:.2f}", f"{s['change']:+.1f}%")
        console.print(t)
    else:
        for s in demo: print(f"  {s['ticker']}: ${s['price']:.2f} ({s['change']:+.1f}%)")

def main():
    show_banner()
    cprint("Terminal mode (Rich UI). For full interactive web experience run the server.", "dim")
    key = os.getenv("XAI_API_KEY")
    if key:
        cprint("[OK] XAI_API_KEY present", "green")
    else:
        cprint("[WARN] No XAI_API_KEY (Grok advisor disabled)", "yellow")
        cprint("  Set:  $env:XAI_API_KEY = 'xai-...'", "dim")

    show_market_summary()

    cprint("\nNext steps:", "bold")
    cprint("  Web UI:        python app.py     (or python -m server.main)", "cyan")
    cprint("  Debug agent:   python debug_agent.py", "cyan")
    cprint("  Help:          python debug_agent.py   (then type 'help' or 'quick')", "dim")
    cprint("\nOpen http://localhost:8765 in browser after starting web.", "green")

if __name__ == "__main__":
    main()
