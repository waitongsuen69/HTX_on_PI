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
const DEFAULT_VISIBLE_BARS = 150; // default number of candles to show

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
    const r = await fetch(`/api/kline?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&count=6000`, { cache: 'no-cache' });
    const data = await r.json();
    if (!r.ok) throw new Error(data && data.message || 'failed');
    const rows = (data.candles || []).map(k => ({ ts: k.ts, open: k.open, high: k.high, low: k.low, close: k.close }));
    setCandles(rows);
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
      // autoSize will resize; keep current visible range (no fitContent).
    });
    resizeObs.observe(chartContainer);
  }
}

function sanitizeRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const t = Math.floor((r.ts || 0) / 1000);
    const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close);
    if (!isFinite(t) || t <= 0) continue;
    if (![o,h,l,c].every(Number.isFinite)) continue;
    const hi = Math.max(o, c, h);
    const lo = Math.min(o, c, l);
    // fix swapped or degenerate values
    const high = Math.max(h, hi);
    const low = Math.min(l, lo);
    if (high < low) continue;
    out.push({ time: t, open: o, high, low, close: c });
  }
  // ensure sorted by time and unique times
  out.sort((a,b) => a.time - b.time);
  const uniq = [];
  let lastTime = -1;
  for (const r of out) { if (r.time !== lastTime) { uniq.push(r); lastTime = r.time; } }
  return uniq;
}

function setCandles(rows) {
  if (!tvChart || !candleSeries) ensureChart();
  const data = sanitizeRows(rows);
  try {
    candleSeries.setData(data);
  } catch (e) {
    console.error('setData failed', e);
  }
  // Show only the last N candles by default
  try {
    const n = Math.max(1, DEFAULT_VISIBLE_BARS);
    if (data.length >= 2) {
      const fromIdx = Math.max(0, data.length - n);
      const from = data[fromIdx].time;
      const to = data[data.length - 1].time;
      tvChart.timeScale().setVisibleRange({ from, to });
    }
  } catch (e) {
    console.warn('Failed to set visible range', e);
  }
}
