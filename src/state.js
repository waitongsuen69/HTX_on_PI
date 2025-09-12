const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Allow enough room for ~1 snapshot/day backfill plus live samples
const MAX_HISTORY = 400;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.tmp-${path.basename(file)}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const data = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function loadState() {
  ensureDataDir();
  const state = readJsonSafe(STATE_FILE, { history: [] });
  if (!Array.isArray(state.history)) state.history = [];
  return state;
}

function getLatest(state) {
  if (!state || !Array.isArray(state.history)) return null;
  return state.history[state.history.length - 1] || null;
}

function addSnapshot(state, snapshot) {
  const hist = state.history || [];
  hist.push(snapshot);
  while (hist.length > MAX_HISTORY) hist.shift();
  state.history = hist;
  return state;
}

function saveStateAtomic(state) {
  ensureDataDir();
  writeJsonAtomic(STATE_FILE, state);
}

module.exports = {
  MAX_HISTORY,
  DATA_DIR,
  STATE_FILE,
  loadState,
  getLatest,
  addSnapshot,
  saveStateAtomic,
  writeJsonAtomic,
};
