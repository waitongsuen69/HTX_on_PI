const fmtUSD = n => n.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits: 2 });
const fmtNum = (n, max=2) => Number(n||0).toLocaleString(undefined, { maximumFractionDigits: max });
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
const refreshBtn = document.getElementById('refresh');
const baselineSwitch = document.getElementById('baselineSwitch');
const TOGGLE_KEY = 'baselineMode';
let baselineMode = (localStorage.getItem(TOGGLE_KEY) || 'close');

function updateToggleUI() {
  if (!baselineSwitch) return;
  const on = baselineMode === 'vwap';
  baselineSwitch.classList.toggle('on', on);
  baselineSwitch.setAttribute('aria-checked', String(on));
}
const lastManualEl = document.getElementById('lastManual');
const lastAutoEl = document.getElementById('lastAuto');

function setLoading(on) {
  if (!refreshBtn) return;
  if (on) {
    refreshBtn.classList.add('loading');
    refreshBtn.setAttribute('aria-busy', 'true');
    refreshBtn.disabled = true;
  } else {
    refreshBtn.classList.remove('loading');
    refreshBtn.removeAttribute('aria-busy');
    refreshBtn.disabled = false;
  }
}

function fmtTime(ts){ const d=new Date(ts); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }

function markRefreshed(kind) {
  const now = Date.now();
  if (kind === 'manual') {
    if (lastManualEl) lastManualEl.textContent = fmtTime(now);
  } else if (kind === 'auto') {
    if (lastAutoEl) lastAutoEl.textContent = fmtTime(now);
  }
}

