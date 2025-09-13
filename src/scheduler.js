const { getPrices, createHTXClient } = require('./htx');
const { loadLots } = require('./lots');
const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { computeSnapshot } = require('./calc');
const Accounts = require('./accounts');
const fs = require('fs');
const path = require('path');
const tron = require('./onchain/tron');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function createScheduler({ intervalMs = 60_000, logger = console, refFiat = 'USD', minUsdIgnore = 10 } = {}) {
  let running = false;
  let lastSnapshotAt = 0;
  let backoffBalances = 0;
  let backoffPrices = 0;
  let backoffOnchain = 0;

  // Load on-chain allowlist (tron tokens)
  let onchainCfg = { tron: { tokens: [
    { symbol: 'USDT', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 },
    { symbol: 'USDC', contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },
  ] } };
  try {
    const file = path.join(process.cwd(), 'data', 'onchain_config.json');
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.tron && Array.isArray(raw.tron.tokens)) onchainCfg.tron.tokens = raw.tron.tokens;
    }
  } catch (_) {}

  async function tickOnce() {
    try {
      const lotsState = loadLots();
      // balances merged across enabled accounts
      let balances = {};
      try {
        const items = await Accounts.listSanitized(); // sanitized ok for routing; CEX secrets not needed here
        const raws = await Promise.all(items.map(async (it) => ({ it, raw: await Accounts.getRawById(it.id) })));
        for (const { it, raw } of raws) {
          if (!raw || !raw.enabled) continue;
          if (raw.type === 'cex' && String(raw.platform).toUpperCase() === 'HTX') {
            try {
              const client = createHTXClient({ accessKey: raw.access_key, secretKey: raw.secret_key, accountId: raw.account_id || '' });
              const bal = await client.getBalances();
              // merge
              for (const [sym, v] of Object.entries(bal || {})) {
                if (!balances[sym]) balances[sym] = { free: 0 };
                balances[sym].free += Number(v.free || 0);
              }
              await Accounts.pingUsage(raw.id, { callsDelta: 1 });
              await Accounts.health(raw.id, 'ok');
            } catch (e) {
              logger.warn(`[scheduler] CEX account ${raw.id} error: ${e.message}`);
              await Accounts.health(raw.id, 'warn');
            }
          } else if (raw.type === 'dex') {
            // handled separately below (grouped per chain)
          }
        }
        backoffBalances = 0;
      } catch (e) {
        backoffBalances += 30_000;
        logger.warn(`[scheduler] balances error: ${e.message}`);
        throw e;
      }

      // On-chain: TRON addresses
      try {
        const tronAddrs = await Accounts.getTronAddresses();
        if (tronAddrs.length > 0) {
          const addresses = tronAddrs.map(x => x.address);
          const allow = onchainCfg.tron.tokens || [];
          const pos = await tron.getBalances(addresses, allow);
          // tag with account_id
          const byAddr = new Map(tronAddrs.map(x => [x.address, x.id]));
          for (const p of pos) {
            p.account_id = byAddr.get(p.address) || null;
            const sym = p.symbol.toUpperCase();
            if (!balances[sym]) balances[sym] = { free: 0 };
            balances[sym].free += Number(p.qty || 0);
            // mark account ok
            if (p.account_id) await Accounts.health(p.account_id, 'ok');
          }
        }
        backoffOnchain = 0;
      } catch (e) {
        backoffOnchain += 30_000;
        logger.warn(`[scheduler] tron on-chain error: ${e.message}`);
      }
      const symbols = Object.keys(balances || {});

      // prices
      let prices = {};
      try {
        prices = await getPrices(symbols);
        backoffPrices = 0;
      } catch (e) {
        backoffPrices += 30_000;
        logger.warn(`[scheduler] prices error: ${e.message}`);
      }

      const snapshot = computeSnapshot({ balances, prices, lotsState, refFiat, minUsdIgnore });
      const state = loadState();
      addSnapshot(state, snapshot);
      saveStateAtomic(state);
      lastSnapshotAt = Date.now();
    } catch (e) {
      // keep serving last snapshot; already logged
    }
  }

  async function loop() {
    if (running) return;
    running = true;
    while (running) {
      await tickOnce();
      const wait = intervalMs + Math.max(backoffBalances, backoffPrices, backoffOnchain);
      await delay(wait);
    }
  }

  function stop() { running = false; }
  function getLastSnapshotAt() { return lastSnapshotAt; }

  return { loop, stop, getLastSnapshotAt };
}

module.exports = { createScheduler };
