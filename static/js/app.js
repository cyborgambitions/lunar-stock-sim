// LUNARA - Cislunar Economy Portfolio Simulator
// Client-side simulation with real-time aerospace data

let portfolio = {
    cash: 2500,
    holdings: {} // { "RKLB": { shares: 10, avgPrice: 5.2 } }
};

let stocksData = [];
/** Market stream freshness: "seed" until Yahoo warm — Alpha Base ignores seed marks */
let marketStreamUpdated = 'seed';
let cryptoData = [];
let newsData = [];
let launchesData = [];
let nasaAwardsData = [];
let nasaAwardsMeta = { as_of: null, disclaimer: '', programs: [] };
let nasaAwardsProgramFilter = '';
/** @type {'' | 'portfolio'} special filter; empty string = all programs when program filter empty */
let nasaAwardsShowPortfolioOnly = false;
let lastPortfolioAwardKey = '';

/** Public operator book (Alpha Base Book) — read-only, Monday lock */
let alphaBaseBookData = null;

function portfolioHeldTickers() {
    const held = new Set();
    Object.entries(portfolio.holdings || {}).forEach(([ticker, holding]) => {
        if (holding && Number(holding.shares) > 0) held.add(ticker);
    });
    return held;
}

function portfolioTickerKey() {
    return [...portfolioHeldTickers()].sort().join(',');
}

function isTickerInPortfolio(ticker) {
    if (!ticker) return false;
    const h = portfolio.holdings && portfolio.holdings[ticker];
    return !!(h && Number(h.shares) > 0);
}

function refreshNasaAwardsIfPortfolioChanged() {
    const key = portfolioTickerKey();
    if (key === lastPortfolioAwardKey) return;
    lastPortfolioAwardKey = key;
    if (!nasaAwardsData.length) return;
    renderNasaAwards();
    renderNasaAwardFilters(nasaAwardsMeta.programs || []);
}

function formatMoney(amount) {
    return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 0 });
}

function formatMoneyExact(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function livePriceForTicker(ticker) {
    // Do not re-mark the public book from demo seed prices (wrong levels → fake week P&L)
    if (marketStreamUpdated === 'seed') return null;
    const t = (ticker || '').toUpperCase();
    const s = stocksData.find(a => (a.ticker || '').toUpperCase() === t);
    if (s && s.price > 0) {
        const ch = s.change_percent != null ? s.change_percent : s.change;
        return { price: Number(s.price), change_percent: ch, name: s.name };
    }
    const c = cryptoData.find(a => (a.ticker || '').toUpperCase() === t);
    if (c && c.price > 0) {
        const ch = c.change_percent != null ? c.change_percent : c.change;
        return { price: Number(c.price), change_percent: ch, name: c.name };
    }
    return null;
}

function reenrichAlphaBaseBook(book) {
    if (!book) return null;
    const cash = Number(book.cash) || 0;
    const starting = Number(book.starting_capital) || 2500;
    let positionsValue = 0;
    const holdings = (book.holdings || []).map(h => {
        const ticker = (h.ticker || '').toUpperCase();
        const shares = Number(h.shares) || 0;
        const avg = Number(h.avg_price != null ? h.avg_price : h.avgPrice) || 0;
        const quote = livePriceForTicker(ticker);
        const live = quote && quote.price > 0 ? quote.price : (Number(h.live_price) || avg);
        const marketValue = shares * live;
        const cost = shares * avg;
        positionsValue += marketValue;
        const pnl = marketValue - cost;
        return {
            ...h,
            ticker,
            shares,
            avg_price: avg,
            live_price: live,
            price_source: quote && quote.price > 0 ? 'live' : (h.price_source || 'cost'),
            market_value: marketValue,
            cost_basis: cost,
            pnl,
            pnl_pct: cost > 0 ? (pnl / cost) * 100 : 0,
            change_percent: quote ? quote.change_percent : h.change_percent,
            name: (quote && quote.name) || h.name || ticker,
            note: h.note || '',
            catalyst: h.catalyst || null,
        };
    });
    const totalValue = cash + positionsValue;
    holdings.forEach(row => {
        row.weight_pct = totalValue > 0 ? (row.market_value / totalValue) * 100 : 0;
    });
    const vs = totalValue - starting;
    const scoreboard = (book.scoreboard || holdings.map(h => ({
        ticker: h.ticker,
        name: h.name,
        note: h.note,
        market_value: h.market_value,
        weight_pct: h.weight_pct,
        catalyst: h.catalyst,
    }))).map(sb => {
        const match = holdings.find(h => h.ticker === sb.ticker);
        if (!match) return sb;
        return {
            ...sb,
            market_value: match.market_value,
            weight_pct: match.weight_pct,
            catalyst: match.catalyst || sb.catalyst,
        };
    });
    return {
        ...book,
        cash,
        holdings,
        scoreboard,
        positions_value: positionsValue,
        total_value: totalValue,
        vs_starting: vs,
        vs_starting_pct: starting > 0 ? (vs / starting) * 100 : 0,
        holdings_count: holdings.length,
        read_only: true,
    };
}

async function fetchAlphaBaseBook() {
    try {
        const res = await fetch('/api/alpha-base-book?t=' + Date.now());
        const data = await res.json();
        // Preserve server week_pnl (benchmarks) across client re-mark
        const weekPnl = data.week_pnl || null;
        alphaBaseBookData = reenrichAlphaBaseBook(data);
        if (alphaBaseBookData && weekPnl) {
            alphaBaseBookData.week_pnl = weekPnl;
            // If Monday week_open mark exists, refresh book % from live total
            if (weekPnl.week_open_value != null && alphaBaseBookData.total_value > 0) {
                const openV = Number(weekPnl.week_open_value);
                if (openV > 0) {
                    alphaBaseBookData.week_pnl = {
                        ...weekPnl,
                        book_pct: ((alphaBaseBookData.total_value - openV) / openV) * 100,
                        book_value: alphaBaseBookData.total_value,
                        book_method: 'week_open_mark',
                        vs_spy: weekPnl.benchmarks && weekPnl.benchmarks[0] && weekPnl.benchmarks[0].week_pct != null
                            ? (((alphaBaseBookData.total_value - openV) / openV) * 100) - weekPnl.benchmarks[0].week_pct
                            : weekPnl.vs_spy,
                        vs_ufo: weekPnl.benchmarks && weekPnl.benchmarks[1] && weekPnl.benchmarks[1].week_pct != null
                            ? (((alphaBaseBookData.total_value - openV) / openV) * 100) - weekPnl.benchmarks[1].week_pct
                            : weekPnl.vs_ufo,
                    };
                }
            }
        }
        renderAlphaBaseBook();
        renderFridayPnl();
        renderCatalystScoreboard();
    } catch (e) {
        console.error('Failed to fetch Alpha Base Book', e);
        const el = document.getElementById('abb-holdings');
        if (el) {
            el.innerHTML = `<div class="p-6 text-center text-rose-300/80 text-sm">Alpha Base Book offline. Retry soon.</div>`;
        }
    }
}

function formatPctBold(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return sign + v.toFixed(2) + '%';
}

function pctToneClass(n) {
    if (n == null || !Number.isFinite(Number(n))) return 'text-white/50';
    const v = Number(n);
    if (v > 0) return 'text-emerald-400';
    if (v < 0) return 'text-rose-400';
    return 'text-white/80';
}

function renderFridayPnl() {
    const strip = document.getElementById('friday-pnl');
    const book = alphaBaseBookData;
    if (!strip) return;
    const w = book && book.week_pnl;
    if (!w) {
        strip.classList.add('opacity-50');
        return;
    }
    strip.classList.remove('opacity-50');

    // Recompute book % from live total when week_open is known
    let bookPct = w.book_pct;
    if (w.week_open_value != null && book && book.total_value > 0) {
        const openV = Number(w.week_open_value);
        if (openV > 0) bookPct = ((book.total_value - openV) / openV) * 100;
    }

    const spy = (w.benchmarks || []).find(b => b.ticker === 'SPY');
    const ufo = (w.benchmarks || []).find(b => b.ticker === 'UFO') || (w.benchmarks || [])[1];
    const spyPct = spy && spy.week_pct != null ? spy.week_pct : null;
    const ufoPct = ufo && ufo.week_pct != null ? ufo.week_pct : null;
    const vsSpy = bookPct != null && spyPct != null ? bookPct - spyPct : w.vs_spy;

    const setPct = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = formatPctBold(val);
        el.className = `font-space text-xl sm:text-2xl font-bold tabular-nums ${pctToneClass(val)}`;
    };
    setPct('fpnl-book', bookPct);
    setPct('fpnl-spy', spyPct);
    setPct('fpnl-ufo', ufoPct);

    const vsEl = document.getElementById('fpnl-vs-spy');
    if (vsEl) {
        vsEl.textContent = formatPctBold(vsSpy);
        vsEl.className = `font-mono text-sm font-bold tabular-nums ${pctToneClass(vsSpy)}`;
    }

    // Relative bar: map signed % to positive widths (magnitude share of max abs)
    const vals = [bookPct, spyPct, ufoPct].map(v => (v == null || !Number.isFinite(v) ? 0 : Math.abs(v)));
    const max = Math.max(...vals, 0.01);
    const widths = vals.map(v => Math.max(8, (v / max) * 100)); // min visible slice
    const sum = widths.reduce((a, b) => a + b, 0) || 1;
    const norm = widths.map(w0 => (w0 / sum) * 100);
    const barBook = document.getElementById('fpnl-bar-book');
    const barSpy = document.getElementById('fpnl-bar-spy');
    const barUfo = document.getElementById('fpnl-bar-ufo');
    if (barBook) barBook.style.width = norm[0].toFixed(1) + '%';
    if (barSpy) barSpy.style.width = norm[1].toFixed(1) + '%';
    if (barUfo) barUfo.style.width = norm[2].toFixed(1) + '%';
    // Tone bar segments by sign
    if (barBook) barBook.className = `h-full transition-all duration-300 ${bookPct != null && bookPct < 0 ? 'bg-rose-400' : 'bg-cyan-400'}`;
    if (barSpy) barSpy.className = `h-full transition-all duration-300 ${spyPct != null && spyPct < 0 ? 'bg-rose-400/50' : 'bg-white/35'}`;
    if (barUfo) barUfo.className = `h-full transition-all duration-300 ${ufoPct != null && ufoPct < 0 ? 'bg-rose-400/60' : 'bg-violet-400/80'}`;
}

