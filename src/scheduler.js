const { getPrices, createHTXClient } = require('./htx');
const { loadState, addSnapshot, saveStateAtomic } = require('./state');
const { computeSnapshot } = require('./calc');
const Accounts = require('./accounts');
const fs = require('fs');
const path = require('path');
const tron = require('./onchain/tron');
const cardano = require('./onchain/cardano');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function createScheduler({ intervalMs = 60_000, logger = console, refFiat = 'USD', minUsdIgnore = 10, getMinUsdIgnore = null } = {}) {
  let running = false;
  let lastSnapshotAt = 0;
  let backoffBalances = 0;
  let backoffPrices = 0;
  let backoffOnchain = 0;

  // On-chain allowlist removed: always read all assets from the chain.

  async function tickOnce() {
    try {
      // balances merged across enabled accounts
      let balances = {};
      // track per-platform symbol balances to compute platform allocation later
      const platformBySym = { HTX: {}, TRON: {}, CARDANO: {} };
      // id -> display name
      const nameById = new Map();
      // track per-account symbol balances to compute account allocation
      const accSym = new Map(); // id -> { name, type: 'CEX'|'DEX', symQty: {SYM:qty} }
      try {
        const items = await Accounts.listSanitized(); // sanitized ok for routing; CEX secrets not needed here
        const raws = await Promise.all(items.map(async (it) => ({ it, raw: await Accounts.getRawById(it.id) })));
        for (const { it, raw } of raws) {
          if (!raw || !raw.enabled) continue;
          try { if (raw && raw.id) nameById.set(raw.id, raw.name || it.name || raw.id); } catch(_) {}
          if (raw.type === 'cex' && String(raw.platform).toUpperCase() === 'HTX') {
            try {
              const client = createHTXClient({ accessKey: raw.access_key, secretKey: raw.secret_key, accountId: raw.account_id || '' });
              const bal = await client.getBalances();
              // merge
              for (const [sym, v] of Object.entries(bal || {})) {
                if (!balances[sym]) balances[sym] = { free: 0 };
                balances[sym].free += Number(v.free || 0);
                // platform: HTX
                const u = String(sym || '').toUpperCase();
                if (!platformBySym.HTX[u]) platformBySym.HTX[u] = 0;
                platformBySym.HTX[u] += Number(v.free || 0);
                // account breakdown (CEX)
                if (!accSym.has(raw.id)) accSym.set(raw.id, { name: nameById.get(raw.id) || raw.name || it.name || raw.id, type: 'CEX', symQty: {} });
                const acc = accSym.get(raw.id);
                acc.symQty[u] = (acc.symQty[u] || 0) + Number(v.free || 0);
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
          const pos = await tron.getBalances(addresses);
          // tag with account_id
          const byAddr = new Map(tronAddrs.map(x => [x.address, x.id]));
          for (const p of pos) {
            p.account_id = byAddr.get(p.address) || null;
            const sym = p.symbol.toUpperCase();
            if (!balances[sym]) balances[sym] = { free: 0 };
            balances[sym].free += Number(p.qty || 0);
            // mark account ok
            if (p.account_id) await Accounts.health(p.account_id, 'ok');
            // platform: TRON
            if (!platformBySym.TRON[sym]) platformBySym.TRON[sym] = 0;
            platformBySym.TRON[sym] += Number(p.qty || 0);
            // account breakdown (DEX)
            if (p.account_id) {
              if (!accSym.has(p.account_id)) accSym.set(p.account_id, { name: nameById.get(p.account_id) || String(p.account_id), type: 'DEX', symQty: {} });
              const acc = accSym.get(p.account_id);
              acc.symQty[sym] = (acc.symQty[sym] || 0) + Number(p.qty || 0);
            }
          }
        }
        backoffOnchain = 0;
      } catch (e) {
        backoffOnchain += 30_000;
        logger.warn(`[scheduler] tron on-chain error: ${e.message}`);
      }
      // On-chain: Cardano (stake or addresses)
      const alwaysInclude = new Set();
      try {
        const specs = await Accounts.getCardanoSpecs();
        if (specs.length > 0) {
          const addrToAcc = new Map();
          const allAddrs = [];
          // Expand stakes to addresses
          for (const s of specs) {
            let addrs = [];
            if ((s.track_by || 'stake') === 'stake' && s.stake) {
              try {
                addrs = await cardano.getStakeAddresses(s.stake);
              } catch (e) {
                logger.warn(`[scheduler] cardano stake ${s.stake} error: ${e.message}`);
              }
            } else if (Array.isArray(s.addresses)) {
              addrs = s.addresses;
            }
            for (const a of addrs) {
              addrToAcc.set(a, s.id);
              allAddrs.push(a);
            }
          }
          if (allAddrs.length > 0) {
            const pos = await cardano.getBalances(allAddrs);
            for (const p of pos) {
              p.account_id = addrToAcc.get(p.address) || null;
              const sym = String(p.symbol || '').toUpperCase();
              if (!balances[sym]) balances[sym] = { free: 0 };
              balances[sym].free += Number(p.qty || 0);
              if (p.account_id) await Accounts.health(p.account_id, 'ok');
              // Ensure native tokens get included even if unpriced
              if (p.unpriced) alwaysInclude.add(sym);
              // platform: CARDANO
              if (!platformBySym.CARDANO[sym]) platformBySym.CARDANO[sym] = 0;
              platformBySym.CARDANO[sym] += Number(p.qty || 0);
              // account breakdown (DEX)
              if (p.account_id) {
                if (!accSym.has(p.account_id)) accSym.set(p.account_id, { name: nameById.get(p.account_id) || String(p.account_id), type: 'DEX', symQty: {} });
                const acc = accSym.get(p.account_id);
                acc.symQty[sym] = (acc.symQty[sym] || 0) + Number(p.qty || 0);
              }
            }
          }
        }
      } catch (e) {
        backoffOnchain += 30_000;
        logger.warn(`[scheduler] cardano on-chain error: ${e.message}`);
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

      const resolvedMin = typeof getMinUsdIgnore === 'function' ? (Number(await getMinUsdIgnore()) || minUsdIgnore) : minUsdIgnore;
      const snapshot = computeSnapshot({ balances, prices, refFiat, minUsdIgnore: resolvedMin, alwaysIncludeSymbols: Array.from(alwaysInclude) });
      // Compute platform allocation (value-weighted) from per-platform symbol balances
      const platformValues = { HTX: 0, TRON: 0, CARDANO: 0 };
      const symPrice = (s) => { const p = prices[s]; return p && p.price != null ? Number(p.price) : null; };
      for (const [sym, qty] of Object.entries(platformBySym.HTX)) {
        const pr = symPrice(sym);
        if (pr != null) platformValues.HTX += Number(qty || 0) * pr;
      }
      for (const [sym, qty] of Object.entries(platformBySym.TRON)) {
        const pr = symPrice(sym);
        if (pr != null) platformValues.TRON += Number(qty || 0) * pr;
      }
      for (const [sym, qty] of Object.entries(platformBySym.CARDANO)) {
        const pr = symPrice(sym);
        if (pr != null) platformValues.CARDANO += Number(qty || 0) * pr;
      }
      const pvTotal = platformValues.HTX + platformValues.TRON + platformValues.CARDANO;
      const toPct = (v) => pvTotal > 0 ? (v / pvTotal) * 100 : 0;
      snapshot.platform_allocation = [
        { name: 'HTX', value: platformValues.HTX, pct: toPct(platformValues.HTX) },
        { name: 'TRON', value: platformValues.TRON, pct: toPct(platformValues.TRON) },
        { name: 'Cardano', value: platformValues.CARDANO, pct: toPct(platformValues.CARDANO) },
      ];
      // Compute account allocation (value-weighted)
      const accList = [];
      let accTotal = 0;
      for (const [id, info] of accSym.entries()) {
        let val = 0;
        for (const [sym, qty] of Object.entries(info.symQty || {})) {
          const pr = symPrice(sym);
          if (pr != null) val += Number(qty || 0) * pr;
        }
        if (val > 0) {
          accList.push({ id, name: info.name || id, group: info.type === 'CEX' ? 'CEX' : 'DEX', value: val });
          accTotal += val;
        }
      }
      snapshot.account_allocation = accList.map(x => ({ ...x, pct: accTotal > 0 ? (x.value / accTotal) * 100 : 0 }));
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
