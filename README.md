
# LUNARA — Cislunar Economy Portfolio Simulator

**LUNARA** is a free, fun, and educational web app that lets you simulate building a portfolio in the emerging cislunar (Earth-Moon) economy — starting with a realistic $2,500 (what most American families can afford to experiment with).

- Real-time aerospace & space industry market data (SPCX/SpaceX, RKLB, ASTS, LUNR, BA, LMT, etc.)
- Real-time crypto & blockchain investments (BTC, ETH, SOL, LINK, RNDR + space equities)
- Portfolio simulator with buy/sell, cash from "ground operations," and live P/L
- 10-year growth projections (optimistic / base / pessimistic) with interactive chart
- Real space news feed with direct article links
- **Alpha Base Book** — public read-only live view of the operator’s exact $2,500 allocation (Monday lock, live marks); share `#alpha-base-book`, clone into the personal sim
- Stunning 3D moon explorer (real NASA-derived textures)
- "Where to invest for real" with educational broker & exchange links
- Built for feedback & future monetization experiments

**Live demo (when deployed):** http://localhost:8765 (run locally)

## Quick Start (Local)

```bash
cd Lunara

# Install dependencies
pip install -r requirements.txt

# Set your xAI API key (optional but recommended for the Grok advisor)
export XAI_API_KEY="your_key_here"

# Run the app
python -m server.main
```

Open http://localhost:8765

The server has hot reload. The frontend is in `static/`.

### Alpha Base Book (Monday X ops)

Public read-only operator book for engagement. Data lives in `data/alpha_base_book.json`.

| Action | How |
|--------|-----|
| View | App section + deep link `#alpha-base-book` · API `GET /api/alpha-base-book` |
| Monday lock | Edit `data/alpha_base_book.json` (shares, cash, `week_of`, `as_of`, `thesis`, set `status` to `"live"`) and redeploy/commit |
| Remote publish | Optional: set env `ALPHA_BASE_BOOK_TOKEN`, then `PUT /api/alpha-base-book` with full book JSON + `"token"` |
| Clone | UI button copies the public book into the visitor’s personal localStorage sim |

Educational only — not advice. Seed holdings ship as `status: "seed"` until the first Monday lock.

### Catalyst Scoreboard (why each name is in)

Transparent thesis layer on every Alpha Base holding.

| Layer | Rule |
|-------|------|
| **Entry gate (5)** | Green=1 · Yellow=0.5 · Red=0. Must total **≥3** to enter as a lunar-ops name |
| **Q1** | Reduce cost / raise reliability of mass to the lunar surface? |
| **Q2** | Recurring revenue once the base is ops (not one-shot launch only)? |
| **Q3** | Clear customer with money allocated (NASA, DoD, constellation, hyperscale)? |
| **Q4** | Bottleneck tech that is hard to substitute? |
| **Q5** | Timeline in quarters, not “someday”? |
| **Weekly /10** | 4 tech/execution · 2 moat · 2 customer & capital · 1 Moon Alpha Base narrative · 1 timeline |
| **Sleeve** | e.g. BTC ballast — scored for transparency; entry gate does not apply |

Deep link: `#catalyst-scoreboard`. Scores live under each holding’s `catalyst` block in `alpha_base_book.json` (rescored weekly with the Monday lock). Operator judgment only — not ratings or advice.

### Friday P&L strip

Zero-fluff week bar on Alpha Base Book: **BOOK** · **SPY** · **UFO** (space ETF), bold %, relative magnitude bar, **vs SPY**.

| Source | How |
|--------|-----|
| Book % | Prefer `week_open.total_value` (set each Monday) vs live book value; else value-weighted 5d Yahoo returns |
| Benchmarks | Yahoo chart `range=5d` for SPY + UFO (cached ~5 min); **fail-open** — book still renders if Yahoo is slow; benchmarks warm in background |
| Seed marks | Until the market stream is warm (`updated != "seed"`), holdings mark at **cost** so the strip does not show a fake week move |

Educational only — not advice.

### Tailwind CSS
- Built locally to `static/css/tailwind.min.css` (no CDN in production).
- Run `.\rebuild-tailwind.ps1` (Windows) or the equivalent after adding classes.
- See `tailwind.config.js` and `static/css/input.css`.
- The standalone CLI binary (`tailwindcss.exe`) is gitignored; download from https://tailwindcss.com/docs/installation when needed.

## Deployment (Publish for Feedback)