function catalystStatusDot(status) {
    const s = (status || 'red').toLowerCase();
    if (s === 'green') return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
    if (s === 'yellow') return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]';
    return 'bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.5)]';
}

function catalystWeeklyBar(score, max) {
    const m = Number(max) || 1;
    const pct = Math.max(0, Math.min(100, (Number(score) / m) * 100));
    return `<div class="h-1.5 rounded-full bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400" style="width:${pct}%"></div></div>`;
}

function renderCatalystScoreboard() {
    const book = alphaBaseBookData;
    const fw = (book && book.catalyst_framework) || null;
    const rows = (book && (book.scoreboard || book.holdings)) || [];

    const fwEl = document.getElementById('cs-framework');
    if (fwEl) {
        fwEl.textContent = (fw && fw.note)
            || (fw
                ? `Entry gate: 5 checklist items (must total ≥${fw.entry_min || 3}). Weekly score /${fw.weekly_max || 10}. Educational only.`
                : 'Entry gate + weekly /10 scorecard. Educational only.');
    }

    const qEl = document.getElementById('cs-questions');
    if (qEl && fw && fw.entry_questions) {
        qEl.innerHTML = fw.entry_questions.map((q, i) => `
            <div class="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div class="text-[10px] text-violet-300/80 uppercase tracking-wide mb-1">${i + 1}. ${escapeHtml(q.short || q.id)}</div>
                <div class="text-[11px] text-white/60 leading-snug">${escapeHtml(q.question || '')}</div>
            </div>
        `).join('');
    }

    const cards = document.getElementById('cs-cards');
    if (!cards) return;
    if (!rows.length) {
        cards.innerHTML = `<div class="p-6 text-center text-white/40 text-sm">No scored holdings yet.</div>`;
        return;
    }

    cards.innerHTML = rows.map(row => {
        const c = row.catalyst;
        if (!c) {
            return `<div class="rounded-2xl border border-white/10 p-4 text-white/40 text-sm">${escapeHtml(row.ticker)} — no catalyst card yet</div>`;
        }
        const role = (c.role || 'core').toLowerCase();
        const isSleeve = role === 'sleeve' || role === 'ballast' || role === 'cash';
        const entryOk = c.eligible;
        const gateBadge = isSleeve
            ? `<span class="text-[10px] px-2 py-0.5 rounded-full border border-white/20 text-white/50">SLEEVE · gate N/A</span>`
            : entryOk
                ? `<span class="text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/40 text-emerald-300">ENTRY ${c.entry_score}/${c.entry_max} · PASS</span>`
                : `<span class="text-[10px] px-2 py-0.5 rounded-full border border-rose-400/40 text-rose-300">ENTRY ${c.entry_score}/${c.entry_max} · BELOW ${c.entry_min}</span>`;

        const band = c.weekly_band || 'watch';
        const bandCls = band === 'strong'
            ? 'text-emerald-300 border-emerald-400/30'
            : band === 'weak'
                ? 'text-rose-300 border-rose-400/30'
                : 'text-amber-300 border-amber-400/30';

        const dots = (c.entry_items || []).map(item => `
            <div class="flex items-start gap-2 min-w-0" title="${escapeHtml(item.question)}">
                <span class="mt-1 w-2 h-2 rounded-full shrink-0 ${catalystStatusDot(item.status)}"></span>
                <div class="min-w-0">
                    <div class="text-[11px] text-white/80 truncate">${escapeHtml(item.short)}</div>
                    <div class="text-[10px] text-white/40 capitalize">${escapeHtml(item.status)} · ${item.points}pt</div>
                </div>
            </div>
        `).join('');

        const weeklyBars = (c.weekly_items || []).map(w => `
            <div class="space-y-1">
                <div class="flex justify-between text-[10px] gap-2">
                    <span class="text-white/60 truncate" title="${escapeHtml(w.question)}">${escapeHtml(w.label)}</span>
                    <span class="tabular-nums text-white/80 shrink-0">${w.score}/${w.max}</span>
                </div>
                ${catalystWeeklyBar(w.score, w.max)}
            </div>
        `).join('');

        const wt = row.weight_pct != null ? `${Number(row.weight_pct).toFixed(1)}% wt` : '';

        return `
        <article class="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-mono text-lg font-semibold text-cyan-300">${escapeHtml(row.ticker)}</span>
                        ${gateBadge}
                        <span class="text-[10px] px-2 py-0.5 rounded-full border ${bandCls}">WEEKLY ${c.weekly_score}/${c.weekly_max}</span>
                        ${wt ? `<span class="text-[10px] text-white/40">${wt}</span>` : ''}
                    </div>
                    <div class="text-xs text-white/50 mt-1">${escapeHtml(row.note || row.name || '')}</div>
                </div>
                <a href="#alpha-base-book" class="text-[10px] text-violet-300/80 hover:text-violet-200">Book →</a>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                    <div class="text-[10px] uppercase tracking-wide text-white/40 mb-2">Entry gate (5)</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${dots}</div>
                </div>
                <div>
                    <div class="text-[10px] uppercase tracking-wide text-white/40 mb-2">Weekly scorecard</div>
                    <div class="space-y-2">${weeklyBars}</div>
                </div>
            </div>
            ${c.why ? `<p class="mt-3 text-sm text-white/70 leading-relaxed"><span class="text-violet-300/90 font-medium">Why · </span>${escapeHtml(c.why)}</p>` : ''}
            ${c.risks ? `<p class="mt-1.5 text-xs text-white/40 leading-relaxed"><span class="text-rose-300/70">Risks · </span>${escapeHtml(c.risks)}</p>` : ''}
        </article>`;
    }).join('');
}

