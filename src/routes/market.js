const express = require('express');
const { getKlines } = require('../htx');

const router = express.Router();

// GET /api/market/kline?symbol=BTC&period=60min&n=200
router.get('/kline', async (req, res) => {
  try {
    const sym = String(req.query.symbol || '').toUpperCase();
    if (!sym) return res.status(400).json({ error: 'invalid', message: 'symbol required' });
    const period = String(req.query.period || '60min');
    const n = Math.max(1, Math.min(1000, Number(req.query.n || 200)));
    // Only USDT-quoted for now
    const symbol = (sym + 'USDT').toLowerCase();
    const rows = await getKlines({ symbol, period, size: n });
    res.json({ symbol: sym, period, n: n, rows });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

module.exports = router;

