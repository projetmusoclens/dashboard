const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerEventSheetRoutes } = require('./eventSheets');
const { cleanSheet } = require('../services/eventSheets');

// Application minimale : l'utilisateur est choisi par l'en-tête x-role (l'authentification a ses propres tests).
async function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { username: req.headers['x-role'] || 'alice', role: req.headers['x-role'] === 'admin' ? 'admin' : 'annotateur' }; next(); });
  registerEventSheetRoutes(app, { getDb: () => null, safeHandler: (handler) => (req, res, next) => handler(req, res).catch(next) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const call = async (method, path, body, role) => {
    const res = await fetch(`http://localhost:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(role ? { 'x-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

test('sheets are cleaned: known fields only, valid moments sorted by time', () => {
  const sheet = cleanSheet({
    title: '  France – Angleterre ', teams: ['France', 'Angleterre', 'Extra'], kickoff_at: '2026-07-18T21:00:00Z', hack: 'x',
    moments: [
      { time: '2026-07-18T21:40:00Z', kind: 'goal', minute: '40', team: 'France', label: 'But' },
      { time: 'pas une date', kind: 'goal' },
      { time: '2026-07-18T21:00:00Z', kind: 'inconnu', label: 'Coup d’envoi' },
    ],
  });
  assert.equal(sheet.title, 'France – Angleterre');
  assert.deepEqual(sheet.teams, ['France', 'Angleterre']);
  assert.equal(sheet.hack, undefined);
  assert.deepEqual(sheet.moments.map((moment) => [moment.time, moment.kind]), [['2026-07-18T21:00:00.000Z', 'other'], ['2026-07-18T21:40:00.000Z', 'goal']]);
});

test('everyone reads the prefilled sheets; only admins change or reset them', async () => {
  const { server, call } = await startApp();
  try {
    const list = await call('GET', '/api/event-sheets');
    const finale = list.body.sheets.find((sheet) => sheet.event === 'esp_arg_finale');
    assert.deepEqual([finale.customized, finale.kickoff_at, finale.moments[0].kind], [false, '2026-07-19T19:00:00.000Z', 'kickoff']);
    assert.ok(finale.moments.some((moment) => moment.kind === 'goal' && moment.minute === '106'));

    const edit = { ...finale, score: '2-1', moments: [...finale.moments, { time: '2026-07-19T19:30:00Z', kind: 'goal', minute: '30', team: 'Espagne', label: 'But' }] };
    const expected = finale.moments.length + 1;
    assert.equal((await call('PUT', '/api/event-sheets/esp_arg_finale', edit)).status, 403);
    const saved = await call('PUT', '/api/event-sheets/esp_arg_finale', edit, 'admin');
    assert.deepEqual([saved.status, saved.body.sheet.customized, saved.body.sheet.score, saved.body.sheet.moments.length, saved.body.sheet.updated_by], [200, true, '2-1', expected, 'admin']);
    assert.equal((await call('GET', '/api/event-sheets')).body.sheets.find((sheet) => sheet.event === 'esp_arg_finale').score, '2-1');

    const created = await call('PUT', '/api/event-sheets/nouveau_match', { title: 'Nouveau' }, 'admin');
    assert.equal(created.body.sheet.title, 'Nouveau');
    assert.equal((await call('PUT', '/api/event-sheets/mauvais id!', {}, 'admin')).status, 400);

    assert.equal((await call('DELETE', '/api/event-sheets/esp_arg_finale')).status, 403);
    const reset = await call('DELETE', '/api/event-sheets/esp_arg_finale', null, 'admin');
    assert.deepEqual([reset.body.sheet.customized, reset.body.sheet.score], [false, finale.score]);
    assert.equal((await call('DELETE', '/api/event-sheets/nouveau_match', null, 'admin')).body.sheet, null);
  } finally {
    server.close();
  }
});
