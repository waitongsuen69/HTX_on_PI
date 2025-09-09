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
let tvChart = null;
let candleSeries = null;
let resizeObs = null;

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
chartClose.addEventListener('click', () => { chartModal.style.display = 'none'; });
chartModal.addEventListener('click', (e) => { if (e.target === chartModal) chartModal.style.display = 'none'; });
chartPeriod.addEventListener('change', () => { if (currentSymbol) fetchAndDraw(currentSymbol, chartPeriod.value); });

async function openChart(symbol) {
  currentSymbol = symbol;
  chartTitle.textContent = `${symbol} · ${periodLabel(chartPeriod.value)}`;
  chartModal.style.display = 'flex';
  ensureChart();
  await fetchAndDraw(symbol, chartPeriod.value);
}

function periodLabel(p){ return p==='60min'?'1h':p==='15min'?'15m':p==='4hour'?'4h':p==='1day'?'1d':p; }

async function fetchAndDraw(symbol, period) {
  try {
    chartTitle.textContent = `${symbol} · ${periodLabel(period)}`;
    const r = await fetch(`/api/market/kline?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&n=200`, { cache: 'no-cache' });
    const data = await r.json();
    if (!r.ok) throw new Error(data && data.message || 'failed');
    setCandles(data.rows || []);
  } catch (e) {
    console.error(e);
  }
}

function ensureChart() {
  if (tvChart) return;
  const opt = {
    layout: { background: { type: 'solid', color: '#0b0f14' }, textColor: '#8aa0b6' },
    crosshair: { mode: 0 },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    grid: { vertLines: { color: '#182230' }, horzLines: { color: '#182230' } },
    autoSize: true,
  };
  tvChart = window.LightweightCharts.createChart(chartContainer, opt);
  candleSeries = tvChart.addCandlestickSeries({
    upColor: '#16c784', downColor: '#ea3943', borderUpColor: '#16c784', borderDownColor: '#ea3943', wickUpColor: '#16c784', wickDownColor: '#ea3943',
  });
  // Resize observer for container width changes
  if ('ResizeObserver' in window) {
    resizeObs = new ResizeObserver(() => {
      // autoSize handles it, but ensure redraw
      tvChart.timeScale().fitContent();
    });
    resizeObs.observe(chartContainer);
  }
}

function setCandles(rows) {
  if (!tvChart || !candleSeries) ensureChart();
  const data = (rows || []).map(r => ({ time: Math.floor(r.ts / 1000), open: r.open, high: r.high, low: r.low, close: r.close }));
  candleSeries.setData(data);
  tvChart.timeScale().fitContent();
}