function renderAlphaBaseBook() {
    const book = alphaBaseBookData;
    if (!book) return;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (book.tagline) setText('abb-tagline', book.tagline);
    setText('abb-operator', book.operator || '@link_mindset');
    setText('abb-total', formatMoneyExact(book.total_value));
    setText('abb-cash', formatMoneyExact(book.cash));
    setText('abb-week', book.week_of || book.as_of || '—');

    const vsEl = document.getElementById('abb-vs-start');
    if (vsEl) {
        const vs = Number(book.vs_starting) || 0;
        const pct = Number(book.vs_starting_pct) || 0;
        const sign = vs > 0 ? '+' : '';
        vsEl.textContent = `${sign}${formatMoneyExact(vs)} (${sign}${pct.toFixed(1)}%)`;
        vsEl.classList.remove('text-emerald-400', 'text-rose-400', 'text-white/80');
        vsEl.classList.add(vs > 0 ? 'text-emerald-400' : vs < 0 ? 'text-rose-400' : 'text-white/80');
    }

    const badge = document.getElementById('abb-status-badge');
    if (badge) {
        const st = (book.status || 'live').toLowerCase();
        badge.textContent = st === 'seed' ? 'SEED — PENDING MONDAY LOCK' : 'MONDAY LOCK · LIVE MARKS';
        badge.className = st === 'seed'
            ? 'text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border border-amber-400/40 text-amber-300 bg-amber-400/10'
            : 'text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full border border-emerald-400/40 text-emerald-300 bg-emerald-400/10';
    }

    const updatedBits = [];
    if (book.updated_at) {
        try {
            updatedBits.push('published ' + new Date(book.updated_at).toLocaleDateString());
        } catch (_) {
            updatedBits.push('published ' + book.updated_at);
        }
    }
    if (book.market_updated) {
        try {
            updatedBits.push('marks ' + new Date(book.market_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } catch (_) {}
    }
    setText('abb-updated', updatedBits.join(' · ') || '—');
    setText('abb-thesis', book.thesis || '');
    setText('abb-disclaimer', book.disclaimer || 'Educational only. Not financial advice.');
    setText('abb-rebalance-note', book.next_rebalance_note || 'Allocation locked Mondays; prices mark live.');

    const container = document.getElementById('abb-holdings');
    if (!container) return;

    const holdings = book.holdings || [];
    if (!holdings.length) {
        container.innerHTML = `<div class="p-6 text-center text-white/40 text-sm">No positions published yet. Check back Monday.</div>`;
        return;
    }

    const header = `
        <div class="hidden sm:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-white/40 bg-white/5">
            <div class="col-span-3">Ticker</div>
            <div class="col-span-2 text-right">Shares</div>
            <div class="col-span-2 text-right">Live</div>
            <div class="col-span-2 text-right">Value</div>
            <div class="col-span-1 text-right">Wt</div>
            <div class="col-span-2 text-right">P/L · gate</div>
        </div>`;

    const rows = holdings.map(h => {
        const pnl = Number(h.pnl) || 0;
        const pnlPct = Number(h.pnl_pct) || 0;
        const pnlCls = pnl > 0 ? 'text-emerald-400' : pnl < 0 ? 'text-rose-400' : 'text-white/70';
        const sign = pnl > 0 ? '+' : '';
        const note = h.note ? `<div class="text-[10px] text-white/40 truncate max-w-[14rem]">${escapeHtml(h.note)}</div>` : '';
        const sharesStr = Number(h.shares) >= 1
            ? Number(h.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })
            : Number(h.shares).toLocaleString(undefined, { maximumFractionDigits: 6 });
        const cat = h.catalyst;
        let catMini = '';
        if (cat && cat.entry_items) {
            const dots = cat.entry_items.map(it =>
                `<span class="inline-block w-1.5 h-1.5 rounded-full ${catalystStatusDot(it.status)}" title="${escapeHtml(it.short)}: ${escapeHtml(it.status)}"></span>`
            ).join('');
            const wk = cat.weekly_score != null ? `${cat.weekly_score}/10` : '';
            catMini = `<div class="flex items-center gap-1 mt-1" title="Catalyst entry ${cat.entry_score}/${cat.entry_max}">${dots}<span class="text-[9px] text-violet-300/80 ml-1">${wk}</span></div>`;
        }
        return `
        <div class="grid grid-cols-2 sm:grid-cols-12 gap-1 sm:gap-2 px-4 py-3 items-center hover:bg-white/[0.03]">
            <div class="col-span-1 sm:col-span-3">
                <div class="font-mono font-semibold text-cyan-300"><a href="#catalyst-scoreboard" class="hover:underline">${escapeHtml(h.ticker)}</a></div>
                ${note}
                ${catMini}
            </div>
            <div class="col-span-1 sm:col-span-2 text-right tabular-nums text-sm text-white/80">${sharesStr}</div>
            <div class="col-span-1 sm:col-span-2 text-right tabular-nums text-sm">${formatMoneyExact(h.live_price)}</div>
            <div class="col-span-1 sm:col-span-2 text-right tabular-nums text-sm font-medium">${formatMoneyExact(h.market_value)}</div>
            <div class="col-span-1 sm:col-span-1 text-right tabular-nums text-xs text-white/50">${(Number(h.weight_pct) || 0).toFixed(1)}%</div>
            <div class="col-span-1 sm:col-span-2 text-right tabular-nums text-xs ${pnlCls}">${sign}${formatMoneyExact(pnl)} <span class="opacity-70">(${sign}${pnlPct.toFixed(1)}%)</span></div>
        </div>`;
    }).join('');

    container.innerHTML = header + rows;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function copyAlphaBaseBookLink() {
    const path = (alphaBaseBookData && alphaBaseBookData.x_ops && alphaBaseBookData.x_ops.share_path) || '#alpha-base-book';
    const url = `${window.location.origin}${window.location.pathname}${path}`;
    const label = document.getElementById('abb-copy-label');
    const done = () => {
        if (label) {
            label.textContent = 'Link copied';
            setTimeout(() => { label.textContent = 'Copy share link'; }, 1600);
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => {
            window.prompt('Copy share link:', url);
        });
    } else {
        window.prompt('Copy share link:', url);
        done();
    }
}

function cloneAlphaBaseBook() {
    if (!alphaBaseBookData || !(alphaBaseBookData.holdings || []).length) {
        alert('Alpha Base Book is not loaded yet.');
        return;
    }
    const ok = confirm(
        'Clone Alpha Base Book into your personal sim?\n\n' +
        'This replaces your local portfolio (cash + holdings) with the public Monday book. Educational only — not advice.'
    );
    if (!ok) return;

    const holdings = {};
    (alphaBaseBookData.holdings || []).forEach(h => {
        const t = (h.ticker || '').toUpperCase();
        if (!t) return;
        holdings[t] = {
            shares: Number(h.shares) || 0,
            avgPrice: Number(h.avg_price) || 0,
        };
    });
    portfolio = {
        cash: Number(alphaBaseBookData.cash) || 0,
        holdings,
    };
    savePortfolio();
    updatePortfolioValue();
    renderPortfolio();
    refreshNasaAwardsIfPortfolioChanged();

    const dest = document.getElementById('portfolio');
    if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatPrice(price) {
    return '$' + price.toFixed(2);
}

async function fetchStocks() {
    // Used for initial load and manual refresh.
    // Normal live updates now come from the SSE long stream (/api/market/stream).
    try {
        const res = await fetch('/api/stocks?t=' + Date.now());
        const data = await res.json();
        stocksData = data.stocks || [];
        const countEl = document.getElementById('market-ticker-count');
        if (countEl) {
            const n = data.count || stocksData.length;
            countEl.textContent = `${n} tickers tracked`;
        }
        renderMarket();
        updatePortfolioValue();
    } catch (e) {
        console.error('Failed to fetch stocks', e);
    }
}

async function fetchCrypto() {
    // Used for initial load and manual refresh.
    // Normal live updates now come from the SSE long stream (/api/market/stream).
    try {
        const res = await fetch('/api/crypto?t=' + Date.now());
        const data = await res.json();
        cryptoData = data.cryptos;
        renderCryptoMarket();
        updatePortfolioValue();
    } catch (e) {
        console.error('Failed to fetch crypto', e);
    }
}

async function fetchNews() {
    try {
        const res = await fetch('/api/news');
        const data = await res.json();
        newsData = data.news;
        renderNews();
    } catch (e) {
        console.error('Failed to fetch news', e);
        // Fallback news
        newsData = [
            { title: "Rocket Lab launches latest Electron mission", link: "https://www.space.com", published: "Today" },
            { title: "AST SpaceMobile achieves key satellite milestone", link: "https://spacenews.com", published: "Yesterday" }
        ];
        renderNews();
    }
}

function renderMarket() {
    const container = document.getElementById('stocks-table');
    if (!container || !stocksData.length) return;

    container.innerHTML = '';

    stocksData.forEach(stock => {
        const row = document.createElement('tr');
        const isPrivate = stock.private || stock.tradable === false;
        const noPrice = !stock.price || stock.price === 0;
        row.className = `stock-row border-b border-white/10 ${noPrice && !isPrivate ? 'opacity-60' : ''} ${isPrivate ? 'bg-violet-500/5' : ''}`;

        const changeClass = stock.change >= 0 ? 'text-emerald-400' : 'text-red-400';
        const priceCell = isPrivate
            ? '<span class="text-[10px] uppercase tracking-wider text-violet-300">Private</span>'
            : (noPrice ? '<span class="text-white/40 text-sm">—</span>' : formatPrice(stock.price));
        const changeCell = isPrivate
            ? '<span class="text-[10px] text-white/40">N/A</span>'
            : `<span class="font-mono font-medium ${changeClass}">${stock.change >= 0 ? '+' : ''}${(stock.change || 0).toFixed(2)}%</span>`;
        const privateNote = isPrivate && stock.note
            ? `<div class="text-[9px] text-violet-300/70 mt-0.5 max-w-xs">${stock.note}</div>`
            : '';
        const buyCell = isPrivate
            ? `<span class="text-[10px] text-white/40 italic">Proxies: ${(stock.proxies || []).join(', ')}</span>`
            : `<div class="flex items-center gap-2 justify-end">
                    <input type="number" id="qty-s-${stock.ticker}" name="qty-s-${stock.ticker}" autocomplete="off" value="10" min="1" step="1"
                           class="w-16 bg-white/5 border border-white/20 rounded px-2 py-1 text-sm text-right">
                    <button onclick="buyStockFromInput('${stock.ticker}')"
                            class="px-4 py-1 text-xs bg-emerald-500/80 hover:bg-emerald-400 text-black rounded-2xl transition-colors font-medium">
                        BUY
                    </button>
               </div>`;

        row.innerHTML = `
            <td class="py-4 px-6 font-mono font-semibold text-lg">
                ${stock.ticker}
                ${isPrivate ? '<div class="text-[8px] text-violet-400 font-sans font-normal">NOT LISTED</div>' : ''}
            </td>
            <td class="py-4 px-6">
                <div class="font-medium">${stock.name}</div>
                <div class="text-[10px] text-white/40">${stock.sector || 'Aerospace'}</div>
                ${privateNote}
            </td>
            <td class="py-4 px-6 text-right font-mono text-lg money">${priceCell}</td>
            <td class="py-4 px-6 text-right">${changeCell}</td>
            <td class="py-4 px-6">${buyCell}</td>
        `;
        container.appendChild(row);
    });
}

function renderCryptoMarket() {
    const container = document.getElementById('crypto-table');
    if (!container || !cryptoData.length) return;

    container.innerHTML = '';

    cryptoData.forEach(coin => {
        const row = document.createElement('tr');
        row.className = `stock-row border-b border-white/10 ${coin.price === 0 ? 'opacity-60' : ''}`;
        
        const changeClass = coin.change >= 0 ? 'text-emerald-400' : 'text-red-400';
        
        row.innerHTML = `
            <td class="py-4 px-6 font-mono font-semibold text-lg">${coin.ticker}</td>
            <td class="py-4 px-6">
                <div class="font-medium">${coin.name}</div>
                <div class="text-[10px] text-white/40">${coin.sector || 'Cryptocurrency'}</div>
            </td>
            <td class="py-4 px-6 text-right font-mono text-lg money">${formatPrice(coin.price)}</td>
            <td class="py-4 px-6 text-right">
                <span class="font-mono font-medium ${changeClass}">
                    ${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%
                </span>
            </td>
            <td class="py-4 px-6">
                <div class="flex items-center gap-2 justify-end">
                    <input type="number" id="qty-c-${coin.ticker}" name="qty-c-${coin.ticker}" autocomplete="off" value="0.1" min="0.001" step="0.001" 
                           class="w-20 bg-white/5 border border-white/20 rounded px-2 py-1 text-sm text-right">
                    <button onclick="buyCryptoFromInput('${coin.ticker}')" 
                            class="px-4 py-1 text-xs bg-emerald-500/80 hover:bg-emerald-400 text-black rounded-2xl transition-colors font-medium">
                        BUY
                    </button>
                </div>
            </td>
        `;
        container.appendChild(row);
    });
}

function buyAsset(ticker, amount, isCrypto = false) {
    const data = isCrypto ? cryptoData : stocksData;
    const asset = data.find(a => a.ticker === ticker);
    if (asset && (asset.private || asset.tradable === false)) {
        const proxies = (asset.proxies || []).join(', ');
        alert(`${ticker} is a private company and cannot be bought in the simulator.${proxies ? ' Try public proxies: ' + proxies + '.' : ''}`);
        return;
    }
    if (!asset || !asset.price || asset.price === 0) {
        alert("Current price not available for " + ticker + ". Try refreshing.");
        return;
    }
    const price = asset.price;
    const cost = amount * price;

    if (cost > portfolio.cash) {
        alert(`Not enough cash! You have ${formatMoney(portfolio.cash)} but this would cost ${formatMoney(cost)}.`);
        return;
    }

    portfolio.cash -= cost;

    if (!portfolio.holdings[ticker]) {
        portfolio.holdings[ticker] = { shares: 0, avgPrice: 0 };
    }

    const holding = portfolio.holdings[ticker];
    const totalShares = holding.shares + amount;
    holding.avgPrice = ((holding.avgPrice * holding.shares) + (price * amount)) / totalShares;
    holding.shares = totalShares;

    savePortfolio();
    updatePortfolioValue();
    renderPortfolio();

    // Feedback
    const btns = document.querySelectorAll(`button[onclick*="buy${isCrypto ? 'Crypto' : 'Stock'}FromInput('${ticker}')"]`);
    if (btns.length) {
        const orig = btns[0].innerHTML;
        btns[0].innerHTML = 'BOUGHT!';
        btns[0].disabled = true;
        setTimeout(() => {
            if (btns[0]) {
                btns[0].innerHTML = orig;
                btns[0].disabled = false;
            }
        }, 1200);
    }
}

function buyStockFromInput(ticker) {
    const input = document.getElementById(`qty-s-${ticker}`);
    if (!input) return;
    const shares = parseInt(input.value) || 0;
    if (shares <= 0) {
        alert("Enter a valid number of shares (at least 1).");
        return;
    }
    buyAsset(ticker, shares, false);
}

function buyCryptoFromInput(ticker) {
    const input = document.getElementById(`qty-c-${ticker}`);
    if (!input) return;
    const amount = parseFloat(input.value) || 0;
    if (amount <= 0) {
        alert("Enter a valid amount (e.g. 0.01).");
        return;
    }
    buyAsset(ticker, amount, true);
}

// Legacy support
function buyStock(ticker, price) {
    const shares = parseInt(prompt(`How many shares of ${ticker} to buy? (live price ~$${price})`, "10"));
    if (!shares || shares <= 0) return;
    const stock = stocksData.find(s => s.ticker === ticker);
    const actualPrice = stock ? stock.price : price;
    buyAsset(ticker, shares, false);
}

function renderPortfolio() {
    const container = document.getElementById('portfolio-holdings');
    if (!container) return;

    container.innerHTML = '';

    let totalValue = portfolio.cash;

    if (Object.keys(portfolio.holdings).length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-white/50">
                <i class="fa-solid fa-wallet text-3xl mb-3"></i>
                <div>Your portfolio is empty. Buy stocks from the market above.</div>
            </div>
        `;
    } else {
        Object.entries(portfolio.holdings).forEach(([ticker, holding]) => {
            const stock = stocksData.find(s => s.ticker === ticker) || cryptoData.find(c => c.ticker === ticker);
            const currentPrice = stock ? stock.price : holding.avgPrice;
            const value = holding.shares * currentPrice;
            totalValue += value;
            
            const pnl = ((currentPrice - holding.avgPrice) / holding.avgPrice) * 100;
            const pnlClass = pnl >= 0 ? 'text-emerald-400' : 'text-red-400';

            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-3 border-b border-white/10 last:border-0';
            row.innerHTML = `
                <div>
                    <div class="flex items-center gap-x-3">
                        <span class="font-mono font-bold">${ticker}</span>
                        <span class="text-xs px-2 py-0.5 bg-white/10 rounded">×${holding.shares}</span>
                    </div>
                    <div class="text-xs text-white/50">Avg ${formatPrice(holding.avgPrice)}</div>
                </div>
                <div class="text-right">
                    <div class="font-mono text-lg money">${formatPrice(value)}</div>
                    <div class="text-xs ${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</div>
                </div>
            `;
            container.appendChild(row);
        });
    }

    // Update total displays
    const cashEl = document.getElementById('portfolio-cash');
    if (cashEl) cashEl.innerText = formatMoney(portfolio.cash);
    
    const totalEl = document.getElementById('portfolio-total');
    if (totalEl) totalEl.innerText = formatMoney(totalValue);

    // Update projections
    updateProjections();

    // Re-highlight NASA awards only when held tickers change (not every price tick)
    refreshNasaAwardsIfPortfolioChanged();
}

function updatePortfolioValue() {
    // This is called when stocks update to refresh values
    renderPortfolio();
}

function loadPortfolio() {
    const saved = localStorage.getItem('lunara_portfolio');
    if (saved) {
        portfolio = JSON.parse(saved);
    }
}

function startLiveStream() {
    const evtSource = new EventSource("/api/market/stream");
    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.stocks) stocksData = data.stocks;
        if (data.cryptos) cryptoData = data.cryptos;
        renderMarket();
        renderCryptoMarket();
        renderPortfolio();
    };
}

async function updateProjections() {
    const container = document.getElementById('projections-content');
    if (!container) return;

    // Calculate current total portfolio value (cash + holdings at current prices)
    let currentValue = portfolio.cash;
    Object.entries(portfolio.holdings).forEach(([ticker, holding]) => {
        const stock = stocksData.find(s => s.ticker === ticker);
        if (stock) {
            currentValue += holding.shares * stock.price;
        }
    });

    if (currentValue < 100) {
        container.innerHTML = `
            <div class="text-center py-8 text-white/50 text-sm">
                Buy some stocks in the market above to see personalized 10-year growth projections.
            </div>
        `;
        return;
    }

    // Use server-side projections for accuracy (calls the reliable backend)
    let projectionsData;
    try {
        const resp = await fetch('/api/projections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_value: currentValue, years: 10 })
        });
        projectionsData = await resp.json();
        if (!resp.ok || projectionsData.error) {
            throw new Error(projectionsData.error || 'Backend error');
        }
    } catch (e) {
        // fallback client calc if backend fails
        projectionsData = {
            current_value: currentValue,
            optimistic: Math.round(currentValue * Math.pow(1.18, 10)),
            base: Math.round(currentValue * Math.pow(1.10, 10)),
            pessimistic: Math.round(currentValue * Math.pow(1.03, 10))
        };
    }

    const opt = projectionsData.optimistic || projectionsData.base * 1.8;
    const base = projectionsData.base || currentValue * 2.5;
    const pess = projectionsData.pessimistic || currentValue * 1.3;

    const scenarios = [
        { name: 'Pessimistic', value: pess, color: '#f87171', mult: (pess / currentValue).toFixed(1) },
        { name: 'Base Case', value: base, color: '#fbbf24', mult: (base / currentValue).toFixed(1) },
        { name: 'Optimistic', value: opt, color: '#34d399', mult: (opt / currentValue).toFixed(1) }
    ];

    let html = `<div class="grid grid-cols-3 gap-1 mb-1 text-center">`;
    scenarios.forEach(p => {
        html += `
            <div class="bg-white/5 p-1 rounded">
                <div class="text-[8px] leading-none text-white/50">${p.name}</div>
                <div class="text-sm font-semibold tabular-nums leading-none" style="color:${p.color}">
                    $${p.value.toLocaleString()}
                </div>
                <div class="text-[8px] leading-none text-white/40">${p.mult}x</div>
            </div>
        `;
    });
    html += `</div>`;

    // Simple bar representation instead of broken chart for compactness
    html += `
        <div class="flex items-end gap-1 h-7 mt-1">
            <div class="flex-1 bg-[#f87171] rounded" style="height: 30%"></div>
            <div class="flex-1 bg-[#fbbf24] rounded" style="height: 65%"></div>
            <div class="flex-1 bg-[#34d399] rounded" style="height: 100%"></div>
        </div>
        <div class="text-[7px] text-white/40 text-center mt-0.5">10-year educational projection (space sector CAGR)</div>
    `;

    container.innerHTML = html;
}

function renderNews() {
    const container = document.getElementById('news-feed');
    if (!container || !newsData.length) return;

    container.innerHTML = '';

    // Show only top 3 for compactness — no scrolling needed
    newsData.slice(0, 3).forEach(item => {
        const div = document.createElement('a');
        div.href = item.link;
        div.target = '_blank';
        div.className = 'block px-3 py-1 text-xs hover:bg-white/5 rounded-lg flex items-start gap-x-2';
        div.innerHTML = `
            <span class="font-medium leading-tight flex-1">${item.title}</span>
            <span class="text-[10px] text-emerald-400 whitespace-nowrap">→</span>
        `;
        container.appendChild(div);
    });
}

function formatLaunchTime(net) {
    if (!net) return 'TBD';
    const d = new Date(net);
    if (Number.isNaN(d.getTime())) return 'TBD';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderLaunches() {
    const container = document.getElementById('launches-feed');
    if (!container) return;

    if (!launchesData.length) {
        container.innerHTML = '<div class="text-white/40 text-center py-3 text-[10px]">No upcoming launches found. Refreshing…</div>';
        return;
    }

    container.innerHTML = '';

    launchesData.forEach(launch => {
        const div = document.createElement('div');
        const isStarship = /starship|super heavy/i.test(launch.rocket || '') || /starship/i.test(launch.name || '');
        div.className = `px-2 py-1 rounded-md flex items-start gap-x-2 text-[10px] leading-tight ${isStarship ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-white/5'}`;
        const place = [launch.pad, launch.location].filter(Boolean).join(' • ');
        const country = launch.country ? ` (${launch.country})` : '';
        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="font-medium truncate">${launch.name}</div>
                <div class="text-white/50 truncate">${launch.provider} • ${launch.rocket}</div>
                ${place ? `<div class="text-[8px] text-white/30 truncate">${place}${country}</div>` : ''}
            </div>
            <div class="text-right text-emerald-400 whitespace-nowrap shrink-0">
                ${formatLaunchTime(launch.net)}<br>
                <span class="text-[8px] text-white/40">${launch.status}</span>
            </div>
        `;
        container.appendChild(div);
    });
}

async function fetchLaunches() {
    try {
        const res = await fetch('/api/launches?t=' + Date.now());
        const data = await res.json();
        launchesData = data.launches || [];
        const updatedEl = document.getElementById('launches-updated');
        if (updatedEl) {
            const count = data.count || launchesData.length;
            if (data.updated) {
                const ts = new Date(data.updated);
                updatedEl.textContent = `${count} global launches • updated ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            } else {
                updatedEl.textContent = `${count} global launches`;
            }
        }
        renderLaunches();
    } catch (e) {
        console.error('Failed to fetch launches', e);
        const updatedEl = document.getElementById('launches-updated');
        if (updatedEl) updatedEl.textContent = 'Live feed unavailable';
        launchesData = [];
        renderLaunches();
    }
}

function formatAwardAmount(usd, note) {
    if (usd == null || usd === '') return note ? `n/a · ${note}` : 'n/a';
    const n = Number(usd);
    if (!Number.isFinite(n)) return 'n/a';
    let core;
    if (n >= 1e9) core = `$${(n / 1e9).toFixed(n >= 10e9 ? 1 : 2)}B`;
    else if (n >= 1e6) core = `$${(n / 1e6).toFixed(n >= 100e6 ? 0 : 1)}M`;
    else if (n >= 1e3) core = `$${(n / 1e3).toFixed(0)}K`;
    else core = `$${n.toLocaleString()}`;
    return note ? `${core} · approx` : core;
}

function statusBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'completed') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    if (s === 'delayed') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    if (s === 'cancelled') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    if (s === 'competed') return 'bg-violet-500/15 text-violet-300 border-violet-500/30';
    return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
}

