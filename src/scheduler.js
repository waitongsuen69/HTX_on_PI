const { getPrices, createHTXClient } = require('./htx');
const { loadLots } = require('./lots');
const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { computeSnapshot } = require('./calc');
const Accounts = require('./accounts');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function createScheduler({ intervalMs = 60_000, logger = console, refFiat = 'USD', minUsdIgnore = 10 } = {}) {
  let running = false;
  let lastSnapshotAt = 0;
  let backoffBalances = 0;
  let backoffPrices = 0;

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
            // TODO: implement DEX adapters (tron/evm). For now, skip and mark warn to indicate not implemented.
            await Accounts.health(raw.id, 'warn');
          }
        }
        backoffBalances = 0;
      } catch (e) {
        backoffBalances += 30_000;
        logger.warn(`[scheduler] balances error: ${e.message}`);
        throw e;
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
      const wait = intervalMs + Math.max(backoffBalances, backoffPrices);
      await delay(wait);
    }
  }

  function stop() { running = false; }
  function getLastSnapshotAt() { return lastSnapshotAt; }

  return { loop, stop, getLastSnapshotAt };
}

module.exports = { createScheduler };
