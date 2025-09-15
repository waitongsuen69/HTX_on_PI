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

async function getTronConfig() {
  const st = await loadAccounts();
  const meta = st.meta || {};
  const api_key = meta.tron_api_key || '';
  const fullnode = meta.tron_fullnode || 'https://api.trongrid.io';
  return { api_key, fullnode };
}

async function setTronConfig({ api_key, fullnode } = {}) {
  const st = await loadAccounts();
  if (!st.meta) st.meta = { last_id: st.meta && st.meta.last_id ? st.meta.last_id : 0 };
  if (typeof api_key === 'string') st.meta.tron_api_key = api_key;
  if (typeof fullnode === 'string' && fullnode.trim() !== '') st.meta.tron_fullnode = fullnode;
  await saveAccountsAtomic(st);
  return getTronConfig();
}

async function getAppConfig() {
  const st = await loadAccounts();
  const meta = st.meta || {};
  let min = Number(meta.min_usd_ignore || 0);
  if (!(min > 0)) min = 10;
  return { min_usd_ignore: min };
}

async function setAppConfig({ min_usd_ignore } = {}) {
  const st = await loadAccounts();
  if (!st.meta) st.meta = { last_id: st.meta && st.meta.last_id ? st.meta.last_id : 0 };
  if (min_usd_ignore != null) {
    const v = Number(min_usd_ignore);
    st.meta.min_usd_ignore = Number.isFinite(v) && v >= 0 ? v : 10;
  }
  await saveAccountsAtomic(st);
  return getAppConfig();
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
    name: String(a.name || 'Account').trim(),
    type: normalizeType(a.type),
    enabled: a.enabled == null ? true : !!a.enabled,
    today: { calls: Number((a.today && a.today.calls) || 0) },
    last_used: a.last_used || null,
    status: ['ok', 'warn', 'down'].includes(String(a.status || '').toLowerCase()) ? String(a.status).toLowerCase() : 'ok',
  };
  if (base.type === 'cex') {
    // Normalize platform and enforce supported set (HTX only for now)
    const platform = String(a.platform || 'HTX').toUpperCase();
    const access_key = a.access_key || '';
    const secret_key = a.secret_key || '';
    if (!platform || !access_key || !secret_key) return null; // invalid CEX
    if (!['HTX'].includes(platform)) return null; // unsupported CEX platform
    return { ...base, platform, access_key, secret_key };
  } else {
    // Normalize chain and enforce supported set (tron, cardano)
    const chain = String(a.chain || '').toLowerCase();
    if (!chain) return null;
    if (chain === 'tron') {
      const address = String(a.address || '');
      if (!address) return null;
      return { ...base, chain, address };
    }
    if (chain === 'cardano') {
      const track_by = String(a.track_by || a.trackBy || '').toLowerCase();
      let out = { ...base, chain, track_by: track_by === 'addresses' ? 'addresses' : 'stake' };
      if (out.track_by === 'stake') {
        const stake = String(a.stake || '').trim();
        if (!/^stake1[0-9a-z]+$/i.test(stake)) return null;
        out.stake = stake;
      } else {
        // addresses list
        const arr = Array.isArray(a.addresses) ? a.addresses : String(a.address || '') ? [a.address] : [];
        const norm = arr.map(s => String(s || '').trim()).filter(s => /^addr1[0-9a-z]+$/i.test(s));
        if (norm.length === 0) return null;
        out.addresses = Array.from(new Set(norm));
      }
      return out;
    }
    return null; // unsupported DEX chain
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
  if (p.track_by != null) merged.track_by = String(p.track_by);
  if (p.stake != null) merged.stake = String(p.stake);
  if (Array.isArray(p.addresses)) merged.addresses = p.addresses.map(s => String(s));
  if (p.type != null) merged.type = normalizeType(p.type);
  if (p.enabled != null) merged.enabled = !!p.enabled;
  if (p.status != null) merged.status = String(p.status);
  if (typeof p.access_key === 'string' && p.access_key.trim() !== '') merged.access_key = String(p.access_key);
  if (typeof p.secret_key === 'string' && p.secret_key.trim() !== '') merged.secret_key = String(p.secret_key);
  // Re-validate against schema and drop irrelevant fields
  const norm = normalizeAccount(merged);
  if (!norm) throw new Error('invalid_account');
  st.items[idx] = norm;
  await saveAccountsAtomic(st);
  return norm;
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

function isTronDex(a) {
  return a && a.type === 'dex' && String(a.chain || '').toLowerCase() === 'tron' && !!a.address;
}

async function getTronAddresses() {
  const st = await loadAccounts();
  return (st.items || [])
    .filter((a) => isTronDex(a) && a.enabled)
    .map((a) => ({ id: a.id, name: a.name, address: a.address }));
}

async function getCardanoConfig() {
  const st = await loadAccounts();
  const meta = st.meta || {};
  const provider = String(meta.cardano_provider || process.env.CARDANO_PROVIDER || 'blockfrost').toLowerCase();
  const project_id = String(meta.blockfrost_project_id || process.env.BLOCKFROST_PROJECT_ID || '');
  return { provider, project_id };
}

async function setCardanoConfig({ provider, project_id } = {}) {
  const st = await loadAccounts();
  if (!st.meta) st.meta = { last_id: st.meta && st.meta.last_id ? st.meta.last_id : 0 };
  if (typeof provider === 'string' && provider.trim() !== '') st.meta.cardano_provider = provider;
  if (typeof project_id === 'string') st.meta.blockfrost_project_id = project_id;
  await saveAccountsAtomic(st);
  return getCardanoConfig();
}

function isCardanoDex(a) {
  return a && a.type === 'dex' && String(a.chain || '').toLowerCase() === 'cardano' && (a.stake || (Array.isArray(a.addresses) && a.addresses.length > 0));
}

async function getCardanoSpecs() {
  const st = await loadAccounts();
  return (st.items || [])
    .filter((a) => isCardanoDex(a) && a.enabled)
    .map((a) => ({ id: a.id, name: a.name, track_by: a.track_by || 'stake', stake: a.stake || '', addresses: Array.isArray(a.addresses) ? a.addresses : [] }));
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
  getTronAddresses,
  isCardanoDex,
  getCardanoSpecs,
  getCardanoConfig,
  setCardanoConfig,
  getTronConfig,
  setTronConfig,
  getAppConfig,
  setAppConfig,
};
