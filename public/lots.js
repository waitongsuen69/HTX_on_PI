// Nav highlighting is handled by nav.js after it injects the toolbar

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && body.message) || r.statusText);
  return body;
}

function toast(msg, ok=true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = ok ? '#3a3' : '#a33';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 2000);
}

async function loadLots() {
  const data = await fetchJSON('/api/lots');
  document.getElementById('backend').textContent = 'Backend: ' + data.meta.backend;
  document.getElementById('updated').textContent = new Date(data.meta.updated_at).toLocaleString();
  const select = document.getElementById('assetFilter');
  const assets = data.assets.map(a => a.asset);
  const cur = select.value;
  select.innerHTML = '<option value="">All</option>' + assets.map(a => `<option${a===cur?' selected':''}>${a}</option>`).join('');
  const filter = select.value;
  const tbody = document.querySelector('#lotsTable tbody');
  tbody.innerHTML = '';
  const show = data.assets.filter(a => !filter || a.asset === filter);
  const summaryEl = document.getElementById('summary');
  summaryEl.innerHTML = show.map(a => {
    const s = a.summary;
    return `<div>${a.asset}: qty=${s.total_qty.toFixed(8)} avg=$${s.avg_cost_usd==null?'-':s.avg_cost_usd.toFixed(6)} UPL=${s.unrealized_pl_usd==null?'-':s.unrealized_pl_usd.toFixed(2)}</div>`;
  }).join('');
  for (const a of show) {
    for (const l of a.lots) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${l.id}</td><td>${fmtDate(l.ts)}</td><td>${a.asset}</td><td>${l.action}</td><td>${l.qty}</td><td>${l.unit_cost_usd??''}</td><td>${l.note||''}</td><td><button data-id="${l.id}" class="del">Delete</button></td>`;
      tbody.appendChild(tr);
    }
  }
  tbody.querySelectorAll('button.del').forEach(btn => btn.onclick = async () => {
    try { await fetchJSON('/api/lots/'+btn.dataset.id, { method: 'DELETE' }); toast('Deleted'); loadLots(); } catch(e){ toast(e.message,false); }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnRefresh').onclick = loadLots;
  document.getElementById('assetFilter').onchange = loadLots;
  document.getElementById('btnCreate').onclick = async () => {
    const date = document.getElementById('date').value;
    const asset = document.getElementById('asset').value.trim();
    const action = document.getElementById('action').value;
    const qty = parseFloat(document.getElementById('qty').value);
    const unit_cost_usd = document.getElementById('unit_cost_usd').value;
    const note = document.getElementById('note').value;
    try {
      await fetchJSON('/api/lots', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ date: new Date(date).toISOString(), asset, action, qty, unit_cost_usd: unit_cost_usd===''?null:parseFloat(unit_cost_usd), note }) });
      toast('Created');
      loadLots();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById('btnExportCsv').onclick = () => { window.location.href = '/api/lots/export?format=csv'; };
  document.getElementById('btnExportJson').onclick = () => { window.location.href = '/api/lots/export?format=json'; };
  document.getElementById('btnSyncTrades').onclick = async () => {
    const btn = document.getElementById('btnSyncTrades');
    const prog = document.getElementById('syncProgress');
    const logEl = document.getElementById('syncLog');
    const iconEl = document.getElementById('syncIcon');
    const feedEl = document.getElementById('syncFeed');
    const feed = [];
    function appendFeed(msg) {
      const ts = new Date().toLocaleTimeString();
      feed.push(`[${ts}] ${msg}`);
      // keep last 50
      while (feed.length > 50) feed.shift();
      feedEl.innerHTML = feed.slice(-10).map(line => `<div>${escapeHtml(line)}</div>`).join('');
      feedEl.scrollTop = feedEl.scrollHeight;
    }
    function escapeHtml(s){ return String(s).replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
    btn.disabled = true; prog.value = 0; logEl.textContent = 'Starting...'; feedEl.innerHTML = '';
    iconEl.className = 'spinner'; iconEl.textContent = '';
    let done = false;
    try {
      const es = new EventSource('/api/lots/sync-trades-stream?days=120');
      es.addEventListener('progress', (ev) => {
        try {
          const data = JSON.parse(ev.data);
          prog.value = data.percent || 0;
          if (data.message) { logEl.textContent = data.message; appendFeed(data.message); }
        } catch (_) {}
      });
      es.addEventListener('done', (ev) => {
        done = true;
        try {
          const data = JSON.parse(ev.data);
          toast(`Synced trades. New lots: ${data.created || 0}, skipped: ${data.skipped || 0}`);
          // Show success/failure icon based on saved flag
          if (data.saved === false) {
            iconEl.className = 'icon-err'; iconEl.textContent = '✖';
          } else {
            iconEl.className = 'icon-ok'; iconEl.textContent = '✓';
          }
          appendFeed('Done');
        } catch (_) { toast('Sync finished'); }
        es.close();
        btn.disabled = false;
        prog.value = 100;
        loadLots();
      });
      es.addEventListener('error', (ev) => {
        try { const data = JSON.parse(ev.data); toast('Sync error: ' + data.message, false); } catch (_) { toast('Sync error', false); }
        iconEl.className = 'icon-err'; iconEl.textContent = '✖';
        appendFeed('Error occurred');
        es.close(); btn.disabled = false;
      });
      // Fallback timeout safety
      setTimeout(async () => {
        if (done) return;
        try {
          const r = await fetchJSON('/api/lots/sync-trades?days=120', { method: 'POST' });
          toast(`Synced trades. New lots: ${r.created || 0}, skipped: ${r.skipped || 0}`);
          if (r.saved === false) { iconEl.className = 'icon-err'; iconEl.textContent = '✖'; }
          else { iconEl.className = 'icon-ok'; iconEl.textContent = '✓'; }
          appendFeed('Done (fallback)');
          loadLots();
        } catch (e) { toast(e.message, false); }
        btn.disabled = false;
      }, 30000);
    } catch (e) {
      btn.disabled = false; toast(e.message, false);
      iconEl.className = 'icon-err'; iconEl.textContent = '✖';
      appendFeed('Error: ' + e.message);
    }
  };
  const fi = document.getElementById('fileInput');
  document.getElementById('btnImport').onclick = () => fi.click();
  fi.onchange = async () => {
    if (!fi.files[0]) return;
    const fd = new FormData();
    fd.append('file', fi.files[0]);
    try {
      await fetchJSON('/api/lots/import', { method: 'POST', body: fd });
      toast('Imported');
      loadLots();
    } catch (e) { toast(e.message, false); }
    fi.value = '';
  };
  loadLots();
});
function fmtDate(ts) {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}/${m}/${day}`;
  } catch { return ts; }
}
