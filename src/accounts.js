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
    const seed = { meta: { last_id: 2 }, items: [
      { id: '000001', name: 'HTX_main', type: 'cex', platform: 'HTX', access_key: 'REPLACE', secret_key: 'REPLACE', enabled: true, today: { calls: 0 }, last_used: null, status: 'ok' },
      { id: '000002', name: 'TronLink_wallet', type: 'dex', chain: 'tron', address: 'Txxxx', enabled: true, today: { calls: 0 }, last_used: null, status: 'ok' },
    ] };
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
    // basic validation & normalization
    json.items = json.items.map(normalizeAccount).filter(Boolean);
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

function normalizeType(val) {
  const t = String(val || '').toLowerCase();
  return t === 'dex' ? 'dex' : 'cex';
}

function normalizeAccount(a) {
  if (!a) return null;
  const base = {
    id: String(a.id || '').padStart(6, '0'),
    name: String(a.name || 'Account'),
    type: normalizeType(a.type),
    enabled: a.enabled == null ? true : !!a.enabled,
    today: { calls: Number((a.today && a.today.calls) || 0) },
    last_used: a.last_used || null,
    status: ['ok', 'warn', 'down'].includes(String(a.status || '').toLowerCase()) ? String(a.status).toLowerCase() : 'ok',
  };
  if (base.type === 'cex') {
    const platform = String(a.platform || 'HTX');
    const access_key = a.access_key || '';
    const secret_key = a.secret_key || '';
    if (!platform || !access_key || !secret_key) return null; // invalid CEX
    return { ...base, platform, access_key, secret_key };
  } else {
    const chain = String(a.chain || '');
    const address = String(a.address || '');
    if (!chain || !address) return null; // invalid DEX
    return { ...base, chain, address };
  }
}

async function create(payload) {
  const st = await loadAccounts();
  const obj = normalizeAccount({ ...payload, id: '' });
  if (!obj) throw new Error('invalid_account');
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
  if (p.chain != null) merged.chain = String(p.chain);
  if (p.address != null) merged.address = String(p.address);
  if (p.type != null) merged.type = normalizeType(p.type);
  if (p.enabled != null) merged.enabled = !!p.enabled;
  if (p.status != null) merged.status = String(p.status);
  if (typeof p.access_key === 'string' && p.access_key.trim() !== '') merged.access_key = String(p.access_key);
  if (typeof p.secret_key === 'string' && p.secret_key.trim() !== '') merged.secret_key = String(p.secret_key);
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
  const t = a.today || { calls: 0 };
  t.calls = Number(t.calls || 0) + Number(callsDelta || 0);
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

function redact(str) {
  const s = String(str || '');
  if (!s) return '';
  return s.length <= 4 ? '*'.repeat(s.length) : '*'.repeat(s.length - 4) + s.slice(-4);
}

function sanitizeAccount(a) {
  if (!a) return a;
  if (a.type === 'cex') {
    const { secret_key, access_key, ...rest } = a;
    const out = { ...rest, access_key: redact(access_key) };
    if ('priority' in out) delete out.priority;
    return out;
  }
  const out = { ...a };
  if ('priority' in out) delete out.priority;
  return out;
}

async function listSanitized() {
  const st = await loadAccounts();
  return (st.items || []).map(sanitizeAccount);
}

async function getRawById(id) {
  const st = await loadAccounts();
  return (st.items || []).find((x) => x.id === String(id)) || null;
}

module.exports = {
  ACCOUNTS_FILE,
  loadAccounts,
  saveAccountsAtomic,
  listSanitized,
  getRawById,
  list,
  get,
  create,
  update,
  remove,
  toggle,
  pingUsage,
  health,
  redact,
  sanitizeAccount,
};