function renderNasaAwardFilters(programs) {
    const bar = document.getElementById('nasa-awards-filters');
    if (!bar) return;
    const progs = programs && programs.length
        ? programs
        : [...new Set(nasaAwardsData.map(a => a.program).filter(Boolean))].sort();

    const heldCount = nasaAwardsData.filter(a => isTickerInPortfolio(a.ticker)).length;

    const chips = [
        { kind: 'all', label: 'All' },
        { kind: 'portfolio', label: heldCount ? `In portfolio (${heldCount})` : 'In portfolio' },
        ...progs.map(p => ({ kind: 'program', program: p, label: p })),
    ];

    bar.innerHTML = chips.map((chip) => {
        let active = false;
        if (chip.kind === 'all') {
            active = !nasaAwardsShowPortfolioOnly && !nasaAwardsProgramFilter;
        } else if (chip.kind === 'portfolio') {
            active = nasaAwardsShowPortfolioOnly;
        } else {
            active = !nasaAwardsShowPortfolioOnly && nasaAwardsProgramFilter === chip.program;
        }
        const cls = active
            ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
            : 'border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20';
        const dataProg = chip.kind === 'program' ? String(chip.program).replace(/"/g, '') : '';
        const dataKind = chip.kind;
        return `<button type="button" data-kind="${dataKind}" data-program="${dataProg}" class="nasa-filter-btn px-3 py-1.5 rounded-2xl text-xs border transition-colors ${cls}">${chip.label}</button>`;
    }).join('');

    bar.querySelectorAll('.nasa-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const kind = btn.getAttribute('data-kind') || 'all';
            if (kind === 'portfolio') {
                nasaAwardsShowPortfolioOnly = true;
                nasaAwardsProgramFilter = '';
            } else if (kind === 'program') {
                nasaAwardsShowPortfolioOnly = false;
                nasaAwardsProgramFilter = btn.getAttribute('data-program') || '';
            } else {
                nasaAwardsShowPortfolioOnly = false;
                nasaAwardsProgramFilter = '';
            }
            renderNasaAwards();
            renderNasaAwardFilters(progs);
        });
    });
}

