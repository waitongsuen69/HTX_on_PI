const state = { items: [], sortKey: 'name', sortDir: 'asc', editingId: null };

function toast(msg, ms = 1600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

async function load() {
  const res = await fetch('/api/accounts');
  if (!res.ok) throw new Error('Failed to load accounts');
  const json = await res.json();
  state.items = json.items || [];
  state.tron = json.tron || { api_key: '' };
  state.cardano = json.cardano || { project_id: '' };
}

function fmtTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  } catch (_) { return String(ts); }
}

function sortItems(items) {
  const key = state.sortKey;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  const arr = [...items];
  arr.sort((a, b) => {
    let av = String((a[key] ?? '')).toLowerCase();
    let bv = String((b[key] ?? '')).toLowerCase();
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
  return arr;
}

function filtered(items) { return items; }

function render() {
  const tbody = document.getElementById('rows');
  let items = filtered(state.items);
  items = sortItems(items);
  const rows = items.map((a) => {
    const statusClass = `pill status ${a.status}`;
    const dotColor = a.status === 'ok' ? '#0aff7a' : a.status === 'warn' ? '#ffd166' : '#ff6b6b';
    const isDexType = (String(a.type || '').toLowerCase() === 'dex');
    const badgeVal = isDexType ? (a.chain || '—') : (a.platform || '—');
    let detail = '';
    if (isDexType && a.chain === 'cardano') {
      if ((a.track_by || 'stake') === 'stake' && a.stake) detail = ` — <span class="muted">${String(a.stake).slice(0, 12)}…</span>`;
      else if (Array.isArray(a.addresses)) detail = ` — <span class="muted">${a.addresses.length} addr</span>`;
    }
    const badge = `<span class="badge">${badgeVal}</span>${detail}`;
    const trClass = a.enabled ? '' : 'row-disabled';
        const today = `<span class="today">${Number((a.today && a.today.calls) || 0)} calls</span>`;
    return `
      <tr class="${trClass}">
        <td>${a.name}</td>
        <td>${badge}</td>
        <td><span class="muted">${(a.type || '').toUpperCase()}</span></td>
        <td><span class="${statusClass}"><span class="dot" style="background:${dotColor}"></span>${(a.status || 'ok').toUpperCase()}</span></td>
                <td>${today}</td>
        <td>${fmtTime(a.last_used)}</td>
        <td>
          <div class="ops">
            <button title="Toggle" data-act="toggle" data-id="${a.id}">${a.enabled ? '⏻' : '⭘'}</button>
            <button title="Details" data-act="details" data-id=\"${a.id}\">ℹ️</button>
            <button title=\"Edit\" data-act=\"edit\" data-id="${a.id}">✏️</button>
            <button title="Delete" data-act="del" data-id="${a.id}">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
  tbody.innerHTML = rows || `<tr><td colspan="7" class="muted" style="text-align:center; padding:16px;">No accounts</td></tr>`;

  tbody.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const act = e.currentTarget.getAttribute('data-act');
      if (act === 'toggle') return onToggle(id);
      if (act === 'details') return onDetails(id);
      if (act === 'edit') return onEdit(id);
      if (act === 'del') return onDelete(id);
    });
  });
}

async function onToggle(id) {
  const res = await fetch(`/api/accounts/${id}/toggle`, { method: 'POST' });
  if (!res.ok) { toast('Toggle failed'); return; }
  await load();
  render();
  toast('Updated');
}

function openModal(title) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modal').style.display = 'flex';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }
function openDetailModal(title) { document.getElementById('detailTitle').textContent = title || 'Account Details'; document.getElementById('detailModal').style.display = 'flex'; }
function closeDetailModal() { document.getElementById('detailModal').style.display = 'none'; }

function openTronHelp() { const m = document.getElementById('tronHelpModal'); if (m) m.style.display = 'flex'; }
function closeTronHelp() { const m = document.getElementById('tronHelpModal'); if (m) m.style.display = 'none'; }
function openBlockfrostHelp() { const m = document.getElementById('blockfrostHelpModal'); if (m) m.style.display = 'flex'; }
function closeBlockfrostHelp() { const m = document.getElementById('blockfrostHelpModal'); if (m) m.style.display = 'none'; }

function fmtQty(q) {
  const n = Number(q || 0);
  if (n === 0) return '0';
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

async function onDetails(id) {
  try {
    const acc = state.items.find(x => x.id === id);
    openDetailModal(acc ? `Details — ${acc.name}` : 'Account Details');
    const tbody = document.getElementById('detailRows');
    tbody.innerHTML = '<tr><td colspan="3" class="muted" style="padding:8px;">Loading…</td></tr>';
    const res = await fetch(`/api/accounts/${id}/assets`);
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="3" class="muted" style="padding:8px;">Failed to load</td></tr>'; return; }
    const json = await res.json();
    if (json.error) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted" style="padding:8px;">${json.message || 'No data'}</td></tr>`;
      return;
    }
    const rows = (json.items || []).map(it => {
      const source = it.chain ? `On-chain · ${String(it.chain).toUpperCase()}` : (it.platform ? `CEX · ${it.platform}` : '');
      return `<tr><td style=\"padding:6px 8px;\">${String(it.symbol || '').toUpperCase()}</td><td style=\"padding:6px 8px;\">${fmtQty(it.qty)}</td><td style=\"padding:6px 8px;\" class=\"muted\">${source}</td></tr>`;
    }).join('');
    tbody.innerHTML = rows || '<tr><td colspan="3" class="muted" style="padding:8px;">No assets</td></tr>';
  } catch (_) {
    const tbody = document.getElementById('detailRows');
    tbody.innerHTML = '<tr><td colspan="3" class="muted" style="padding:8px;">Error</td></tr>';
  }
}

function fillForm(a) {
  document.getElementById('fName').value = a?.name || '';
  document.getElementById('fPlatform').value = a?.platform || 'HTX';
  const t = (a?.type || 'CEX').toUpperCase();
  document.getElementById('fType').value = (t === 'DEX' ? 'DEX' : 'CEX');
  document.getElementById('fAccessKey').value = '';
  document.getElementById('fSecretKey').value = '';
  document.getElementById('fChain').value = a?.chain || 'tron';
  document.getElementById('fAddress').value = a?.address || '';
  // Cardano-specific fields
  const chainVal = (a?.chain || document.getElementById('fChain').value || '').toLowerCase();
  const isCardano = chainVal === 'cardano' && t === 'DEX';
  if (isCardano) {
    const mode = (a?.track_by || 'stake').toLowerCase();
    document.getElementById('fAdaMode').value = mode === 'addresses' ? 'addresses' : 'stake';
    document.getElementById('fStake').value = a?.stake || '';
    const addrs = Array.isArray(a?.addresses) ? a.addresses : [];
    document.getElementById('fAddresses').value = addrs.join('\n');
  } else {
    document.getElementById('fAdaMode').value = 'stake';
    document.getElementById('fStake').value = '';
    document.getElementById('fAddresses').value = '';
  }
  const isDex = (t === 'DEX');
  applyTypeUI(isDex ? 'DEX' : 'CEX');
  // If DEX and TRON, show shared TRON key
  const chain = document.getElementById('fChain').value;
  if (isDex && chain === 'tron') {
    document.getElementById('fTronApiKey').value = (state.tron && state.tron.api_key) || '';
  } else {
    document.getElementById('fTronApiKey').value = '';
  }
  if (isDex && chain === 'cardano') {
    document.getElementById('fBlockfrostKey').value = (state.cardano && state.cardano.project_id) || '';
  } else {
    document.getElementById('fBlockfrostKey').value = '';
  }
}

function readForm() {
  const type = document.getElementById('fType').value;
  const common = {
    name: document.getElementById('fName').value.trim(),
    type,
  };
  if (type === 'DEX') {
    const chain = document.getElementById('fChain').value;
    if (chain === 'cardano') {
      const mode = document.getElementById('fAdaMode').value;
      if (mode === 'stake') {
        return { ...common, chain, track_by: 'stake', stake: (document.getElementById('fStake').value || '').trim() };
      } else {
        const lines = (document.getElementById('fAddresses').value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        return { ...common, chain, track_by: 'addresses', addresses: lines };
      }
    }
    return {
      ...common,
      chain,
      address: (document.getElementById('fAddress').value || '').trim(),
    };
  } else {
    return {
      ...common,
      platform: document.getElementById('fPlatform').value,
      access_key: (document.getElementById('fAccessKey').value || '').trim(),
      secret_key: (document.getElementById('fSecretKey').value || '').trim(),
    };
  }
}

function onAdd() { state.editingId = null; fillForm(null); openModal('Add Account'); }
function onEdit(id) { state.editingId = id; const a = state.items.find((x) => x.id === id); fillForm(a || null); openModal('Edit Account'); }
async function onDelete(id) { if (!confirm('Delete this account?')) return; const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' }); if (!res.ok) { toast('Delete failed'); return; } await load(); render(); toast('Deleted'); }

async function onSave() {
  const payload = readForm();
  if (!payload.name) { toast('Name is required'); return; }
  const t = payload.type;
  if (t === 'CEX' && !state.editingId) {
    if (!payload.access_key || !payload.secret_key) { toast('Access/Secret required'); return; }
  }
  if (t === 'DEX' && payload.chain !== 'cardano' && !payload.address) { toast('Address required'); return; }
  // Cardano DEX validation
  if (t === 'DEX' && payload.chain === 'cardano') {
    if (payload.track_by === 'stake') {
      if (!/^stake1[0-9a-z]+$/i.test(payload.stake || '')) { toast('Valid stake1… required'); return; }
    } else if (!Array.isArray(payload.addresses) || payload.addresses.length === 0) {
      toast('At least one addr1… required'); return;
    }
  }
  // If TRON DEX, persist shared TRON API key first
  if (t === 'DEX' && payload.chain === 'tron') {
    const apiKey = (document.getElementById('fTronApiKey').value || '').trim();
    if (!apiKey) { toast('TRON API key required'); return; }
    try {
      await fetch('/api/tron-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });
    } catch (_) { /* ignore */ }
  }
  if (t === 'DEX' && payload.chain === 'cardano') {
    const projectId = (document.getElementById('fBlockfrostKey').value || '').trim();
    if (!projectId) { toast('Blockfrost Project ID required'); return; }
    try {
      await fetch('/api/cardano-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId }) });
    } catch (_) { /* ignore */ }
  }
  let res;
  if (state.editingId) {
    res = await fetch(`/api/accounts/${state.editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } else {
    res = await fetch(`/api/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  if (!res.ok) { toast('Save failed'); return; }
  closeModal();
  await load();
  render();
  toast('Saved');
}

function setSort(key) {
  if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else { state.sortKey = key; state.sortDir = 'asc'; }
  render();
}

function debounce(fn, wait = 200) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), wait); }; }

function bindUI() {
  document.getElementById('btnAdd').addEventListener('click', onAdd);
  document.getElementById('btnClose').addEventListener('click', closeModal);
  document.getElementById('btnSave').addEventListener('click', onSave);
  document.getElementById('btnCloseDetails').addEventListener('click', closeDetailModal);
  document.querySelectorAll('thead th[data-sort]').forEach((th) => { th.addEventListener('click', () => setSort(th.getAttribute('data-sort'))); });
  const typeEl = document.getElementById('fType');
  if (typeEl) typeEl.addEventListener('change', () => applyTypeUI(typeEl.value));
  const chainEl = document.getElementById('fChain');
  if (chainEl) chainEl.addEventListener('change', () => applyTypeUI(document.getElementById('fType').value));
  const adaModeEl = document.getElementById('fAdaMode');
  if (adaModeEl) adaModeEl.addEventListener('change', () => applyTypeUI(document.getElementById('fType').value));
  const linkBfHelp = document.getElementById('linkBlockfrostHelp');
  if (linkBfHelp) linkBfHelp.addEventListener('click', (e) => { e.preventDefault(); openBlockfrostHelp(); });
  const btnCloseBfHelp = document.getElementById('btnCloseBlockfrostHelp');
  if (btnCloseBfHelp) btnCloseBfHelp.addEventListener('click', closeBlockfrostHelp);
  const bfHelpModal = document.getElementById('blockfrostHelpModal');
  if (bfHelpModal) bfHelpModal.addEventListener('click', (e) => { if (e.target === bfHelpModal) closeBlockfrostHelp(); });
  const linkTronHelp = document.getElementById('linkTronHelp');
  if (linkTronHelp) linkTronHelp.addEventListener('click', (e) => { e.preventDefault(); openTronHelp(); });
  const btnCloseTronHelp = document.getElementById('btnCloseTronHelp');
  if (btnCloseTronHelp) btnCloseTronHelp.addEventListener('click', closeTronHelp);
  const tronHelpModal = document.getElementById('tronHelpModal');
  if (tronHelpModal) tronHelpModal.addEventListener('click', (e) => { if (e.target === tronHelpModal) closeTronHelp(); });
}

function setVisible(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = show ? '' : 'none';
}

function applyTypeUI(typeVal) {
  const isDex = String(typeVal).toUpperCase() === 'DEX';
  setVisible('platformRow', !isDex);
  setVisible('chainRow', isDex);
  setVisible('akRow', !isDex);
  setVisible('skRow', !isDex);
  const chain = document.getElementById('fChain').value;
  const isCardano = isDex && chain === 'cardano';
  const isTron = isDex && chain === 'tron';
  setVisible('addressRow', isDex && !isCardano);
  const showTron = isTron;
  setVisible('tronKeyRow', showTron);
  if (showTron) {
    document.getElementById('fTronApiKey').value = (state.tron && state.tron.api_key) || '';
  }
  // Cardano-specific toggles
  setVisible('cardanoModeRow', isCardano);
  const mode = document.getElementById('fAdaMode').value || 'stake';
  setVisible('stakeRow', isCardano && mode === 'stake');
  setVisible('addressesRow', isCardano && mode === 'addresses');
  // Shared Blockfrost key field visibility
  setVisible('blockfrostKeyRow', isCardano);
  if (isCardano) {
    document.getElementById('fBlockfrostKey').value = (state.cardano && state.cardano.project_id) || '';
  }
}

async function init() { bindUI(); await load(); render(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
