const express = require('express');
const { getKlinesPaged, getKlines } = require('../htx');

const router = express.Router();

// GET /api/kline?symbol=BTC&period=60min&count=6000
router.get('/', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const period = String(req.query.period || '60min');
    const count = Math.max(1, Math.min(10000, Number(req.query.count || 6000)));
    if (!symbol) return res.status(400).json({ error: 'missing_symbol' });
    let candles = [];
    try {
      candles = await getKlinesPaged({ symbol: symbol + 'USDT', period, count });
      if (!candles.length) throw new Error('empty');
    } catch (_) {
      // Fallback to single call (2000 max)
      candles = await getKlines({ symbol: symbol + 'USDT', period, size: Math.min(2000, count) });
    }
    res.json({ symbol, period, count: candles.length, candles });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

module.exports = router;