### Recommended: Render.com (free tier works well)

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → New Web Service → connect your repo.
3. Use these settings:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn server.main:app --host 0.0.0.0 --port $PORT`
   - Add environment variable: `XAI_API_KEY` (your key)
4. Deploy. Your app will be live at `https://your-app.onrender.com`.

A `render.yaml` and `Procfile` are included for one-click / zero-config deploys.

Alternative platforms: Railway, Fly.io, or any service that supports Python web apps.

**Important for production:**
- Direct Yahoo endpoints can be rate-limited. We already have in-memory caching + semaphore.
- The current news fetch uses public RSS feeds — add caching or a small cache layer for production.

## Feedback

We built this to be educational and community-driven.

**Ways to give feedback (all implemented in the UI):**

- Use the **Feedback form** at the bottom of the app (powered by Formspree — just create a free form and update the action URL in `static/index.html`).
- Open an issue on GitHub (recommended for public discussion and feature requests).
- Email the maintainer (add your email in the form or README).

**Pro tip for better feedback:** The "Share your simulation" idea (copy current portfolio state) can be added easily — let us know if you want that feature.

## Monetization Options

LUNARA is intentionally designed to be **monetizable while staying mostly free and educational**.

### 1. Donations & Recurring Support (Easiest to start)
- GitHub Sponsors
- Buy Me a Coffee / Ko-fi
- Patreon (tiers for "early access to new assets", "name in the credits", etc.)

These are already linked in the Support section.

### 2. Affiliate / Referral Revenue (Already partially in place)
The "Where to invest for real?" section contains affiliate-friendly links:
- Brokers: Fidelity, Schwab, Vanguard
- Crypto: Coinbase, Binance.US, Kraken, Gemini

**Next steps for more revenue:**
- Sign up for their affiliate/referral programs (most pay per funded account or per trade).
- Add tracking parameters (e.g., `?ref=lunara`).
- Track clicks/conversions with a simple analytics pixel or Plausible.
- Add more verticals: hardware wallets (Ledger/Trezor), space-related newsletters, books, courses.

### 3. Premium Features (High potential)
Tease "Premium" in the UI (already in the Support section):
- Advanced Monte Carlo simulations
- Custom cislunar scenarios (e.g., Artemis delay, Helium-3 boom)
- Portfolio export (CSV/PDF)
- Ad-free experience
- "What-if" scenario builder
- Historical backtesting against real space events

Implement with Stripe Checkout (one-time or subscription). Keep core free.

### 4. Sponsorships & Brand Deals
- Feature "Sponsored by [Space Company]" or "Featured Cislunar Project".
- Sponsored news items or simulation scenarios.
- Newsletter (when you have one) with sponsorship slots.
- Target: space startups, defense contractors, crypto projects building in space/DeFi, education platforms.

### 5. Other Ideas
- Sell anonymized aggregate simulation data/insights (with consent).
- "LUNARA Pro for Educators" or classroom licenses.
- Merch (fun "I invested in the Moon" swag).
- White-label version for companies/educators.

### Recommended Path for v1 Public Launch
1. Deploy to Render/Railway (free).
2. Add a real Formspree form + GitHub link for feedback.
3. Add clear affiliate links + disclosure.
4. Add "Support Lunara" with GitHub Sponsors + BuyMeACoffee.
5. Launch on X, Reddit (r/space, r/investing, r/cryptocurrency), Hacker News, space Discords.
6. Collect feedback for 4–6 weeks.
7. Add first premium feature behind a paywall.

This keeps the spirit educational while creating sustainable revenue.

## Development Notes

- Real-time stock/crypto data via direct Yahoo Finance endpoints (much more stable, avoids yfinance GraphQL issues).
- News via public RSS feeds.
- Portfolio & projections are client-side (localStorage) for now — easy to make server-persisted later.
- 3D moon uses real NASA-derived textures.
- The "Lunar Market" tab shows real aerospace data; crypto section mixes real cryptos + space equities for educational cislunar flavor.

## License & Disclaimer

Educational use only. Not financial advice. All market data is for simulation.

---

**Next steps for you:**
- Replace the Formspree form ID in `static/index.html` (search for `YOUR_FORM_ID`).
- Set up a GitHub repo and add the Sponsors button.
- Deploy using the `render.yaml` (one-click on Render).
- Add your real affiliate links / tracking.

Want me to add Stripe checkout scaffolding, a "Share simulation" feature, better caching, or anything else before you publish? Just say the word. 

Let's get this in front of people and start getting feedback + early revenue experiments! 🌕

