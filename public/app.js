const fmtUSD = n => n.toLocaleString(undefined, { style:'currency', currency:'USD', maximumFractionDigits: 2 });
const fmtPct = n => (n>=0?'+':'') + n.toFixed(2) + '%';
const grid = document.getElementById('grid');
const totalEl = document.getElementById('total');
const dayEl = document.getElementById('day');

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
    grid.appendChild(card);
  }
}

document.getElementById('refresh').addEventListener('click', load);
load();
setInterval(load, 30_000);

