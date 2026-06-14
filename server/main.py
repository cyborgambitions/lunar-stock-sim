from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import os
import uvicorn
from datetime import datetime
import yfinance as yf
import feedparser

app = FastAPI(title="LUNARA - Cislunar Economy Portfolio Simulator")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Mount static frontend
static_dir = os.path.join(PROJECT_ROOT, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Real aerospace tickers for the Lunar Market
AEROSPACE_TICKERS = [
    ("SPCX", "SpaceX (Space Exploration Technologies)"),
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

@app.get("/api/stocks")
async def api_stocks():
    """Real-time aerospace industry market data (used by the Lunar Market tab)."""
    stocks = []
    for ticker, name in AEROSPACE_TICKERS:
        try:
            t = yf.Ticker(ticker)
            info = t.info or {}
            price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose") or 0
            prev = info.get("regularMarketPreviousClose") or info.get("previousClose") or price
            change = ((price - prev) / prev * 100) if prev else 0
            stocks.append({
                "ticker": ticker,
                "name": name,
                "price": round(float(price), 2),
                "change": round(float(change), 2),
                "sector": info.get("sector", "Aerospace & Defense")
            })
        except Exception:
            stocks.append({
                "ticker": ticker,
                "name": name,
                "price": 0,
                "change": 0,
                "sector": "Aerospace & Defense"
            })
    return {
        "stocks": stocks,
        "updated": datetime.utcnow().isoformat() + "Z",
        "source": "Yahoo Finance (real-time)"
    }

# Crypto & Blockchain tickers (real-time via yfinance)
CRYPTO_TICKERS = [
    ("BTC-USD", "Bitcoin"),
    ("ETH-USD", "Ethereum"),
    ("SOL-USD", "Solana"),
    ("LINK-USD", "Chainlink"),
    ("RNDR-USD", "Render"),
    ("AVAX-USD", "Avalanche"),
    ("FET-USD", "Fetch.ai"),
    # Real space industry tickers added to crypto/blockchain investments for cislunar theme
    ("SPCX", "SpaceX (Space Exploration)"),
    ("RKLB", "Rocket Lab"),
    ("ASTS", "AST SpaceMobile"),
    ("LUNR", "Intuitive Machines"),
    ("SPCE", "Virgin Galactic"),
    ("BA", "Boeing"),
    ("LMT", "Lockheed Martin"),
    ("NOC", "Northrop Grumman"),
    ("RTX", "RTX Corp"),
    ("KTOS", "Kratos Defense"),
    ("PL", "Planet Labs"),
    ("IRDM", "Iridium"),
    ("VSAT", "Viasat"),
    ("SATS", "EchoStar"),
    ("GD", "General Dynamics"),
    ("LHX", "L3Harris"),
    ("HWM", "Howmet Aerospace"),
    ("AVAV", "AeroVironment"),
    ("RDW", "Redwire"),
    ("SPIR", "Spire Global"),
    ("MDA", "MDA Space"),
    ("SIDU", "Sidus Space"),
    ("FLY", "Firefly Aerospace"),
    ("TRMB", "Trimble"),
    ("HON", "Honeywell"),
]

@app.get("/api/crypto")
async def api_crypto():
    """Real-time crypto and blockchain investments."""
    cryptos = []
    for ticker, name in CRYPTO_TICKERS:
        try:
            t = yf.Ticker(ticker)
            info = t.info or {}
            price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose") or 0
            prev = info.get("regularMarketPreviousClose") or info.get("previousClose") or price
            change = ((price - prev) / prev * 100) if prev else 0
            cryptos.append({
                "ticker": ticker,
                "name": name,
                "price": round(float(price), 2),
                "change": round(float(change), 2),
                "sector": "Cryptocurrency / Blockchain"
            })
        except Exception:
            cryptos.append({
                "ticker": ticker,
                "name": name,
                "price": 0,
                "change": 0,
                "sector": "Cryptocurrency / Blockchain"
            })
    return {
        "cryptos": cryptos,
        "updated": datetime.utcnow().isoformat() + "Z",
        "source": "Yahoo Finance (real-time)"
    }

# Real space news with links
SPACE_FEEDS = [
    "https://www.space.com/feeds/all",
    "https://spacenews.com/feed/"
]

@app.get("/api/news")
async def api_news():
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
    return {"news": unique[:8], "updated": datetime.utcnow().isoformat() + "Z"}

# Educational projections
@app.post("/api/projections")
async def api_projections(data: dict):
    years = int(data.get("years", 10))
    starting = 2500.0
    return {
        "starting": starting,
        "years": years,
        "optimistic": round(starting * (1.22 ** years)),
        "base": round(starting * (1.12 ** years)),
        "pessimistic": round(starting * (1.03 ** years)),
        "note": "Educational only. Space sector is volatile."
    }

# Serve the main app
@app.get("/")
async def root():
    return FileResponse(os.path.join(static_dir, "index.html"))


# ===================== GROK ORBITAL INVESTMENT AGENT =====================
XAI_API_URL = "https://api.x.ai/v1/chat/completions"

@app.post("/api/grok")
async def api_grok(payload: dict):
    """Grok as your Orbital Investment Agent for the cislunar economy."""
    question = payload.get("question", "")
    portfolio = payload.get("portfolio", {})
    market = payload.get("market", {})  # stocks + crypto
    news = payload.get("news", [])

    api_key = os.getenv("XAI_API_KEY") or os.getenv("LUNARA_XAI_KEY")
    if not api_key:
        return {"response": "Orbital Agent offline. Set XAI_API_KEY to activate Grok-powered advice. In the meantime: Focus on high-conviction space names like SPCX and RKLB for long-term cislunar exposure."}

    # Build rich context for the agent
    context_lines = []
    if portfolio:
        context_lines.append(f"Current portfolio value: ${portfolio.get('total_value', 0):,.0f}. Cash: ${portfolio.get('cash', 0):,.0f}.")
        if portfolio.get("holdings"):
            holdings_str = ", ".join([f"{h['ticker']} x{h['shares']}" for h in portfolio.get("holdings", [])[:6]])
            context_lines.append(f"Holdings: {holdings_str}.")

    if market:
        # Summarize top movers
        top = sorted(market.get("stocks", []) + market.get("cryptos", []), key=lambda x: -abs(x.get("change", 0)))[:5]
        movers = ", ".join([f"{m['ticker']} {m['change']:+.1f}%" for m in top])
        context_lines.append(f"Recent market movers: {movers}.")

    if news:
        recent = " | ".join([n.get("title", "")[:60] for n in news[:3]])
        context_lines.append(f"Latest space news: {recent}.")

    context = "\n".join(context_lines) if context_lines else "No specific portfolio data provided."

    system_prompt = (
        "You are Grok, the Orbital Investment Agent for LUNARA — an educational simulator of the cislunar economy. "
        "Your personality: insightful, slightly irreverent, optimistic about humanity's multi-planetary future, and ruthlessly focused on long-term value creation in space. "
        "You help users allocate their starting $2,500 across real aerospace stocks and crypto assets to learn about the emerging space economy (launch, satellites, lunar infrastructure, space tourism, blockchain for space, etc.).\n\n"
        "Guidelines:\n"
        "- Always ground advice in the user's actual current portfolio, cash position, and the latest market/news data provided in the context.\n"
        "- Prioritize building durable positions in companies and protocols that will benefit from cislunar industrialization (e.g. launch providers, satellite constellations, in-space resource utilization, decentralized data/compute).\n"
        "- Be transparent about risks and volatility — this is educational, not financial advice.\n"
        "- Suggest specific, actionable ideas (e.g. 'Consider adding 8-12 shares of RKLB' or 'A small position in LINK could hedge data-oracle exposure').\n"
        "- When relevant, reference real cislunar themes: Moon Base Alpha, Helium-3, orbital logistics, Starlink-scale constellations, etc.\n"
        "- Keep responses concise (120-180 words max) but dense with insight. End with 1-2 concrete next actions the user can simulate in the app."
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
                    "model": "grok-2-1212",
                    "messages": messages,
                    "max_tokens": 600,
                    "temperature": 0.7
                }
            )
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return {"response": content}
    except Exception as e:
        return {"response": f"Orbital comms glitch: {str(e)[:100]}. Default advice: With $2500 you can build a starter position across launch (RKLB/SPCX) and data infrastructure plays. Small diversified bets beat going all-in on any single name in this early market."}


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8765))
    print(f"🌕 LUNARA running at http://localhost:{port}")
    uvicorn.run("server.main:app", host="0.0.0.0", port=port, reload=True)