function renderNasaAwards() {
    const list = document.getElementById('nasa-awards-list');
    const meta = document.getElementById('nasa-awards-meta');
    const disc = document.getElementById('nasa-awards-disclaimer');
    if (!list) return;

    lastPortfolioAwardKey = portfolioTickerKey();

    if (disc && nasaAwardsMeta.disclaimer) {
        disc.textContent = nasaAwardsMeta.disclaimer;
    }

    let awards = nasaAwardsData.slice();
    if (nasaAwardsShowPortfolioOnly) {
        awards = awards.filter(a => isTickerInPortfolio(a.ticker));
    } else if (nasaAwardsProgramFilter) {
        const p = nasaAwardsProgramFilter.toLowerCase();
        awards = awards.filter(a => (a.program || '').toLowerCase() === p);
    }

    // Portfolio holdings first, then keep relative date order
    awards.sort((a, b) => {
        const aIn = isTickerInPortfolio(a.ticker) ? 0 : 1;
        const bIn = isTickerInPortfolio(b.ticker) ? 0 : 1;
        if (aIn !== bIn) return aIn - bIn;
        return (b.date || '').localeCompare(a.date || '');
    });

    const heldInView = awards.filter(a => isTickerInPortfolio(a.ticker)).length;
    if (meta) {
        const asOf = nasaAwardsMeta.as_of ? `as of ${nasaAwardsMeta.as_of}` : 'curated';
        const heldBit = heldInView
            ? ` · ${heldInView} in your portfolio`
            : '';
        meta.textContent = `${awards.length} award${awards.length === 1 ? '' : 's'}${heldBit} · ${asOf}`;
    }

    if (!awards.length) {
        const emptyMsg = nasaAwardsShowPortfolioOnly
            ? 'No awards match tickers in your portfolio yet. Buy a related name (e.g. LUNR, RKLB, BA) from Lunar Market.'
            : 'No awards for this filter. Try All, or reload the dataset.';
        list.innerHTML = `<div class="p-6 text-sm text-white/40">${emptyMsg}</div>`;
        return;
    }

    list.innerHTML = awards.map(a => {
        const inPortfolio = isTickerInPortfolio(a.ticker);
        const themes = (a.themes || [])
            .filter(t => t && t !== 'candidate')
            .slice(0, 5)
            .map(t => `<span class="px-2 py-0.5 rounded-full bg-white/5 text-[10px] text-white/50">${t.replace(/_/g, ' ')}</span>`)
            .join('');
        const ticker = a.ticker
            ? `<span class="font-mono text-cyan-300 text-xs px-2 py-0.5 rounded-lg bg-cyan-400/10 border border-cyan-400/20">${a.ticker}</span>`
            : `<span class="text-[10px] text-white/35 px-2 py-0.5 rounded-lg border border-white/10">private / multi</span>`;
        const ownedBadge = inPortfolio
            ? `<span class="text-[10px] px-2 py-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300 font-semibold tracking-wide">IN PORTFOLIO</span>`
            : '';
        const amount = formatAwardAmount(a.amount_usd, a.amount_note);
        const badge = statusBadgeClass(a.status);
        const url = a.source_url || '#';
        const notes = a.notes
            ? `<p class="mt-2 text-[11px] text-white/40 leading-relaxed max-w-3xl">${a.notes}</p>`
            : '';
        const articleCls = inPortfolio
            ? 'p-4 sm:p-5 border-l-2 border-cyan-400 bg-cyan-400/5 hover:bg-cyan-400/10 transition-colors'
            : 'p-4 sm:p-5 hover:bg-white/[0.03] transition-colors';
        return `
        <article class="${articleCls}" data-in-portfolio="${inPortfolio ? '1' : '0'}">
            <div class="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-6">
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-1.5">
                        <span class="text-[10px] uppercase tracking-wider text-white/40 font-semibold">${a.program || 'NASA'}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded-full border ${badge}">${a.status || 'awarded'}</span>
                        ${ticker}
                        ${ownedBadge}
                    </div>
                    <h3 class="font-medium text-white/90 leading-snug">${a.title}</h3>
                    <div class="mt-1 text-sm text-white/55">${a.awardee || '—'}${a.date ? ` · <span class="text-white/35">${a.date}</span>` : ''}</div>
                    ${themes ? `<div class="mt-2 flex flex-wrap gap-1.5">${themes}</div>` : ''}
                    ${notes}
                </div>
                <div class="sm:text-right shrink-0 flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1">
                    <div class="font-space text-lg text-emerald-400/90 money">${amount}</div>
                    <a href="${url}" target="_blank" rel="noopener noreferrer"
                       class="text-[11px] text-cyan-400/80 hover:text-cyan-300 inline-flex items-center gap-1">
                        Source <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                    </a>
                </div>
            </div>
        </article>`;
    }).join('');
}