async function load(kind) {
  setLoading(true);
  try {
    const r = await fetch(`/api/snapshot?baselineMode=${encodeURIComponent(baselineMode)}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('No snapshot');
    const s = await r.json();
    totalEl.textContent = fmtNum(s.total_value_usd || 0, 2);
    dayEl.textContent = s.total_change_24h_pct==null ? '—' : fmtPct(s.total_change_24h_pct);
    dayEl.className = s.total_change_24h_pct >= 0 ? 'green' : 'red';
    renderPositions(s.positions || [], Number(s.total_value_usd || 0));
    renderAllocation(s.positions || [], Number(s.total_value_usd || 0));
    if (kind) markRefreshed(kind);
  } catch (e) {
    console.error(e);
  } finally {
    setLoading(false);
  }
}

function renderPositions(ps, totalWorth) {
  grid.innerHTML = '';
  const isStable = (sym) => sym === 'USDT' || sym === 'USDC';
  const arr = [...ps].sort((a, b) => {
    const as = isStable(a.symbol || '');
    const bs = isStable(b.symbol || '');
    if (as && !bs) return 1; // stables last
    if (!as && bs) return -1;
    const av = Number((a.value != null ? a.value : ((a.free || 0) * (a.price || 0))) || 0);
    const bv = Number((b.value != null ? b.value : ((b.free || 0) * (b.price || 0))) || 0);
    return bv - av; // higher value first
  });
  for (const p of arr) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.symbol = p.symbol;
    const worth = Number((p.value != null ? p.value : ((p.free || 0) * (p.price || 0))) || 0);
    const priceStr = p.price==null ? '—' : fmtNum(p.price, (p.price < 1 ? 6 : 2));
    const weightPct = totalWorth > 0 ? (worth / totalWorth * 100) : 0;
    const c1d = (p.change_1d_pct!=null ? p.change_1d_pct : (p.day_pct!=null ? p.day_pct : null));
    if (c1d == null || c1d === 0) card.classList.add('flat');
    else if (c1d > 0) card.classList.add('rise');
    else card.classList.add('fall');
    const day = c1d==null ? '—' : fmtPct(c1d);
    const wk = p.change_7d_pct==null ? '—' : fmtPct(p.change_7d_pct);
    const mo = p.change_30d_pct==null ? '—' : fmtPct(p.change_30d_pct);
    const dayCls = c1d==null ? '' : (c1d>=0 ? 'green' : 'red');
    const wkCls = p.change_7d_pct==null ? '' : (p.change_7d_pct>=0 ? 'green' : 'red');
    const moCls = p.change_30d_pct==null ? '' : (p.change_30d_pct>=0 ? 'green' : 'red');
    card.innerHTML = `
      <div class="sym">${p.symbol}</div>
      <div class="kv"><span class="k">Qty</span><span class="v">${p.free}</span></div>
      <div class="kv"><span class="k">Price</span><span class="v">${priceStr}</span></div>
      <div class="kv"><span class="k">Value</span><span class="v">${fmtNum(worth, 2)}</span></div>
      <div class="kv"><span class="k">Weight</span><span class="v">${fmtNum(weightPct, 2)}%</span></div>
      <div class="meta">
        <div class="${dayCls}" title="24h price change">24h ${day}</div>
        <div class="${wkCls}" title="7d price change">7d ${wk}</div>
        <div class="${moCls}" title="30d price change">30d ${mo}</div>
      </div>
    `;
    card.addEventListener('click', () => openChart(p.symbol));
    grid.appendChild(card);
  }
}

function renderAllocation(ps, totalWorth) {
  const bar = document.getElementById('allocBar');
  const cryptoLabel = document.getElementById('allocCryptoLabel');
  const cashLabel = document.getElementById('allocCashLabel');
  bar.innerHTML = '';
  totalWorth = Number(totalWorth || 0);
  const isStable = (sym) => sym === 'USDT' || sym === 'USDC';
  const PALETTE = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948',
    '#b07aa1', '#ff9da7', '#9c755f', '#86bcf0', '#f1ce63', '#8cd17d'
  ];
  const items = (ps || []).map(p => ({
    symbol: p.symbol,
    free: Number(p.free || 0),
    worth: Number((p.value != null ? p.value : ((p.free || 0) * (p.price || 0))) || 0),
  })).filter(x => x.worth > 0);
  const stable = items.filter(x => isStable(x.symbol));
  const crypto = items.filter(x => !isStable(x.symbol));
  const sumCrypto = crypto.reduce((a, x) => a + x.worth, 0);
  const sumStable = stable.reduce((a, x) => a + x.worth, 0);
  const denom = totalWorth > 0 ? totalWorth : (sumCrypto + sumStable);
  const cryptoPct = denom > 0 ? (sumCrypto / denom * 100) : 0;
  const cashPct = denom > 0 ? (sumStable / denom * 100) : 0;
  cryptoLabel.textContent = `Crypto — ${fmtNum(cryptoPct, 2)}%`;
  cashLabel.textContent = `Cash — ${fmtNum(cashPct, 2)}%`;

  // Sort crypto ascending by weight and create segments first (left side)
  crypto
    .map(x => ({ ...x, pct: denom > 0 ? (x.worth / denom * 100) : 0 }))
    .filter(x => x.pct > 0)
    .sort((a, b) => a.pct - b.pct)
    .forEach((x, i) => {
      const seg = document.createElement('div');
      seg.className = 'alloc-seg';
      seg.style.width = `${x.pct}%`;
      seg.style.minWidth = '1px';
      seg.style.background = PALETTE[i % PALETTE.length];
      seg.style.boxShadow = 'inset -1px 0 0 rgba(0,0,0,0.35)';
      attachTooltip(seg, {
        title: x.symbol,
        qty: fmtNum(x.free, 8),
        value: fmtNum(x.worth, 2),
        weight: fmtNum(x.pct, 2) + '%',
      });
      bar.appendChild(seg);
    });

  // Cash (USDT+USDC) as one right-side segment
  if (cashPct > 0) {
    const seg = document.createElement('div');
    seg.className = 'alloc-seg';
    seg.style.width = `${cashPct}%`;
    seg.style.minWidth = '1px';
    seg.style.background = '#344559';
    seg.style.boxShadow = 'inset -1px 0 0 rgba(0,0,0,0.35)';
    const usdt = stable.find(s => s.symbol === 'USDT') || { free: 0, worth: 0 };
    const usdc = stable.find(s => s.symbol === 'USDC') || { free: 0, worth: 0 };
    attachTooltip(seg, {
      title: 'Cash (USDT+USDC)',
      qty: `USDT ${fmtNum(usdt.free, 2)}, USDC ${fmtNum(usdc.free, 2)}`,
      value: fmtNum(sumStable, 2),
      weight: fmtNum(cashPct, 2) + '%',
    });
    bar.appendChild(seg);
  }
}

function getTooltip() {
  let el = document.getElementById('tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tooltip';
    el.className = 'tooltip';
    document.body.appendChild(el);
  }
  return el;
}

function showTooltip(content, x, y) {
  const el = getTooltip();
  el.innerHTML = content;
  el.style.display = 'block';
  const pad = 10;
  let left = x + pad;
  let top = y + pad;
  // simple viewport clamp
  const rect = el.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width - pad);
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - rect.height - pad);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function hideTooltip() {
  const el = getTooltip();
  el.style.display = 'none';
}

function attachTooltip(seg, data) {
  const html = `
    <div style="font-weight:600; margin-bottom:4px;">${data.title}</div>
    <div>Qty: ${data.qty}</div>
    <div>Value: ${data.value}</div>
    <div>Weight: ${data.weight}</div>
  `;
  seg.addEventListener('mouseenter', (e) => showTooltip(html, e.clientX, e.clientY));
  seg.addEventListener('mousemove', (e) => showTooltip(html, e.clientX, e.clientY));
  seg.addEventListener('mouseleave', hideTooltip);
  seg.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0] ? e.touches[0] : { clientX: 0, clientY: 0 };
    showTooltip(html, t.clientX, t.clientY);
    const once = () => { hideTooltip(); document.removeEventListener('touchstart', once, true); };
    document.addEventListener('touchstart', once, true);
  }, { passive: true });
  seg.addEventListener('click', (e) => {
    showTooltip(html, e.clientX, e.clientY);
    const once = (ev) => {
      if (!seg.contains(ev.target)) { hideTooltip(); document.removeEventListener('click', once, true); }
    };
    document.addEventListener('click', once, true);
  });
}

// Nav highlighting is handled by nav.js after it injects the toolbar

refreshBtn.addEventListener('click', () => load('manual'));
if (baselineSwitch) {
  baselineSwitch.addEventListener('click', () => {
    baselineMode = (baselineMode === 'close') ? 'vwap' : 'close';
    localStorage.setItem(TOGGLE_KEY, baselineMode);
    updateToggleUI();
    load('manual');
  });
  updateToggleUI();
}
load('auto');
setInterval(() => load('auto'), 30_000);

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
