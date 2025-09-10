const fmtUSD = n => n.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits: 2 });
const fmtPct = n => (n>=0?'+':'') + n.toFixed(2) + '%';
const grid = document.getElementById('grid');
const totalEl = document.getElementById('total');
const dayEl = document.getElementById('day');
const chartModal = document.getElementById('chartModal');
const chartTitle = document.getElementById('chartTitle');
const chartContainer = document.getElementById('chartContainer');
const chartClose = document.getElementById('chartClose');
const chartPeriod = document.getElementById('chartPeriod');
let currentSymbol = null;
// TradingView Charting Library widget
let tvWidget = null;
let tvReady = false;

async function load() {
  try {
    const r = await fetch('/api/snapshot', { cache: 'no-cache' });
    if (!r.ok) throw new Error('No snapshot');
    const s = await r.json();
    totalEl.textContent = fmtUSD(s.total_value_usd || 0);
    dayEl.textContent = s.total_change_24h_pct==null ? '—' : fmtPct(s.total_change_24h_pct);
    dayEl.className = s.total_change_24h_pct >= 0 ? 'green' : 'red';
    renderPositions(s.positions || []);
  } catch (e) {
    console.error(e);
  }
}

function renderPositions(ps) {
  grid.innerHTML = '';
  for (const p of ps) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.symbol = p.symbol;
    const day = p.day_pct==null ? '—' : fmtPct(p.day_pct);
    const pnl = p.pnl_pct==null ? '—' : fmtPct(p.pnl_pct);
    const dayCls = p.day_pct==null ? '' : (p.day_pct>=0 ? 'green' : 'red');
    const pnlCls = p.pnl_pct==null ? '' : (p.pnl_pct>=0 ? 'green' : 'red');
    const warn = p.pnl_pct==null ? '<div class="warn">cost basis missing</div>' : '';
    card.innerHTML = `
      <div class="sym">${p.symbol}</div>
      <div class="value">${fmtUSD(p.value || 0)} · ${p.free} @ ${p.price==null?'—':fmtUSD(p.price)}</div>
      <div class="meta">
        <div class="${dayCls}">24h ${day}</div>
        <div class="${pnlCls}">P/L ${pnl}</div>
        ${p.unreconciled ? '<div class="warn">unreconciled</div>' : ''}
      </div>
      ${warn}
    `;
    card.addEventListener('click', () => openChart(p.symbol));
    grid.appendChild(card);
  }
}

// set active nav without inline scripts (CSP-safe)
(() => {
  const pth = location.pathname;
  if (pth === '/' || pth === '/index.html') document.getElementById('nav-dashboard').classList.add('active');
  if (pth.endsWith('/lots.html')) document.getElementById('nav-lots').classList.add('active');
})();

document.getElementById('refresh').addEventListener('click', load);
load();
setInterval(load, 30_000);

// --- Simple K-line modal and renderer ---
chartClose.addEventListener('click', () => {
  chartModal.style.display = 'none';
  // Clean up TV widget if used
  if (tvWidget && tvWidget.remove) {
    try { tvWidget.remove(); } catch (e) {}
  }
  tvWidget = null;
  tvReady = false;
});
chartModal.addEventListener('click', (e) => { if (e.target === chartModal) chartModal.style.display = 'none'; });
chartPeriod.addEventListener('change', () => {
  if (!currentSymbol) return;
  if (canUseTV() && tvWidget) {
    setTVResolution(chartPeriod.value);
  } else {
    // If TV not available yet, reinitialize
    ensureTV(currentSymbol, chartPeriod.value);
  }
});

async function openChart(symbol) {
  currentSymbol = symbol;
  chartTitle.textContent = `${symbol} · ${periodLabel(chartPeriod.value)}`;
  chartModal.style.display = 'flex';
  ensureTV(symbol, chartPeriod.value);
}

function periodLabel(p){ return p==='60min'?'1h':p==='15min'?'15m':p==='4hour'?'4h':p==='1day'?'1d':p; }

function periodToTVRes(p){ return p==='60min'?'60':p==='15min'?'15':p==='4hour'?'240':p==='1day'?'D':'60'; }
function canUseTV(){ return !!(window.TradingView && window.TradingView.widget && window.HTXDatafeed); }

function ensureTV(symbol, period) {
  // Clear container to avoid overlaying charts
  chartContainer.innerHTML = '';
  const interval = periodToTVRes(period);
  tvWidget = new TradingView.widget({
    symbol: symbol.toUpperCase(),
    interval,
    // TradingView expects a container ID string, not a DOM node
    container: 'chartContainer',
    library_path: '/vendor/charting_library/',
    datafeed: new window.HTXDatafeed('/api'),
    timezone: 'Etc/UTC',
    autosize: true,
    theme: 'dark',
    locale: 'en',
    enabled_features: ['left_toolbar', 'keep_left_toolbar_visible_on_small_screens'],
    disabled_features: ['use_localstorage_for_settings'],
  });
  tvWidget.onChartReady(() => { tvReady = true; });
}

function setTVResolution(period) {
  if (!tvWidget) return;
  const res = periodToTVRes(period);
  try {
    tvWidget.chart().setResolution(res, () => {});
    chartTitle.textContent = `${currentSymbol} · ${periodLabel(period)}`;
  } catch (e) {
    console.warn('Failed to set TV resolution', e);
  }
}

// Lightweight chart path removed for simplicity; TV is required for drawings