async function fetchNasaAwards() {
    try {
        const res = await fetch('/api/nasa-awards?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        nasaAwardsData = data.awards || [];
        nasaAwardsMeta = {
            as_of: data.as_of || null,
            disclaimer: data.disclaimer || '',
            programs: data.programs || [],
        };
        renderNasaAwardFilters(nasaAwardsMeta.programs);
        renderNasaAwards();
    } catch (e) {
        console.error('Failed to fetch NASA awards', e);
        const list = document.getElementById('nasa-awards-list');
        const meta = document.getElementById('nasa-awards-meta');
        if (meta) meta.textContent = 'Awards unavailable';
        if (list) {
            list.innerHTML = `<div class="p-6 text-sm text-white/40">Could not load NASA awards dataset. Check data/nasa_awards.json and /api/nasa-awards.</div>`;
        }
    }
}

async function advanceTime() {
    if (Object.keys(portfolio.holdings).length === 0) {
        alert("Buy some stocks first to see the effect of time!");
        return;
    }

    // Simulate one year of returns (educational)
    let totalValueBefore = portfolio.cash;
    
    Object.keys(portfolio.holdings).forEach(ticker => {
        const holding = portfolio.holdings[ticker];
        const stock = stocksData.find(s => s.ticker === ticker);
        if (stock) {
            // Apply random but realistic movement for the year
            const yearlyReturn = (Math.random() * 0.55) - 0.15; // -15% to +40%
            const newPrice = stock.price * (1 + yearlyReturn);
            
            totalValueBefore += holding.shares * stock.price;
            
            // Update the live price in our local data
            stock.price = Math.max(0.5, parseFloat(newPrice.toFixed(2)));
        }
    });

    // Re-render with "new" prices
    renderMarket();
    renderPortfolio();

    // Show fun educational message
    alert("1 year advanced! Prices have moved based on realistic volatility in the space sector.\n\nRemember: This is educational — real markets are much more complex.");
}

// Realistic 3D Moon using real NASA-derived textures (color + normal map for craters and surface detail)
function initThreeMoon(containerId = 'hero-moon') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Real moon textures (public domain / NASA derived, commonly used in 3D demos)
    const textureLoader = new THREE.TextureLoader();
    const moonTexture = textureLoader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg');
    const moonNormal = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024_normal.jpg');

    // High-detail moon sphere
    const geometry = new THREE.SphereGeometry(1.9, 128, 128);
    const material = new THREE.MeshPhongMaterial({
        map: moonTexture,
        normalMap: moonNormal,
        normalScale: new THREE.Vector2(1.4, 1.4),
        shininess: 2,
        specular: 0x111111,
        flatShading: false
    });
    const moon = new THREE.Mesh(geometry, material);
    scene.add(moon);

    // Realistic lighting: soft fill + strong directional "sun"
    const hemiLight = new THREE.HemisphereLight(0x555577, 0x222233, 0.5);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff8e7, 1.15);
    sunLight.position.set(5, 2, 6);
    scene.add(sunLight);

    // Subtle rim light
    const rimLight = new THREE.DirectionalLight(0xaaaaff, 0.3);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    camera.position.z = 4.2;

    // Starfield (procedural points for deep space feel)
    const starCount = 2500;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
        const radius = 25 + Math.random() * 15;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPositions[i]     = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        starPositions[i + 2] = radius * Math.cos(phi);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
        color: 0xeeeeff,
        size: 0.08,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
    });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Interaction: drag to rotate the moon
    let isDragging = false;
    let previousX = 0;
    let rotationSpeed = 0.0008; // base auto-rotate

    const onPointerDown = (event) => {
        isDragging = true;
        previousX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
        rotationSpeed = 0; // pause auto on drag
    };

    const onPointerMove = (event) => {
        if (!isDragging) return;
        const clientX = event.clientX || (event.touches && event.touches[0].clientX) || previousX;
        const delta = clientX - previousX;
        moon.rotation.y += delta * 0.004;
        previousX = clientX;
    };

    const onPointerUp = () => {
        isDragging = false;
        rotationSpeed = 0.0008; // resume gentle auto-rotate
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onPointerDown);
    dom.addEventListener('mousemove', onPointerMove);
    dom.addEventListener('mouseup', onPointerUp);
    dom.addEventListener('mouseleave', onPointerUp);

    // Touch support
    dom.addEventListener('touchstart', onPointerDown);
    dom.addEventListener('touchmove', onPointerMove);
    dom.addEventListener('touchend', onPointerUp);

    // Gentle auto rotation + stars slow drift
    function animate() {
        requestAnimationFrame(animate);
        moon.rotation.y += rotationSpeed;
        stars.rotation.y += rotationSpeed * 0.2; // subtle star movement
        renderer.render(scene, camera);
    }
    animate();

    // Responsive
    window.addEventListener('resize', () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // Optional: subtle auto-tilt on load
    setTimeout(() => {
        moon.rotation.x = 0.15;
    }, 800);
}

