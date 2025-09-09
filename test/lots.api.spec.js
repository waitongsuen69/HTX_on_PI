const path = require('path');
const fs = require('fs');
const os = require('os');
const supertest = require('supertest');

// Spin up server with isolated CWD
function createTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htxpi-')); 
  fs.mkdirSync(path.join(dir, 'data'));
  return dir;
}

function startServer(tmpDir) {
  const prev = process.cwd();
  process.chdir(tmpDir);
  process.env.NO_LISTEN = '1'; // do not actually bind
  // reset modules that capture state/cwd
  const toClear = [
    '../src/routes/lots',
    '../src/storage/lotsStorage',
    '../src/utils/atomicFile',
    '../src/state',
  ];
  for (const m of toClear) {
    try { delete require.cache[require.resolve(m)]; } catch (_) {}
  }
  const app = require('express')();
  // Mount only the lots routes for testing
  app.use(require('express').json());
  app.use('/api/lots', require('../src/routes/lots'));
  const request = supertest(app);
  return { request, restore: () => process.chdir(prev) };
}

describe('Lots API', () => {
  test('create, edit, delete happy path; consumed edit denied', async () => {
    const tmp = createTmpDir();
    const { request, restore } = startServer(tmp);
    try {
      // create buy
      const r1 = await request.post('/api/lots').send({ date: '2025-01-01T00:00:00Z', asset: 'TRX', action: 'buy', qty: 100, unit_cost_usd: 0.1 });
      expect(r1.status).toBe(201);
      const id = r1.body.lot.id;
      // edit allowed
      const r2 = await request.put('/api/lots/'+id).send({ note: 'updated', qty: 120 });
      expect(r2.status).toBe(200);
      // create sell consuming partially
      const r3 = await request.post('/api/lots').send({ date: '2025-01-02T00:00:00Z', asset: 'TRX', action: 'sell', qty: -20 });
      expect(r3.status).toBe(201);
      // edit now should be denied (consumed)
      const r4 = await request.put('/api/lots/'+id).send({ qty: 90 });
      expect(r4.status).toBe(409);
      // delete should also be denied
      const r5 = await request.delete('/api/lots/'+id);
      expect(r5.status).toBe(409);
    } finally { restore(); }
  });

  test('import CSV conflict and 422 on negative', async () => {
    process.env.STORAGE_BACKEND = 'CSV';
    const tmp = createTmpDir();
    const { request, restore } = startServer(tmp);
    try {
      const { createLotsStorage } = require('../src/storage/lotsStorage');
      const store = createLotsStorage();
      store.loadAll();
      // Import initial buy
      const csv = 'id,date,asset,action,qty,unit_cost_usd,note\n000001,2025-01-01,TRX,buy,100,0.1,initial\n';
      const res1 = await request.post('/api/lots/import?skipOnConflict=true').attach('file', Buffer.from(csv), { filename: 'x.csv' });
      expect(res1.status).toBe(200);
      // Conflict
      const res2 = await request.post('/api/lots/import').attach('file', Buffer.from(csv), { filename: 'x.csv' });
      expect(res2.status).toBe(409);
      // Negative inventory
      const csv2 = 'id,date,asset,action,qty,unit_cost_usd,note\n,2025-01-02,TRX,withdraw,-200,,\n';
      const res3 = await request.post('/api/lots/import').attach('file', Buffer.from(csv2), { filename: 'y.csv' });
      expect(res3.status).toBe(422);
    } finally { restore(); }
  });

  test('export CSV and JSON', async () => {
    const tmp = createTmpDir();
    const { request, restore } = startServer(tmp);
    try {
      await request.post('/api/lots').send({ date:'2025-01-01', asset:'BTC', action:'buy', qty:1, unit_cost_usd:10000 });
      const r1 = await request.get('/api/lots/export?format=csv');
      expect(r1.status).toBe(200);
      expect(r1.headers['content-type']).toContain('text/csv');
      const r2 = await request.get('/api/lots/export?format=json');
      expect(r2.status).toBe(200);
      expect(r2.headers['content-type']).toContain('application/json');
    } finally { restore(); }
  });
});
