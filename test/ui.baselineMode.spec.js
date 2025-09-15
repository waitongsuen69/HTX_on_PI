/** @jest-environment jsdom */

describe('UI baseline mode toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="grid"></div>
      <span id="total"></span>
      <span id="day"></span>
      <div id="chartModal"></div>
      <div id="chartTitle"></div>
      <div id="chartContainer"></div>
      <button id="chartClose"></button>
      <select id="chartPeriod"></select>
      <button id="refresh"></button>
      <span id="lastManual"></span>
      <span id="lastAuto"></span>
      <div id="baselineSwitch" class="switch"><div class="thumb"></div><div class="labels"><span>Close</span><span>VWAP</span></div></div>
    `;
    // Stub LightweightCharts global used in app.js
    global.window.LightweightCharts = { createChart: () => ({ addCandlestickSeries: () => ({}), timeScale: () => ({ fitContent: () => {} }) }) };
    const mockResp = { ok: true, json: async () => ({ positions: [], total_value_usd: 0, total_change_24h_pct: 0 }) };
    global.fetch = jest.fn().mockResolvedValue(mockResp);
    window.fetch = global.fetch;
  });

  afterEach(() => {
    delete window.fetch;
    delete global.fetch;
    localStorage.clear();
  });

  test('persists baselineMode and calls API with param', async () => {
    localStorage.setItem('baselineMode', 'vwap');
    // Load app.js which will trigger initial fetch
    require('../public/app.js');
    // allow microtasks
    await Promise.resolve();
    const firstUrl = window.fetch.mock.calls[0][0];
    expect(firstUrl).toContain('/api/snapshot?baselineMode=vwap');

    // Click switch -> toggle to close and trigger another load
    document.querySelector('#baselineSwitch').click();
    await Promise.resolve();
    const urls = window.fetch.mock.calls.map(c => c[0]);
    expect(urls.some(u => String(u).includes('baselineMode=close'))).toBe(true);
    expect(localStorage.getItem('baselineMode')).toBe('close');
  });
});