function initPortfolio() {
    // Load from localStorage
    const saved = localStorage.getItem('lunara_portfolio');
    if (saved) {
        try {
            portfolio = JSON.parse(saved);
        } catch(e) {}
    }
    
    // Ensure we always start with at least $2500 cash concept
    if (!portfolio.cash) portfolio.cash = 2500;
    if (!portfolio.holdings) portfolio.holdings = {};
}

function savePortfolio() {
    localStorage.setItem('lunara_portfolio', JSON.stringify(portfolio));
}

async function refreshStocks() {
    // Manual refresh helper (still useful for one-off updates).
    // Live data is primarily delivered via SSE long stream.
    await fetchStocks();
}

async function refreshCrypto() {
    // Manual refresh helper (still useful for one-off updates).
    // Live data is primarily delivered via SSE long stream.
    await fetchCrypto();
}

async function initApp() {
    initPortfolio();

    // Initial data load - get everything fast so UI shows data immediately
    await Promise.all([
        fetchStocks(),
        fetchCrypto(),
        fetchNews(),
        fetchLaunches(),
        fetchNasaAwards(),
        fetchAlphaBaseBook()
    ]);

    renderPortfolio();
    // Deep-links for X share cards
    const hash = window.location.hash;
    if (hash === '#alpha-base-book' || hash === '#catalyst-scoreboard') {
        const el = document.getElementById(hash.slice(1));
        if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }

    // Initial 3D moon (wrapped to prevent any texture load error from breaking other features like Grok)
    try {
      initThreeMoon('hero-moon');
    } catch (e) {
      console.error('3D moon init failed (non-fatal):', e);
    }

    // Start the SSE long-lived stream for live updates (no more polling for market)
    // Backend sends snapshot immediately on connect + regular updates
    setupMarketStream();

    // News and launches are slower-changing → light polling is acceptable
    setInterval(fetchNews, 5 * 60 * 1000);
    setInterval(fetchLaunches, 5 * 60 * 1000);

    console.log('%c[LUNARA] Initialized with SSE long stream for market data + real aerospace/crypto feeds.', 'color:#64748b');
}

