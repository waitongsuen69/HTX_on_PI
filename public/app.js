const fmtUSD = n => n.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits: 2 });
const fmtPct = n => (n>=0?'+':'') + n.toFixed(2) + '%';
const grid = document.getElementById('grid');
const totalEl = document.getElementById('total');
const dayEl = document.getElementById('day');
const chartModal = document.getElementById('chartModal');
const chartTitle = document.getElementById('chartTitle');
const chartCanvas = document.getElementById('chartCanvas');
const chartClose = document.getElementById('chartClose');
const chartPeriod = document.getElementById('chartPeriod');
let currentSymbol = null;

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
  await fetchAndDraw(symbol, chartPeriod.value);
}

function periodLabel(p){ return p==='60min'?'1h':p==='15min'?'15m':p==='4hour'?'4h':p==='1day'?'1d':p; }

async function fetchAndDraw(symbol, period) {
  try {
    chartTitle.textContent = `${symbol} · ${periodLabel(period)}`;
    const r = await fetch(`/api/market/kline?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&n=200`, { cache: 'no-cache' });
    const data = await r.json();
    if (!r.ok) throw new Error(data && data.message || 'failed');
    drawCandles(chartCanvas, data.rows || []);
  } catch (e) {
    console.error(e);
  }
}

function drawCandles(canvas, rows) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height;
  ctx.clearRect(0,0,W,H);
  if (!rows || !rows.length) { drawEmpty(ctx, W, H, 'No data'); return; }
  // Compute min/max
  let min = Infinity, max = -Infinity;
  for (const r of rows) { if (isFinite(r.low)) min = Math.min(min, r.low); if (isFinite(r.high)) max = Math.max(max, r.high); }
  if (!isFinite(min) || !isFinite(max) || min===max) { drawEmpty(ctx, W, H, 'No range'); return; }
  // Padding top/bottom 2%
  const pad = (max - min) * 0.02; min -= pad; max += pad;
  // Layout: leave left margin for scale
  const LM = 40, RM = 8, TM = 10, BM = 18;
  const plotW = W - LM - RM, plotH = H - TM - BM;
  // Map price->y
  const yAt = (v) => TM + plotH - (v - min) / (max - min) * plotH;
  // Background grid
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = '#182230'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i=0;i<=4;i++) { const y = TM + (plotH*i/4); ctx.moveTo(LM, y); ctx.lineTo(W-RM, y); }
  ctx.stroke();
  // Price scale
  ctx.fillStyle = '#8aa0b6'; ctx.font = '12px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i=0;i<=4;i++) { const v = min + (max-min)*i/4; const y = TM + plotH - (plotH*i/4); ctx.fillText(v.toFixed(6).replace(/0+$/,'').replace(/\.$/,''), LM-6, y); }
  // Candles
  const n = rows.length; const cw = Math.max(2, Math.floor(plotW / n * 0.7));
  const gap = Math.max(1, Math.floor(plotW / n - cw));
  let x = LM + Math.max(0, plotW - (cw+gap)*n);
  for (const r of rows) {
    const o = r.open, c = r.close, h = r.high, l = r.low;
    const up = c >= o;
    const color = up ? '#16c784' : '#ea3943';
    const yO = yAt(o), yC = yAt(c), yH = yAt(h), yL = yAt(l);
    const bodyTop = Math.min(yO, yC), bodyBot = Math.max(yO, yC);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    // Wick
    ctx.beginPath(); ctx.moveTo(x + cw/2, yH); ctx.lineTo(x + cw/2, yL); ctx.stroke();
    // Body
    const bodyH = Math.max(1, bodyBot - bodyTop);
    if (up) { ctx.strokeRect(x, bodyTop, cw, bodyH); }
    else { ctx.fillRect(x, bodyTop, cw, bodyH); }
    x += cw + gap;
  }
  // Time axis labels (start and end)
  ctx.fillStyle = '#8aa0b6'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const first = new Date(rows[0].ts), last = new Date(rows[rows.length-1].ts);
  ctx.fillText(shortTime(first), LM + 40, H - BM + 2);
  ctx.fillText(shortTime(last), W - RM - 40, H - BM + 2);
}

function drawEmpty(ctx, W, H, msg){ ctx.fillStyle='#0b0f14'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#8aa0b6'; ctx.font='14px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(msg, W/2, H/2); }
function shortTime(d){ return d.toLocaleString(undefined, { hour:'2-digit', minute:'2-digit', month:'2-digit', day:'2-digit' }); }
