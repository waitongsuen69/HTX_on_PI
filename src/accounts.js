const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DATA_DIR } = require('./state');

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

async function ensureFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(ACCOUNTS_FILE, fs.constants.F_OK);
  } catch (_) {
    const seed = { meta: { last_id: 0 }, items: [] };
    await writeJsonAtomic(ACCOUNTS_FILE, seed);
  }
}

async function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.tmp-${path.basename(file)}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const data = JSON.stringify(obj, null, 2);
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file);
}

async function loadAccounts() {
  await ensureFile();
  try {
    const raw = await fsp.readFile(ACCOUNTS_FILE, 'utf8');
    const json = JSON.parse(raw || '{}');
    if (!json.meta) json.meta = { last_id: 0 };
    if (!Array.isArray(json.items)) json.items = [];
    return json;
  } catch (e) {
    return { meta: { last_id: 0 }, items: [] };
  }
}

async function saveAccountsAtomic(state) {
  await ensureFile();
  await writeJsonAtomic(ACCOUNTS_FILE, state);
}

function nextId(state) {
  if (!state.meta) state.meta = { last_id: 0 };
  state.meta.last_id = (state.meta.last_id || 0) + 1;
  return String(state.meta.last_id).padStart(6, '0');
}

async function list() {
  const st = await loadAccounts();
  return st.items || [];
}

async function get(id) {
  const st = await loadAccounts();
  return (st.items || []).find((a) => a.id === String(id)) || null;
}

function applyDefaults(payload) {
  const now = null;
  return {
    id: '',
    name: String(payload.name || 'New Account'),
    platform: String(payload.platform || 'Custom'),
    type: String(payload.type || 'other'),
    enabled: payload.enabled == null ? true : !!payload.enabled,
    priority: payload.priority == null ? 50 : Number(payload.priority),
    proxy: payload.proxy == null || payload.proxy === '' ? null : String(payload.proxy),
    today: { calls: 0, tokens: 0 },
    last_used: now,
    status: String(payload.status || 'ok'),
  };
}

async function create(payload) {
  const st = await loadAccounts();
  const obj = applyDefaults(payload || {});
  obj.id = nextId(st);
  st.items.push(obj);
  await saveAccountsAtomic(st);
  return obj;
}

async function update(id, patch) {
  const st = await loadAccounts();
  const idx = (st.items || []).findIndex((a) => a.id === String(id));
  if (idx === -1) return null;
  const current = st.items[idx];
  const merged = { ...current };
  const p = patch || {};
  if (p.name != null) merged.name = String(p.name);
  if (p.platform != null) merged.platform = String(p.platform);
  if (p.type != null) merged.type = String(p.type);
  if (p.enabled != null) merged.enabled = !!p.enabled;
  if (p.priority != null) merged.priority = Number(p.priority);
  if (p.proxy !== undefined) merged.proxy = p.proxy === '' || p.proxy == null ? null : String(p.proxy);
  if (p.status != null) merged.status = String(p.status);
  st.items[idx] = merged;
  await saveAccountsAtomic(st);
  return merged;
}

async function remove(id) {
  const st = await loadAccounts();
  const before = st.items.length;
  st.items = st.items.filter((a) => a.id !== String(id));
  if (st.items.length === before) return false;
  await saveAccountsAtomic(st);
  return true;
}

async function toggle(id) {
  const st = await loadAccounts();
  const a = (st.items || []).find((x) => x.id === String(id));
  if (!a) return null;
  a.enabled = !a.enabled;
  await saveAccountsAtomic(st);
  return a;
}

async function pingUsage(id, { callsDelta = 0, tokensDelta = 0 } = {}) {
  const st = await loadAccounts();
  const a = (st.items || []).find((x) => x.id === String(id));
  if (!a) return null;
  const t = a.today || { calls: 0, tokens: 0 };
  t.calls = Number(t.calls || 0) + Number(callsDelta || 0);
  t.tokens = Number(t.tokens || 0) + Number(tokensDelta || 0);
  a.today = t;
  a.last_used = new Date().toISOString();
  await saveAccountsAtomic(st);
  return a;
}

async function health(id, status) {
  const st = await loadAccounts();
  const a = (st.items || []).find((x) => x.id === String(id));
  if (!a) return null;
  a.status = String(status || 'ok');
  await saveAccountsAtomic(st);
  return a;
}

module.exports = {
  ACCOUNTS_FILE,
  loadAccounts,
  saveAccountsAtomic,
  list,
  get,
  create,
  update,
  remove,
  toggle,
  pingUsage,
  health,
};

