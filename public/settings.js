import './accounts.js';

async function loadAppConfig() {
  try {
    const r = await fetch('/api/app-config', { cache: 'no-cache' });
    const cfg = await r.json();
    const min = Number((cfg && cfg.min_usd_ignore) || 10);
    const el = document.getElementById('minUsdIgnore');
    if (el) el.value = String(min);
  } catch (_) {}
}

async function saveAppConfig() {
  const el = document.getElementById('minUsdIgnore');
  if (!el) return;
  const val = Number(el.value || 0);
  try {
    const r = await fetch('/api/app-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ min_usd_ignore: val }) });
    if (!r.ok) throw new Error('save_failed');
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Saved'; t.style.display = 'block'; setTimeout(() => { t.style.display = 'none'; }, 1200); }
  } catch (e) {
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Save failed'; t.style.display = 'block'; setTimeout(() => { t.style.display = 'none'; }, 1600); }
  }
}

function bindSettingsUI() {
  const btn = document.getElementById('btnSaveMin');
  if (btn) btn.addEventListener('click', saveAppConfig);
}

async function initSettings() { bindSettingsUI(); await loadAppConfig(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSettings); else initSettings();
