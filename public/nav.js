// Builds the reusable top nav in-place; no network fetch
(function () {
  function createLink(id, href, text) {
    const a = document.createElement('a');
    a.id = id;
    a.href = href;
    a.textContent = text;
    return a;
  }

  function initNav() {
    const mount = document.getElementById('nav');
    if (!mount) return;
    mount.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'nav';
    container.appendChild(createLink('nav-dashboard', '/', 'Dashboard'));
    container.appendChild(createLink('nav-lots', '/lots.html', 'Lots'));
    container.appendChild(createLink('nav-settings', '/accounts.html', 'Settings'));
    mount.appendChild(container);

    // Highlight active
    try {
      const path = location.pathname;
      if (path === '/' || path === '/index.html') {
        const el = document.getElementById('nav-dashboard');
        if (el) el.classList.add('active');
      } else if (path.includes('lots')) {
        const el = document.getElementById('nav-lots');
        if (el) el.classList.add('active');
      } else if (path.includes('accounts')) {
        const el = document.getElementById('nav-settings');
        if (el) el.classList.add('active');
      }
    } catch (_) {}
  }

  // Expose and auto-run (CSP-safe; no inline calls required)
  window.initNav = initNav;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
