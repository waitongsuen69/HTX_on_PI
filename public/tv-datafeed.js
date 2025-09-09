// Minimal TradingView Charting Library datafeed that bridges to /api/kline
// Notes:
// - Requires TradingView Charting Library files under /public/vendor/charting_library/
// - Supports basic history via getBars; realtime subscribe is stubbed

(function(){
  const RES_MAP = {
    '1': '1min',
    '5': '5min',
    '15': '15min',
    '60': '60min',
    '240': '4hour',
    'D': '1day',
    '1D': '1day'
  };

  function toBars(candles) {
    return (candles || []).map(k => ({
      time: Math.floor((k.ts || 0) / 1000) * 1000,
      open: Number(k.open),
      high: Number(k.high),
      low: Number(k.low),
      close: Number(k.close),
      volume: Number(k.vol || 0)
    })).filter(b => Number.isFinite(b.time) && Number.isFinite(b.open) && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close));
  }

  class HTXDatafeed {
    constructor(base = '/api') { this.base = base; }

    onReady(cb) {
      setTimeout(() => cb({
        supports_search: true,
        supports_group_request: false,
        supported_resolutions: ['1','5','15','60','240','D'],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      }), 0);
    }

    searchSymbols(userInput, exchange, symbolType, onResult) {
      const s = (userInput || '').trim().toUpperCase();
      if (!s) return onResult([]);
      onResult([{ symbol: s, full_name: s, description: s, ticker: s, type: 'crypto', exchange: 'HTX' }]);
    }

    resolveSymbol(symbolName, onResolve, onError) {
      try {
        const s = (symbolName || '').trim().toUpperCase();
        onResolve({
          name: s,
          full_name: s,
          ticker: s,
          description: s,
          type: 'crypto',
          session: '24x7',
          timezone: 'Etc/UTC',
          exchange: 'HTX',
          minmov: 1,
          pricescale: 100, // adjust if you want more price precision
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: true,
          supported_resolutions: ['1','5','15','60','240','D'],
          data_status: 'streaming',
        });
      } catch (e) { onError(String(e)); }
    }

    async getBars(symbolInfo, resolution, from, to, onHistoryCallback, onErrorCallback, firstDataRequest) {
      try {
        const sym = (symbolInfo.ticker || symbolInfo.name || '').toUpperCase();
        const period = RES_MAP[resolution] || '60min';
        // Fetch a generous window, filter client-side to requested [from,to]
        const url = `${this.base}/kline?symbol=${encodeURIComponent(sym)}&period=${encodeURIComponent(period)}&count=6000`;
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        const all = toBars(data.candles || []);
        const fromMs = from ? from * 1000 : -Infinity;
        const toMs = to ? to * 1000 : Infinity;
        const bars = all.filter(b => b.time >= fromMs && b.time <= toMs);
        onHistoryCallback(bars, { noData: bars.length === 0 });
      } catch (e) {
        onErrorCallback(String(e));
      }
    }

    subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
      // No realtime streaming implemented; could poll /api/kline periodically and push last bar updates
      this._sub = { symbolInfo, resolution, onRealtimeCallback, subscriberUID };
    }

    unsubscribeBars(subscriberUID) {
      if (this._sub && this._sub.subscriberUID === subscriberUID) this._sub = null;
    }
  }

  window.HTXDatafeed = HTXDatafeed;
})();

