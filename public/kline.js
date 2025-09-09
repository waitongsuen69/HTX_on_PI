function qs(name, def='') {
  const u = new URL(location.href);
  return u.searchParams.get(name) || def;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function bucketize(candles, target) {
  if (candles.length <= target) return candles;
  const size = Math.ceil(candles.length / target);
  const out = [];
  for (let i = 0; i < candles.length; i += size) {
    const chunk = candles.slice(i, i + size);
    if (!chunk.length) continue;
    const o = chunk[0].open;
    const c = chunk[chunk.length - 1].close;
    let h = -Infinity, l = Infinity;
    for (const k of chunk) { if (k.high > h) h = k.high; if (k.low < l) l = k.low; }
    out.push({ ts: chunk[0].ts, open: o, high: h, low: l, close: c });
  }
  return out;
}

function drawCandles(canvas, candles) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!candles.length) return;
  // Downsample to ~one candle per pixel column
  const ds = bucketize(candles, Math.max(50, Math.floor(W)));
  let hi = -Infinity, lo = Infinity;
  for (const k of ds) { if (k.high > hi) hi = k.high; if (k.low < lo) lo = k.low; }
  const padTop = 10, padBot = 16, padLeft = 6, padRight = 6;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBot;
  const n = ds.length;
  const xGap = chartW / Math.max(1, n);
  function y(v) { return padTop + (hi - v) * (chartH / (hi - lo || 1)); }
  ctx.lineWidth = 1;
  for (let i=0;i<n;i++) {
    const k = ds[i];
    const x = Math.floor(padLeft + i * xGap + xGap * 0.5);
    const up = k.close >= k.open;
    const col = up ? '#16c784' : '#ea3943';
    // Wick
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y(k.high));
    ctx.lineTo(x, y(k.low));
    ctx.stroke();
    // Body
    const w = Math.max(1, Math.floor(xGap * 0.7));
    const y1 = y(k.open), y2 = y(k.close);
    const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1));
    ctx.fillStyle = col;
    ctx.fillRect(x - Math.floor(w/2), top, w, h);
  }
  // Grid lines (optional): min/max labels
  ctx.fillStyle = '#8aa0bd';
  ctx.font = '12px system-ui';
  ctx.fillText(hi.toFixed(5), padLeft, padTop + 10);
  ctx.fillText(lo.toFixed(5), padLeft, padTop + chartH);
}

async function load() {
  const symbol = document.getElementById('symbol').value.trim().toUpperCase();
  const period = document.getElementById('period').value;
  const count = Number(document.getElementById('count').value || 400);
  const url = `/api/kline?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&count=${count}`;
  const legend = document.getElementById('legend');
  legend.textContent = `Loading ${symbol} ${period} x ${count} ...`;
  const data = await fetchJSON(url);
  legend.textContent = `${data.symbol} ${data.period} · ${data.count} points`;
  const canvas = document.getElementById('chart');
  resizeCanvas(canvas);
  drawCandles(canvas, data.candles || []);
}

window.addEventListener('DOMContentLoaded', async () => {
  const sym = qs('symbol', 'BTC').toUpperCase();
  const per = qs('period', '60min');
  document.getElementById('symbol').value = sym;
  document.getElementById('period').value = per;
  document.getElementById('load').onclick = load;
  window.addEventListener('resize', () => { const c = document.getElementById('chart'); resizeCanvas(c); load(); });
  await load();
});
