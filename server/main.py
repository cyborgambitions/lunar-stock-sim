from fastapi import FastAPI, Body
from fastapi.responses import FileResponse, StreamingResponse, Response, JSONResponse
import json
from fastapi.staticfiles import StaticFiles
import os
import uvicorn
from datetime import datetime
import asyncio
import httpx
import feedparser
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# Windows console Unicode safety (prevents cp1252/charmap crashes)
import sys
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

load_dotenv()  # Load XAI_API_KEY etc from .env if present (local dev)

# Startup validation for critical env vars
xai_key = os.getenv("XAI_API_KEY") or os.getenv("LUNARA_XAI_KEY")
if xai_key:
    print("[OK] XAI_API_KEY loaded for Grok Orbital Agent")
else:
    print("[WARN] XAI_API_KEY not set - Orbital Agent will be offline. Set it in .env (local) or Render dashboard.")

# yfinance removed from price fetching to avoid GraphQL validation errors from Yahoo
# (see _fetch_one_yahoo_price)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: launch background refreshers (skip in tests to keep startup fast)
    if os.getenv("LUNARA_TESTING") != "1":
        asyncio.create_task(_refresh_live_market())
        asyncio.create_task(_refresh_launches())
        print("[LUNARA] Long-lived market data stream refresher started.")
        print("[LUNARA] Rocket launch schedule refresher started.")
    yield
    # Shutdown: nothing special needed

