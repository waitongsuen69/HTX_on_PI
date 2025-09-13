const state = {
  items: [],
  sortKey: 'name',
  sortDir: 'asc',
  q: '',
  platformFilter: '',
  editingId: null,
};

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
  } catch (_) {
    return String(ts);
  }
}

function sortItems(items) {
  const key = state.sortKey;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  const arr = [...items];
  arr.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    av = String(av || '').toLowerCase();
    bv = String(bv || '').toLowerCase();
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
  return arr;
}

function filtered(items) {
  const q = state.q.trim().toLowerCase();
  const pf = state.platformFilter;
  return items.filter((x) => {
    const matchQ = !q || x.name.toLowerCase().includes(q) || String(x.platform || '').toLowerCase().includes(q);
    const matchP = !pf || x.platform === pf;
    return matchQ && matchP;
  });
}

function render() {
  const tbody = document.getElementById('rows');
  let items = filtered(state.items);
  items = sortItems(items);
  const rows = items.map((a) => {
    const statusClass = `pill status ${a.status}`;
    const dotColor = a.status === 'ok' ? '#0aff7a' : a.status === 'warn' ? '#ffd166' : '#ff6b6b';
    const badge = `<span class="badge">${a.platform || '—'}</span>`;
    const trClass = a.enabled ? '' : 'row-disabled';
    return `
      <tr class="${trClass}">
        <td>${a.name}</td>
        <td>${badge}</td>
        <td><span class="muted">${a.type || '—'}</span></td>
        <td><span class="${statusClass}"><span class="dot" style="background:${dotColor}"></span>${(a.status||'ok').toUpperCase()}</span></td>
        <td>${fmtTime(a.last_used)}</td>
        <td>
          <div class="ops">
            <button title="Toggle" data-act="toggle" data-id="${a.id}">${a.enabled ? '⏻' : '⭘'}</button>
            <button title="Edit" data-act="edit" data-id="${a.id}">✏️</button>
            <button title="Delete" data-act="del" data-id="${a.id}">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
  tbody.innerHTML = rows || `<tr><td colspan="6" class="muted" style="text-align:center; padding:16px;">No accounts</td></tr>`;

  // Bind actions via event delegation
  tbody.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const act = e.currentTarget.getAttribute('data-act');
      if (act === 'toggle') return onToggle(id);
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
function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

function fillForm(a) {
  document.getElementById('fName').value = a?.name || '';
  document.getElementById('fPlatform').value = a?.platform || 'Custom';
  const t = (a?.type || 'CEX').toUpperCase();
  document.getElementById('fType').value = (t === 'DEX' ? 'DEX' : 'CEX');
  document.getElementById('fEnabled').checked = a?.enabled != null ? !!a.enabled : true;
}

function readForm() {
  return {
    name: document.getElementById('fName').value.trim(),
    platform: document.getElementById('fPlatform').value,
    type: document.getElementById('fType').value,
    enabled: document.getElementById('fEnabled').checked,
  };
}

function onAdd() {
  state.editingId = null;
  fillForm(null);
  openModal('Add Account');
}

function onEdit(id) {
  state.editingId = id;
  const a = state.items.find((x) => x.id === id);
  fillForm(a || null);
  openModal('Edit Account');
}

async function onDelete(id) {
  if (!confirm('Delete this account?')) return;
  const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
  if (!res.ok) { toast('Delete failed'); return; }
  await load();
  render();
  toast('Deleted');
}

async function onSave() {
  const payload = readForm();
  if (!payload.name) { toast('Name is required'); return; }
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
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortKey = key;
    state.sortDir = 'asc';
  }
  render();
}

function debounce(fn, wait = 200) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), wait); }; }

function bindUI() {
  document.getElementById('btnAdd').addEventListener('click', onAdd);
  document.getElementById('btnClose').addEventListener('click', closeModal);
  document.getElementById('btnSave').addEventListener('click', onSave);
  document.getElementById('search').addEventListener('input', debounce((e) => { state.q = e.target.value; render(); }, 200));
  document.getElementById('platformFilter').addEventListener('change', (e) => { state.platformFilter = e.target.value; render(); });
  document.querySelectorAll('thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => setSort(th.getAttribute('data-sort')));
  });
}

async function init() {
  bindUI();
  await load();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
