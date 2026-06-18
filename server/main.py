from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import os
import uvicorn
from datetime import datetime
import asyncio
import httpx
import feedparser
from bs4 import BeautifulSoup

app = FastAPI(title="LUNARA - Cislunar Economy Portfolio Simulator")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Mount static frontend
static_dir = os.path.join(PROJECT_ROOT, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Real aerospace tickers for the Lunar Market
AEROSPACE_TICKERS = [
    ("RKLB", "Rocket Lab USA"),
    ("ASTS", "AST SpaceMobile"),
    ("LUNR", "Intuitive Machines"),
    ("SPCE", "Virgin Galactic"),
    ("BA", "Boeing"),
    ("LMT", "Lockheed Martin"),
    ("NOC", "Northrop Grumman"),
    ("RTX", "RTX Corp"),
    ("KTOS", "Kratos Defense & Security"),
    ("PL", "Planet Labs"),
    ("IRDM", "Iridium Communications"),
    ("VSAT", "Viasat"),
    ("SATS", "EchoStar"),
    ("GD", "General Dynamics"),
    ("LHX", "L3Harris Technologies"),
    ("HWM", "Howmet Aerospace"),
    ("AVAV", "AeroVironment"),
    ("RDW", "Redwire"),
    ("SPIR", "Spire Global"),
    ("MDA", "MDA Space"),
    ("SIDU", "Sidus Space"),
    ("FLY", "Firefly Aerospace"),
    ("TRMB", "Trimble"),
    ("HON", "Honeywell International"),
]

# ---- Reliable real-time market data via Yahoo Finance direct endpoint ----
YAHOO_CHART_API = "https://query1.finance.yahoo.com/v8/finance/chart"
_market_cache = {}
CACHE_TTL_SECONDS = 45
_fetch_sem = asyncio.Semaphore(6)  # limit concurrent Yahoo calls to avoid rate limits


async def _fetch_one_yahoo_price(symbol: str, name: str, default_sector: str):
    """Yahoo Finance scrape + reliable endpoint (v8 chart primary, HTML scrape fallback)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json,text/html",
        "Referer": "https://finance.yahoo.com/",
    }
    # Try reliable endpoint first
    try:
        async with _fetch_sem:
            async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                r = await client.get(f"{YAHOO_CHART_API}/{symbol}", params={"interval": "1d", "range": "1d"})
                if r.status_code == 200:
                    j = r.json()
                    meta = j.get("chart", {}).get("result", [{}])[0].get("meta", {})
                    price = meta.get("regularMarketPrice") or meta.get("previousClose") or 0
                    prev = meta.get("previousClose") or price
                    ch = ((price - prev) / prev * 100) if prev and price and prev != 0 else 0
                    return {"ticker": symbol, "name": name, "price": round(float(price), 2) if price else 0.0, "change": round(float(ch), 2), "sector": default_sector}
    except Exception:
        pass

    # Yahoo Finance scrape fallback (fin-streamer tags)
    try:
        async with _fetch_sem:
            async with httpx.AsyncClient(timeout=8.0, headers=headers, follow_redirects=True) as client:
                r = await client.get(f"https://finance.yahoo.com/quote/{symbol}")
                if r.status_code == 200:
                    soup = BeautifulSoup(r.text, "html.parser")
                    price_el = soup.find("fin-streamer", {"data-field": "regularMarketPrice"}) or soup.find("fin-streamer", {"data-test": "qsp-price"})
                    change_el = soup.find("fin-streamer", {"data-field": "regularMarketChangePercent"})
                    price = 0.0
                    if price_el:
                        price = float(str(price_el.text).replace(",", "").replace("$", "").strip() or 0)
                    ch = 0.0
                    if change_el:
                        ch_str = str(change_el.text).replace("%", "").replace("+", "").replace(",", "").strip()
                        try:
                            ch = float(ch_str)
                        except:
                            ch = 0.0
                    return {"ticker": symbol, "name": name, "price": round(price, 2), "change": round(ch, 2), "sector": default_sector}
    except Exception:
        pass

    return {"ticker": symbol, "name": name, "price": 0.0, "change": 0.0, "sector": default_sector}


async def _fetch_price_data(tickers_with_names, default_sector="Market"):
    """Yahoo Finance scrape (HTML fin-streamer) or reliable v8/chart endpoint. Parallel + cached for data router + orbital agent."""
    now = datetime.utcnow()
    # Use symbols tuple for unique cache key (handles overlapping tickers between lists)
    cache_key = tuple(sorted(t[0] for t in tickers_with_names))
    cached = _market_cache.get(cache_key)
    if cached and (now - cached["ts"]).total_seconds() < CACHE_TTL_SECONDS:
        return cached["data"]

    tasks = [
        _fetch_one_yahoo_price(ticker, name, default_sector)
        for ticker, name in tickers_with_names
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    data = []
    for r in results:
        if isinstance(r, Exception):
            continue
        data.append(r)

    _market_cache[cache_key] = {"data": data, "ts": now}
    return data


@app.get("/api/stocks")
async def api_stocks():
    """Real-time aerospace industry market data (used by the Lunar Market tab)."""
    stocks = await _fetch_price_data(AEROSPACE_TICKERS, "Aerospace & Defense")
    return {
        "stocks": stocks,
        "updated": datetime.utcnow().isoformat() + "Z",
        "source": "Yahoo Finance direct (v8/chart, cached)"
    }

# Crypto & Blockchain tickers (real-time via yfinance) + select space equities
CRYPTO_TICKERS = [
    ("BTC-USD", "Bitcoin"),
    ("ETH-USD", "Ethereum"),
    ("SOL-USD", "Solana"),
    ("LINK-USD", "Chainlink"),
    ("RNDR-USD", "Render"),
    ("AVAX-USD", "Avalanche"),
    ("FET-USD", "Fetch.ai"),
    # Core space equities for cislunar theme (real listed, not private)
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

# Educational projections - server side for reliability
@app.post("/api/projections")
async def api_projections(data: dict):
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
        "You can answer general questions about space stocks (RKLB, ASTS, LUNR, etc.), crypto, companies, markets, cislunar topics, etc., as well as provide personalized advice. "
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
    print(f"🌕 LUNARA running at http://localhost:{port}")
    uvicorn.run("server.main:app", host="0.0.0.0", port=port, reload=True)