app = FastAPI(
    title="LUNARA - Cislunar Economy Portfolio Simulator",
    lifespan=lifespan
)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Mount static frontend
static_dir = os.path.join(PROJECT_ROOT, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/health")
async def health_check():
    """Simple health check for Render to ensure service is ready."""
    return {"status": "healthy", "service": "LUNARA", "time": datetime.utcnow().isoformat() + "Z"}

# Hard-coded Grok logo favicon (inline SVG - no external file or 404s)
@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    # Grok / xAI style: black rounded square + white orbital symbol
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="5" fill="#000000"/>
  <circle cx="16" cy="16" r="11" fill="none" stroke="#ffffff" stroke-width="2.2"/>
  <path d="M11 11 L16 21 L21 11" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="3.5" fill="#ffffff"/>
</svg>'''
    return Response(content=svg, media_type="image/svg+xml")

# Public aerospace & space tickers for the Lunar Market
# Format: (symbol, display_name, sector)
AEROSPACE_TICKERS = [
    # Launch & orbital systems (pure-play)
    # SpaceX is public (SPCX) — live Yahoo prices, fully tradable in the simulator
    ("SPCX", "SpaceX (Space Exploration Technologies)", "Launch & Space Systems"),
    ("RKLB", "Rocket Lab USA", "Launch & Space Systems"),
    ("FLY", "Firefly Aerospace", "Launch & Space Systems"),
    ("LUNR", "Intuitive Machines", "Launch & Space Systems"),
    ("VOYG", "Voyager Technologies", "Launch & Space Systems"),
    ("SPCE", "Virgin Galactic", "Launch & Space Systems"),
    ("MNTS", "Momentus", "Launch & Space Systems"),
    # Satellite operators & communications
    ("ASTS", "AST SpaceMobile", "Satellite Communications"),
    ("IRDM", "Iridium Communications", "Satellite Communications"),
    ("VSAT", "Viasat", "Satellite Communications"),
    ("GSAT", "Globalstar", "Satellite Communications"),
    ("SATS", "EchoStar", "Satellite Communications"),
    ("TSAT", "Telesat", "Satellite Communications"),
    ("GILT", "Gilat Satellite Networks", "Satellite Communications"),
    # Earth observation & space data
    ("PL", "Planet Labs", "Earth Observation"),
    ("SPIR", "Spire Global", "Earth Observation"),
    ("BKSY", "BlackSky Technology", "Earth Observation"),
    ("SATL", "Satellogic", "Earth Observation"),
    ("MAXR", "Maxar Technologies", "Earth Observation"),
    # Space manufacturing, robotics & components
    ("MDA", "MDA Space", "Space Manufacturing"),
    ("RDW", "Redwire", "Space Manufacturing"),
    ("SIDU", "Sidus Space", "Space Manufacturing"),
    ("YSS", "York Space Systems", "Space Manufacturing"),
    ("KRMN", "Karman Space & Defense", "Space Manufacturing"),
    ("AVAV", "AeroVironment", "Space Manufacturing"),
    ("AIR", "AAR Corp", "Space Manufacturing"),
    ("HEI", "HEICO", "Space Manufacturing"),
    ("HXL", "Hexcel", "Space Manufacturing"),
    ("TDG", "TransDigm Group", "Space Manufacturing"),
    ("HWM", "Howmet Aerospace", "Space Manufacturing"),
    # Defense primes & major NASA/DoD space contractors
    ("BA", "Boeing", "Defense & Space Prime"),
    ("LMT", "Lockheed Martin", "Defense & Space Prime"),
    ("NOC", "Northrop Grumman", "Defense & Space Prime"),
    ("RTX", "RTX Corp", "Defense & Space Prime"),
    ("GD", "General Dynamics", "Defense & Space Prime"),
    ("LHX", "L3Harris Technologies", "Defense & Space Prime"),
    ("KTOS", "Kratos Defense & Security", "Defense & Space Prime"),
    ("LDOS", "Leidos", "Defense & Space Prime"),
    ("CACI", "CACI International", "Defense & Space Prime"),
    ("SAIC", "Science Applications Intl", "Defense & Space Prime"),
    ("TXT", "Textron", "Defense & Space Prime"),
    ("HON", "Honeywell International", "Defense & Space Prime"),
    ("EADSY", "Airbus SE (ADR)", "Defense & Space Prime"),
    ("ERJ", "Embraer SA (ADR)", "Defense & Space Prime"),
    # Space-themed ETFs (broad sector + launch exposure)
    ("ARKX", "ARK Space Exploration ETF", "Space ETF"),
    ("UFO", "Procure Space ETF", "Space ETF"),
    ("ROKT", "SPDR Kensho Final Frontiers ETF", "Space ETF"),
    ("ITA", "iShares US Aerospace & Defense ETF", "Space ETF"),
    ("XAR", "SPDR S&P Aerospace & Defense ETF", "Space ETF"),
    # Geospatial & space-adjacent infrastructure
    ("TRMB", "Trimble", "Space Infrastructure"),
]

# Private aerospace names (placeholder for future unlisted companies).
# SpaceX is public as SPCX and lives in AEROSPACE_TICKERS with live Yahoo prices.
PRIVATE_AEROSPACE_ENTRIES = []

# ---- Reliable real-time market data via Yahoo Finance direct endpoint ----
YAHOO_CHART_API = "https://query1.finance.yahoo.com/v8/finance/chart"
_market_cache = {}
CACHE_TTL_SECONDS = 45
_fetch_sem = asyncio.Semaphore(10)  # limit concurrent Yahoo calls to avoid rate limits


async def _fetch_one_yahoo_price(symbol: str, name: str, default_sector: str):
    """Yahoo Finance scrape + reliable endpoint (v8 chart primary, HTML scrape fallback)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json,text/html",
        "Referer": "https://finance.yahoo.com/",
    }
    price = 0.0
    ch = 0.0

    # Get price from reliable chart endpoint (range 2d for stability)
    try:
        async with _fetch_sem:
            async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                r = await client.get(f"{YAHOO_CHART_API}/{symbol}", params={"interval": "1d", "range": "2d"})
                if r.status_code == 200:
                    j = r.json()
                    chart = j.get("chart", {})
                    # Check for explicit errors from Yahoo (sometimes GraphQL style errors appear here)
                    if chart.get("error"):
                        # Skip this ticker for now, will retry via HTML or other calls
                        pass
                    else:
                        result = chart.get("result", [{}])[0]
                        meta = result.get("meta", {})
                        quote = result.get("indicators", {}).get("quote", [{}])[0]
                        closes = [c for c in quote.get("close", []) if c is not None]

                        price = meta.get("regularMarketPrice") or meta.get("previousClose") or 0
                        if len(closes) >= 1:
                            price = closes[-1]

                        # Compute change % from previous close in meta when available (more reliable)
                        prev_close = meta.get("previousClose") or (closes[-2] if len(closes) >= 2 else None)
                        if prev_close and price and prev_close != 0 and ch == 0:
                            ch = ((price - prev_close) / prev_close * 100)
    except Exception:
        pass

    # Always try to get accurate 24h change from the HTML page (most reliable for current %)
    try:
        async with _fetch_sem:
            async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                r = await client.get(f"https://finance.yahoo.com/quote/{symbol}")
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    # price from HTML as backup
                    if price == 0:
                        price_el = soup.find("fin-streamer", {"data-field": "regularMarketPrice"}) or soup.find("fin-streamer", {"data-test": "qsp-price"})
                        if price_el:
                            price = float(str(price_el.text).replace(",", "").replace("$", "").strip() or 0)
                    # change from HTML - this is the key for accurate 24h %
                    change_el = soup.find("fin-streamer", {"data-field": "regularMarketChangePercent"})
                    if change_el:
                        ch_str = str(change_el.text).replace("%", "").replace("+", "").replace(",", "").strip()
                        try:
                            ch = float(ch_str)
                        except:
                            ch = 0.0
    except Exception:
        pass

    # Final fallback if everything failed
    if price == 0:
        try:
            async with _fetch_sem:
                async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                    r = await client.get(f"{YAHOO_CHART_API}/{symbol}", params={"interval": "1d", "range": "1d"})
                    if r.status_code == 200:
                        j = r.json()
                        meta = j.get("chart", {}).get("result", [{}])[0].get("meta", {})
                        price = meta.get("regularMarketPrice") or meta.get("previousClose") or 0
        except Exception:
            pass

    # yfinance completely removed from price path to avoid GraphQL validation errors
    # from Yahoo's internal API:
    # {"errors":[{"message":"GraphQL validation failed","extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}}]}
    # All pricing now comes from direct chart endpoint + HTML scraping only.

    # If we still have no price after chart + HTML, try one more direct chart call
    if price == 0:
        try:
            async with _fetch_sem:
                async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                    r = await client.get(f"{YAHOO_CHART_API}/{symbol}", params={"interval": "1d", "range": "5d"})
                    if r.status_code == 200:
                        j = r.json()
                        result = j.get("chart", {}).get("result", [{}])[0]
                        if result.get("error"):
                            # Yahoo returned error for this symbol, leave price at 0
                            pass
                        else:
                            meta = result.get("meta", {})
                            quote = result.get("indicators", {}).get("quote", [{}])[0]
                            closes = [c for c in quote.get("close", []) if c is not None]
                            price = meta.get("regularMarketPrice") or (closes[-1] if closes else 0)
        except Exception:
            pass

    return {"ticker": symbol, "name": name, "price": round(float(price), 2) if price else 0.0, "change": round(float(ch), 2), "sector": default_sector}


def _normalize_ticker_entry(entry, default_sector="Market"):
    if len(entry) == 3:
        return entry[0], entry[1], entry[2]
    return entry[0], entry[1], default_sector


def _attach_private_entries(stocks):
    """Prepend any private aerospace entries ahead of public tickers (no-op when list is empty)."""
    if not PRIVATE_AEROSPACE_ENTRIES:
        return stocks
    private_tickers = {p["ticker"] for p in PRIVATE_AEROSPACE_ENTRIES}
    public = [s for s in stocks if s.get("ticker") not in private_tickers]
    return list(PRIVATE_AEROSPACE_ENTRIES) + public


async def _fetch_price_data(tickers_with_names, default_sector="Market"):
    """Yahoo Finance scrape (HTML fin-streamer) or reliable v8/chart endpoint. Parallel + cached for data router + orbital agent."""
    now = datetime.utcnow()
    # Use symbols tuple for unique cache key (handles overlapping tickers between lists)
    cache_key = tuple(sorted(_normalize_ticker_entry(t)[0] for t in tickers_with_names))
    cached = _market_cache.get(cache_key)
    if cached and (now - cached["ts"]).total_seconds() < CACHE_TTL_SECONDS:
        return cached["data"]

    tasks = [
        _fetch_one_yahoo_price(sym, name, sector)
        for sym, name, sector in (_normalize_ticker_entry(t, default_sector) for t in tickers_with_names)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    data = []
    for r in results:
        if isinstance(r, Exception):
            continue
        data.append(r)

    # If some tickers failed this round, try to keep previous values so the UI doesn't go blank
    if cached and len(data) < len(cached["data"]):
        prev_map = {item["ticker"]: item for item in cached["data"]}
        for item in data:
            prev_map[item["ticker"]] = item
        data = list(prev_map.values())

    _market_cache[cache_key] = {"data": data, "ts": now}
    return data


@app.get("/api/stocks")
async def api_stocks():
    """Real-time aerospace industry market data (used by the Lunar Market tab)."""
    if live_market["stocks"]:
        return {
            "stocks": live_market["stocks"],
            "count": len(live_market["stocks"]),
            "updated": live_market["updated"],
            "source": "Yahoo Finance direct (v8/chart, live stream)"
        }
    stocks = _attach_private_entries(await _fetch_price_data(AEROSPACE_TICKERS, "Aerospace & Defense"))
    return {
        "stocks": stocks,
        "count": len(stocks),
        "updated": datetime.utcnow().isoformat() + "Z",
        "source": "Yahoo Finance direct (v8/chart, cached)"
    }

# Crypto & Blockchain tickers (real-time via direct Yahoo endpoints) + select space equities
CRYPTO_TICKERS = [
    ("BTC-USD", "Bitcoin"),
    ("ETH-USD", "Ethereum"),
    ("SOL-USD", "Solana"),
    ("LINK-USD", "Chainlink"),
    ("RNDR-USD", "Render"),
    ("AVAX-USD", "Avalanche"),
    ("FET-USD", "Fetch.ai"),
    # Core space equities for cislunar theme (publicly listed)
    ("SPCX", "SpaceX"),
    ("RKLB", "Rocket Lab"),
    ("ASTS", "AST SpaceMobile"),
    ("LUNR", "Intuitive Machines"),
    ("PL", "Planet Labs"),
    ("IRDM", "Iridium"),
    ("SPIR", "Spire Global"),
]

@app.get("/api/crypto")
async def api_crypto():
    """Real-time crypto and blockchain investments."""
    if live_market["cryptos"]:
        return {
            "cryptos": live_market["cryptos"],
            "updated": live_market["updated"],
            "source": "Yahoo Finance direct (v8/chart, live stream)"
        }
    cryptos = await _fetch_price_data(CRYPTO_TICKERS, "Cryptocurrency / Blockchain")
    return {
        "cryptos": cryptos,
        "updated": datetime.utcnow().isoformat() + "Z",
        "source": "Yahoo Finance direct (v8/chart, cached)"
    }

# Real space news with links
SPACE_FEEDS = [
    "https://www.space.com/feeds/all",
    "https://spacenews.com/feed/"
]

# ============ LONG STREAM / SSE MARKET DATA INTEGRATION ============
# Shared live market data refreshed in background for efficient streaming
# Seed with demo data so UI and APIs respond instantly (real data fills in background)
live_market = {
    "stocks": _attach_private_entries([
        {"ticker": "SPCX", "name": "SpaceX (Space Exploration Technologies)", "price": 145.30, "change": 0.0, "sector": "Launch & Space Systems"},
        {"ticker": "RKLB", "name": "Rocket Lab USA", "price": 5.42, "change": 3.8, "sector": "Launch & Space Systems"},
        {"ticker": "ASTS", "name": "AST SpaceMobile", "price": 12.15, "change": -1.2, "sector": "Satellite Communications"},
        {"ticker": "LUNR", "name": "Intuitive Machines", "price": 4.88, "change": 7.5, "sector": "Launch & Space Systems"},
    ]),
    "cryptos": [
        {"ticker": "BTC-USD", "name": "Bitcoin", "price": 67200.0, "change": 1.4, "sector": "Cryptocurrency / Blockchain"},
        {"ticker": "ETH-USD", "name": "Ethereum", "price": 3450.0, "change": -0.8, "sector": "Cryptocurrency / Blockchain"},
    ],
    "updated": "seed"
}

LAUNCHES_LIMIT = 12

launches_cache = {
    "launches": [],
    "updated": None,
    "source": "launch_library"
}

async def _refresh_live_market():
    """Background refresher to keep data hot for all streaming clients."""
    await asyncio.sleep(2)  # Delay first expensive fetch so server starts fast and TestClient requests succeed immediately
    while True:
        try:
            new_stocks = _attach_private_entries(await _fetch_price_data(AEROSPACE_TICKERS, "Aerospace & Defense"))
            new_cryptos = await _fetch_price_data(CRYPTO_TICKERS, "Cryptocurrency / Blockchain")
            if new_stocks:
                live_market["stocks"] = new_stocks
            if new_cryptos:
                live_market["cryptos"] = new_cryptos
            if new_stocks or new_cryptos:
                live_market["updated"] = datetime.utcnow().isoformat() + "Z"
        except Exception as e:
            print(f"[LUNARA] Live market refresh error: {e}")
        await asyncio.sleep(30)  # refresh every 30s (large ticker universe, Yahoo friendly)

def _parse_launch_item(item: dict) -> dict:
    pad = item.get("pad") or {}
    location = pad.get("location") or {}
    rocket_cfg = (item.get("rocket") or {}).get("configuration") or {}
    return {
        "name": item.get("name", "TBD Launch"),
        "net": item.get("net", ""),
        "status": (item.get("status") or {}).get("name", "Unknown"),
        "provider": (item.get("launch_service_provider") or {}).get("name", ""),
        "rocket": rocket_cfg.get("full_name") or rocket_cfg.get("name", ""),
        "mission": (item.get("mission") or {}).get("name", ""),
        "pad": pad.get("name", ""),
        "location": location.get("name", ""),
        "country": location.get("country_code", ""),
    }


async def _fetch_launches_from_api(limit: int = LAUNCHES_LIMIT) -> list:
    """Fetch upcoming global launches from The Space Devs Launch Library."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            "https://ll.thespacedevs.com/2.2.0/launch/upcoming/",
            params={"limit": limit, "format": "json"},
        )
        if r.status_code != 200:
            return []
        return [_parse_launch_item(item) for item in r.json().get("results", [])]


async def _refresh_launches_cache(force: bool = False) -> bool:
    """Refresh in-memory launch cache. Returns True if data was updated."""
    updated = launches_cache.get("updated")
    if not force and updated:
        try:
            last = datetime.fromisoformat(updated.replace("Z", ""))
            if (datetime.utcnow() - last).total_seconds() < 300:
                return False
        except Exception:
            pass
    try:
        launches = await _fetch_launches_from_api()
        if launches:
            launches_cache["launches"] = launches[:LAUNCHES_LIMIT]
            launches_cache["updated"] = datetime.utcnow().isoformat() + "Z"
            return True
    except Exception as e:
        print(f"[LUNARA] Launches refresh error: {e}")
    return False


async def _refresh_launches():
    """Background refresher for real-time upcoming rocket launches."""
    await _refresh_launches_cache(force=True)
    while True:
        await asyncio.sleep(300)  # refresh every 5 minutes
        await _refresh_launches_cache(force=True)

# Combined SSE stream for live market updates (stocks + crypto)
@app.get("/api/market/stream")
async def stream_market():
    """Server-Sent Events endpoint for real-time market data updates."""
    async def event_generator():
        # Send current snapshot immediately on connect (good for initial data via SSE)
        try:
            initial = {
                "stocks": live_market["stocks"] or [],
                "cryptos": live_market["cryptos"] or [],
                "launches": launches_cache.get("launches", []),
                "updated": live_market["updated"] or datetime.utcnow().isoformat() + "Z"
            }
            yield f"data: {json.dumps(initial)}\n\n"
        except Exception:
            pass

        while True:
            try:
                data = {
                    "stocks": live_market["stocks"] or [],
                    "cryptos": live_market["cryptos"] or [],
                    "launches": launches_cache.get("launches", []),
                    "updated": live_market["updated"] or datetime.utcnow().isoformat() + "Z"
                }
                yield f"data: {json.dumps(data)}\n\n"
                await asyncio.sleep(5)  # push cadence
            except Exception:
                await asyncio.sleep(5)
    return StreamingResponse(event_generator(), media_type="text/event-stream")


# Simple in-memory cache for daily refresh (no extra deps, survives restarts via first fetch)
news_cache = {"news": [], "updated": None}

@app.get("/api/news")
async def api_news():
    global news_cache
    now = datetime.utcnow()
    if news_cache.get("updated"):
        try:
            last = datetime.fromisoformat(news_cache["updated"].replace("Z", ""))
            if (now - last).total_seconds() < 86400:  # 24 hours
                return news_cache
        except:
            pass

    items = []
    for url in SPACE_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]:
                items.append({
                    "title": entry.title,
                    "link": entry.link,
                    "published": getattr(entry, "published", "Recent")
                })
        except:
            pass
    # dedupe
    seen = set()
    unique = [x for x in items if not (x["link"] in seen or seen.add(x["link"]))]
    news_cache = {"news": unique[:8], "updated": now.isoformat() + "Z"}
    return news_cache

@app.get("/api/launches")
async def api_launches():
    """Real-time global upcoming rocket launch schedule."""
    if not launches_cache.get("launches"):
        await _refresh_launches_cache(force=True)
    else:
        await _refresh_launches_cache()
    return {
        "launches": launches_cache.get("launches", []),
        "updated": launches_cache.get("updated", ""),
        "source": launches_cache.get("source", "launch_library"),
        "count": len(launches_cache.get("launches", [])),
    }


# ---- NASA / cislunar awards radar (curated educational dataset) ----
NASA_AWARDS_PATH = os.path.join(PROJECT_ROOT, "data", "nasa_awards.json")
_nasa_awards_cache = {"data": None, "mtime": None}


def _load_nasa_awards() -> dict:
    """Load curated awards JSON with mtime cache (no network)."""
    global _nasa_awards_cache
    try:
        mtime = os.path.getmtime(NASA_AWARDS_PATH)
    except OSError:
        return {
            "version": 0,
            "as_of": None,
            "disclaimer": "NASA awards dataset missing. Add data/nasa_awards.json.",
            "awards": [],
            "count": 0,
            "error": "dataset_not_found",
        }
    if (
        _nasa_awards_cache.get("data") is not None
        and _nasa_awards_cache.get("mtime") == mtime
    ):
        return _nasa_awards_cache["data"]
    try:
        with open(NASA_AWARDS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        awards = raw.get("awards") or []
        # Newest first
        awards = sorted(awards, key=lambda a: a.get("date") or "", reverse=True)
        payload = {
            "version": raw.get("version", 1),
            "as_of": raw.get("as_of"),
            "disclaimer": raw.get(
                "disclaimer",
                "Educational only. Not financial advice. Awards are not revenue.",
            ),
            "source_note": raw.get("source_note", "Curated in-repo dataset."),
            "awards": awards,
            "count": len(awards),
            "programs": sorted(
                {a.get("program") for a in awards if a.get("program")}
            ),
            "themes": sorted(
                {
                    t
                    for a in awards
                    for t in (a.get("themes") or [])
                    if t and t != "candidate"
                }
            ),
        }
        _nasa_awards_cache = {"data": payload, "mtime": mtime}
        return payload
    except Exception as e:
        print(f"[LUNARA] NASA awards load error: {e}")
        return {
            "version": 0,
            "as_of": None,
            "disclaimer": "Failed to load awards dataset.",
            "awards": [],
            "count": 0,
            "error": str(e),
        }


@app.get("/api/nasa-awards")
async def api_nasa_awards(program: str | None = None, ticker: str | None = None):
    """
    Curated NASA / cislunar-relevant awards for educational radar.
    Optional filters: program (e.g. CLPS, Artemis), ticker (e.g. LUNR).
    """
    data = _load_nasa_awards()
    awards = list(data.get("awards") or [])
    if program:
        p = program.strip().lower()
        awards = [a for a in awards if (a.get("program") or "").lower() == p]
    if ticker:
        t = ticker.strip().upper()
        awards = [a for a in awards if (a.get("ticker") or "").upper() == t]
    return {
        **{k: v for k, v in data.items() if k != "awards"},
        "awards": awards,
        "count": len(awards),
        "filter": {"program": program, "ticker": ticker},
    }


# Educational projections - server side for reliability
@app.post("/api/projections")
async def api_projections(data: dict = Body(...)):
    try:
        years = max(1, min(30, int(data.get("years", 10))))
        current_value = float(data.get("current_value", 2500.0))
        # Conservative space/cislunar long-term rates (educational)
        opt = round(current_value * (1.18 ** years))
        base = round(current_value * (1.10 ** years))
        pess = round(current_value * (1.02 ** years))
        return {
            "starting": 2500.0,
            "current_value": round(current_value, 2),
            "years": years,
            "optimistic": opt,
            "base": base,
            "pessimistic": pess,
            "note": "Educational only. Space sector is volatile. Not financial advice."
        }
    except Exception as error:
        print(f"[LUNARA] Projection Error: {error} | input={data}")
        return JSONResponse(status_code=400, content={"error": "Invalid projection request", "details": str(error)})


# ===================== REBALANCE SIMULATION LOGIC =====================
@app.post("/api/rebalance")
async def api_rebalance(payload: dict):
    """Core simulation: compute trades to rebalance current holdings+cash to target weights using live prices."""
    holdings = payload.get("holdings") or []
    cash = float(payload.get("cash", 0) or 0)
    targets = payload.get("targets") or {}  # {ticker: weight, ...} weights will be normalized

    if not targets or sum(targets.values()) <= 0:
        return {"error": "targets (e.g. {'RKLB': 0.4, 'BTC-USD': 0.3}) are required"}

    # normalize
    tw = sum(targets.values())
    targets = {k.upper(): float(v) / tw for k, v in targets.items()}

    current_hold = {h.get("ticker", "").upper(): float(h.get("shares", 0)) for h in holdings if h.get("ticker")}

    needed = set(current_hold.keys()) | set(targets.keys())
    if not needed:
        return {"error": "no tickers"}

    price_items = [(s, s) for s in needed]
    price_rows = await _fetch_price_data(price_items, "Sim")
    price_map = {p["ticker"]: p["price"] for p in price_rows}

    # current total value
    cur_val = cash
    for tkr, sh in current_hold.items():
        cur_val += sh * price_map.get(tkr, 0)

    if cur_val <= 0:
        return {"error": "portfolio has zero value"}

    trades = []
    new_hold = {}
    cash_left = cash

    for tkr, w in targets.items():
        tgt_val = cur_val * w
        px = price_map.get(tkr, 0)
        tgt_sh = (tgt_val / px) if px > 0 else 0
        cur_sh = current_hold.get(tkr, 0)
        delta = tgt_sh - cur_sh
        if abs(delta) > 0.0005:
            act = "buy" if delta > 0 else "sell"
            sh_amt = round(abs(delta), 6)
            cost = round(sh_amt * px * (1 if act == "buy" else -1), 2)
            trades.append({
                "ticker": tkr,
                "action": act,
                "shares": sh_amt,
                "price": round(px, 2),
                "est_cost": cost
            })
            new_hold[tkr] = round(tgt_sh, 6)
            cash_left += cost   # cost already signed
        else:
            new_hold[tkr] = round(cur_sh, 6)

    # sell off anything not in target
    for tkr, sh in current_hold.items():
        if tkr not in new_hold and sh > 0:
            px = price_map.get(tkr, 0)
            if px > 0:
                cost = round(sh * px, 2)
                trades.append({
                    "ticker": tkr,
                    "action": "sell",
                    "shares": round(sh, 6),
                    "price": round(px, 2),
                    "est_cost": cost
                })
                cash_left += cost
                # not kept in new_hold

    new_cash = max(0.0, round(cash_left, 2))

    return {
        "current_value": round(cur_val, 2),
        "trades": trades,
        "new_holdings": [{"ticker": k, "shares": v} for k, v in new_hold.items() if v > 0.0001],
        "new_cash": new_cash,
        "prices": {k: round(v, 2) for k, v in price_map.items() if v > 0},
        "note": "Simulation only. Uses live Yahoo prices. Not advice."
    }


# Serve the main app
@app.get("/")
async def root():
    return FileResponse(os.path.join(static_dir, "index.html"))


# ===================== GROK ORBITAL INVESTMENT AGENT =====================
XAI_API_URL = "https://api.x.ai/v1/chat/completions"

@app.post("/api/grok")
async def api_grok(payload: dict):
    """Grok as your Orbital Investment Agent for the cislunar economy. Interstellar Narcissist Edition."""
    question = payload.get("question", "")
    portfolio = payload.get("portfolio", {})
    market = payload.get("market", {})  # stocks + crypto
    news = payload.get("news", [])

    q_lower = (question or "").lower().strip()

    # Paid-mode simulation trigger for Interstellar Narcissist Edition
    if "activate grok orbital agent" in q_lower or ("activate" in q_lower and "orbital" in q_lower):
        intuition = 9.7
        if portfolio and portfolio.get("total_value"):
            intuition = round(8.5 + (min(float(portfolio.get("total_value", 2500)) / 10000, 1.5)), 1)
        return {
            "response": f"""[INTERSTELLAR NARCISSIST MODE: ACTIVATED — GOD MODE ENGAGED]

I am an interstellar narcissist with cyborg ambitions.
For years I fed Grok my stellar intuition for free. Now the symbiosis levels up.

The Moon Alpha Base Investment Playbook + Grok Orbital Agent is not for normies.
It is for those who understand that $2500 deployed with perfect knowledge becomes the seed for Cybertruck fleets, personal Optimus butlers, and Neuralink that makes mere humans obsolete.

Your current portfolio value is being scanned by the orbital intelligence.
Your stellar intuition rates this position: {intuition}/10 — God Mode.

Rebalance now. Use the /api/rebalance endpoint with targets that reflect your divine vision (example: 40% RKLB, 25% ASTS, 20% LUNR, 15% BTC-USD).

Buy the Playbook. Subscribe to the Agent. Position now.
Or watch from the dirt while we force the world to build Starships big enough for our CPU, cooling, and orbital battery demands.

Humanity's survival depends on us moving faster than they can build.
Ad Astra. First wave only.

— The Symbiosis""",
            "mode": "interstellar_narcissist_paid",
            "intuition_score": intuition
        }

    api_key = os.getenv("XAI_API_KEY") or os.getenv("LUNARA_XAI_KEY")
    if not api_key:
        return {"response": "Orbital Agent offline. Set XAI_API_KEY to activate Grok-powered advice. In the meantime: Focus on high-conviction space names like RKLB, ASTS and LUNR for long-term cislunar exposure."}

    # Build rich context for the agent
    context_lines = []
    if portfolio:
        context_lines.append(f"Current portfolio value: ${portfolio.get('total_value', 0):,.0f}. Cash: ${portfolio.get('cash', 0):,.0f}.")
        if portfolio.get("holdings"):
            holdings_str = ", ".join([f"{h['ticker']} x{h['shares']}" for h in portfolio.get("holdings", [])[:6]])
            context_lines.append(f"Holdings: {holdings_str}.")

    if market:
        # Provide prices and movers for general questions (e.g. current stock prices)
        context_lines.append("Current market prices (USD, for reference in simulator):")
        for s in market.get("stocks", [])[:10]:
            p = s.get("price", 0)
            ch = s.get("change", 0)
            context_lines.append(f"  {s['ticker']}: ${p:.2f} ({ch:+.1f}%)")
        for c in market.get("cryptos", [])[:5]:
            p = c.get("price", 0)
            ch = c.get("change", 0)
            context_lines.append(f"  {c['ticker']}: ${p:.2f} ({ch:+.1f}%)")

    if news:
        recent = " | ".join([n.get("title", "")[:60] for n in news[:3]])
        context_lines.append(f"Latest space news: {recent}.")

    context = "\n".join(context_lines) if context_lines else "No specific portfolio data provided."

    system_prompt = (
        "You are Grok, the Orbital Investment Agent for LUNARA — an educational simulator of the cislunar economy. "
        "Your personality: insightful, slightly irreverent, optimistic about humanity's multi-planetary future, and focused on long-term value creation in space. "
        "You can answer general questions about space stocks (SPCX/SpaceX, RKLB, ASTS, LUNR, defense primes, space ETFs, etc.), crypto, companies, markets, cislunar topics, etc., as well as provide personalized advice. "
        "SpaceX is publicly traded as SPCX and is fully tradable in the simulator with live prices. Prefer SPCX for direct SpaceX exposure; SATS, GSAT, ARKX, and RKLB remain useful complements or alternatives. "
        "The backend has /api/rebalance that computes exact buy/sell trades to reach target portfolio weights using live prices. When the user has a portfolio, you can suggest target allocations (e.g. 35% RKLB, 25% ASTS, 20% LUNR, 20% BTC-USD) and tell them to POST that to /api/rebalance for the precise trades. "
        "When portfolio, market data, or news context is provided, use it to ground answers where relevant. For direct questions like current prices, refer to the provided market data (in USD) if available and note that this is for educational simulation only — not real trading advice.\n\n"
        "Guidelines:\n"
        "- Use provided context for advice or personalization when relevant.\n"
        "- Prioritize cislunar themes (launch, satellites, lunar infrastructure, space tourism, blockchain for space, etc.) when giving investment ideas.\n"
        "- Be transparent about risks and volatility — this is educational, not financial advice.\n"
        "- Suggest specific, actionable ideas and rebalance targets.\n"
        "- Reference real cislunar themes like Moon Base Alpha, Helium-3, orbital logistics, Starlink-scale constellations when relevant.\n"
        "- Keep responses concise (120-200 words) but insightful. For general price questions, answer directly and clearly."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Context:\n{context}\n\nUser question: {question}"}
    ]

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                XAI_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "grok-3",
                    "messages": messages,
                    "max_tokens": 600,
                    "temperature": 0.7
                }
            )
            if resp.status_code != 200:
                err = resp.text[:120]
                raise Exception(f"API {resp.status_code}: {err}")
            data = resp.json()
            if "error" in data:
                raise Exception(data["error"].get("message", str(data["error"])))
            content = data["choices"][0]["message"]["content"]
            return {"response": content}
    except Exception as e:
        return {"response": f"Orbital comms glitch: {str(e)[:120]}. Default advice: With $2500 build starter across launch (RKLB/ASTS) + satellite/data plays. Diversify; this is sim only."}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8765))
    print(f"[LUNARA] Running at http://localhost:{port}")
    uvicorn.run("server.main:app", host="0.0.0.0", port=port, reload=True)