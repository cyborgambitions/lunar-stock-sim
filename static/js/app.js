// LUNARA - Cislunar Economy Portfolio Simulator
// Client-side simulation with real-time aerospace data

let portfolio = {
    cash: 2500,
    holdings: {} // { "RKLB": { shares: 10, avgPrice: 5.2 } }
};

let stocksData = [];
let cryptoData = [];
let newsData = [];
let launchesData = [];

function formatMoney(amount) {
    return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 0 });
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
        container.innerHTML = '<div class="text-white/40 text-center py-6">No upcoming launches found. Refreshing…</div>';
        return;
    }

    container.innerHTML = '';

    launchesData.forEach(launch => {
        const div = document.createElement('div');
        const isStarship = /starship|super heavy/i.test(launch.rocket || '') || /starship/i.test(launch.name || '');
        div.className = `px-3 py-2 rounded-lg flex items-start gap-x-2 text-[10px] ${isStarship ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-white/5'}`;
        const place = [launch.pad, launch.location].filter(Boolean).join(' • ');
        const country = launch.country ? ` (${launch.country})` : '';
        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="font-medium truncate">${launch.name}</div>
                <div class="text-white/50">${launch.provider} • ${launch.rocket}</div>
                ${place ? `<div class="text-[8px] text-white/30 mt-0.5 truncate">${place}${country}</div>` : ''}
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
        fetchLaunches()
    ]);

    renderPortfolio();

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