// ============ SSE / LONG-LIVED STREAM (moved out for early start) ============
// Primary mechanism for live market updates. Replaces static/polling.
function setupMarketStream() {
    try {
        const marketStream = new EventSource('/api/market/stream');

        marketStream.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.updated != null) marketStreamUpdated = data.updated;

                if (data.stocks && data.stocks.length > 0) {
                    stocksData = data.stocks;
                    const countEl = document.getElementById('market-ticker-count');
                    if (countEl) countEl.textContent = `${stocksData.length} tickers tracked`;
                    renderMarket();
                }
                if (data.cryptos && data.cryptos.length > 0) {
                    cryptoData = data.cryptos;
                    renderCryptoMarket();
                }
                if (data.launches && data.launches.length > 0) {
                    launchesData = data.launches;
                    renderLaunches();
                }
                updatePortfolioValue();
                // Re-mark public Alpha Base Book from live prices (no extra network)
                if (alphaBaseBookData) {
                    const keepPnl = alphaBaseBookData.week_pnl;
                    alphaBaseBookData = reenrichAlphaBaseBook(alphaBaseBookData);
                    if (keepPnl) alphaBaseBookData.week_pnl = keepPnl;
                    renderAlphaBaseBook();
                    renderFridayPnl();
                    renderCatalystScoreboard();
                }
            } catch (parseErr) {
                console.warn('Stream parse error', parseErr);
            }
        };

        marketStream.onopen = () => {
            console.log('%c[LUNARA] SSE stream connected (long-lived).', 'color:#34d399');
        };

        marketStream.onerror = (err) => {
            console.warn('[LUNARA] SSE stream error. Browser will auto-reconnect.', err);
        };

    } catch (e) {
        console.error('[LUNARA] EventSource failed to initialize. Live updates disabled.', e);
    }
}

// ===================== GROK ORBITAL INVESTMENT AGENT =====================
let grokHistory = [];

function showGrokAgentModal() {
    const modal = document.getElementById('grok-agent-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const chat = document.getElementById('grok-chat');
    if (chat) chat.innerHTML = '';

    grokHistory.forEach(msg => {
        const div = document.createElement('div');
        div.className = msg.role === 'user' ? 'text-right' : '';
        div.innerHTML = `<div class="inline-block ${msg.role === 'user' ? 'bg-cyan-900/60' : 'bg-white/5'} px-4 py-2 rounded-2xl max-w-[85%] text-sm">${msg.content}</div>`;
        if (chat) chat.appendChild(div);
    });
    if (chat) chat.scrollTop = chat.scrollHeight;

    setTimeout(() => {
        const input = document.getElementById('grok-input');
        if (input) input.focus();
    }, 100);
}

function hideGrokAgentModal() {
    const modal = document.getElementById('grok-agent-modal');
    if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }
}

async function sendGrokMessage() {
    const input = document.getElementById('grok-input');
    const chat = document.getElementById('grok-chat');
    if (!input || !input.value.trim() || !chat) return;

    const question = input.value.trim();
    grokHistory.push({ role: 'user', content: question });
    const userDiv = document.createElement('div');
    userDiv.className = 'text-right';
    userDiv.innerHTML = `<div class="inline-block bg-cyan-900/60 px-4 py-2 rounded-2xl max-w-[85%] text-sm">${question}</div>`;
    chat.appendChild(userDiv);
    chat.scrollTop = chat.scrollHeight;
    input.value = '';

    // Build rich live context
    const currentPortfolio = {
        cash: portfolio.cash,
        total_value: (portfolio.cash || 0) + Object.entries(portfolio.holdings).reduce((sum, [t, h]) => {
            const asset = stocksData.find(s => s.ticker === t) || cryptoData.find(c => c.ticker === t);
            return sum + (asset ? h.shares * asset.price : 0);
        }, 0),
        holdings: Object.entries(portfolio.holdings).map(([t, h]) => {
            const asset = stocksData.find(s => s.ticker === t) || cryptoData.find(c => c.ticker === t);
            const price = asset ? asset.price : h.avgPrice;
            return { ticker: t, shares: h.shares, avgPrice: h.avgPrice, currentPrice: price, value: h.shares * price };
        })
    };

    const marketSnapshot = {
        stocks: stocksData || [],
        cryptos: cryptoData || []
    };

    try {
        const res = await fetch('/api/grok', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                portfolio: currentPortfolio,
                market: marketSnapshot,
                news: (newsData || []).slice(0, 3)
            })
        });
        const data = await res.json();

        grokHistory.push({ role: 'assistant', content: data.response });
        const aiDiv = document.createElement('div');
        aiDiv.innerHTML = `<div class="inline-block bg-white/5 px-4 py-2 rounded-2xl max-w-[85%] text-sm">${data.response}</div>`;
        chat.appendChild(aiDiv);
        chat.scrollTop = chat.scrollHeight;

        addSuggestionButtonsIfAny(data.response, chat);
    } catch (e) {
        const errDiv = document.createElement('div');
        errDiv.innerHTML = `<div class="inline-block bg-red-900/60 px-4 py-2 rounded-2xl text-sm">Orbital comms error. Try again.</div>`;
        chat.appendChild(errDiv);
    }
}

function sendQuickGrokPrompt(promptText) {
    const input = document.getElementById('grok-input');
    const chat = document.getElementById('grok-chat');
    if (!input || !chat) return;

    input.value = promptText;
    sendGrokMessage();
}

function addSuggestionButtonsIfAny(responseText, chatContainer) {
    const suggestions = [];
    // Very lightweight parser for actionable suggestions Grok might output
    const matches = [...responseText.matchAll(/(?:buy|add|take a position in)\s+(\d+(?:\.\d+)?)\s+([A-Z]{2,6}(?:-USD)?)/gi)];
    for (const m of matches) {
        const amt = parseFloat(m[1]);
        const tkr = m[2].toUpperCase();
        if (amt > 0 && tkr) suggestions.push({ ticker: tkr, amount: amt });
    }

    if (suggestions.length === 0) return;

    const btnRow = document.createElement('div');
    btnRow.className = 'flex flex-wrap gap-2 mt-2';

    suggestions.forEach(s => {
        const isCrypto = s.ticker.includes('-USD');
        const btn = document.createElement('button');
        btn.className = 'text-xs px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 rounded-2xl text-emerald-400';
        btn.textContent = `Apply: Buy ${s.amount} ${s.ticker}`;
        btn.onclick = () => {
            buyAsset(s.ticker, isCrypto ? s.amount : Math.floor(s.amount), isCrypto);
            hideGrokAgentModal();
        };
        btnRow.appendChild(btn);
    });

    chatContainer.appendChild(btnRow);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Make some functions global for inline onclicks
window.buyStock = buyStock;
window.advanceTime = advanceTime;
window.refreshStocks = refreshStocks;
window.refreshCrypto = refreshCrypto;
window.buyCryptoFromInput = buyCryptoFromInput;
window.showGrokAgentModal = showGrokAgentModal;

window.showInvestModal = () => {
    alert("Use the BUY buttons in the market table above to invest your $2,500.");
};

window.showProjections = () => {
    const el = document.getElementById('projections-content');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
};

// App Initialization — single entry point (launches, SSE stream, moon, Grok)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}