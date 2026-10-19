const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { bootstrapAdmin, createMemoryStore, hashPassword, verifyPassword, cleanAnnotation } = require('../services/accounts');
const { createFailureLimiter, createUserAuth } = require('../middleware/auth');
const { registerAccountRoutes, registerPublicAuthRoutes } = require('./accounts');

const safeHandler = (handler) => (req, res, next) => handler(req, res).catch(next);

async function startApp() {
  const store = createMemoryStore();
  await bootstrapAdmin(store, { username: 'admin', password: 'admin-password' });
  const app = express();
  app.use(express.json());
  registerPublicAuthRoutes(app, { getStore: () => store, secret: 'k', limiter: createFailureLimiter(), safeHandler });
  const userAuth = createUserAuth({ getStore: () => store, secret: 'k' });
  app.use('/api', userAuth);
  registerAccountRoutes(app, { getStore: () => store, userAuth, safeHandler, findPostsByIds: async (ids) => ids.map((id) => ({ post_id: id, text: `texte ${id}`, author_handle: 'x' })) });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { server, call };
}

test('hashes passwords and cleans annotations', () => {
  const hash = hashPassword('correct horse');
  assert.equal(verifyPassword('correct horse', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.deepEqual(cleanAnnotation({ status: 'nope', relevance: 'oui', note: '  ok  ', extra: 'x' }), { status: 'a_analyser', relevance: 'oui', theme: '', tone: '', interaction: '', keywords: '', note: 'ok' });
});

test('admin creates accounts, annotators only see their own annotations', async () => {
  const { server, call } = await startApp();
  try {
    assert.equal((await call('GET', '/api/users')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'bad' } })).status, 401);
    const admin = (await call('POST', '/api/auth/login', { body: { username: 'Admin', password: 'admin-password' } })).body;
    assert.equal(admin.user.role, 'admin');

    assert.equal((await call('POST', '/api/users', { token: admin.token, body: { username: 'bob', password: 'short' } })).status, 400);
    const created = await call('POST', '/api/users', { token: admin.token, body: { username: 'bob', name: 'Bob', password: 'bob-password' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'annotateur');
    assert.equal((await call('POST', '/api/users', { token: admin.token, body: { username: 'bob', password: 'bob-password' } })).status, 409);

    const bob = (await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'bob-password' } })).body;
    assert.equal((await call('GET', '/api/users', { token: bob.token })).status, 403);
    assert.equal((await call('GET', '/api/annotations?scope=all', { token: bob.token })).status, 403);

    await call('PUT', '/api/annotations', { token: bob.token, body: { platform: 'twitter', post_id: '1', status: 'analyse', note: 'bob' } });
    await call('PUT', '/api/annotations', { token: admin.token, body: { platform: 'twitter', post_id: '1', status: 'a_discuter', note: 'admin' } });
    const mine = (await call('GET', '/api/annotations', { token: bob.token })).body.annotations;
    assert.deepEqual(mine.map((item) => [item.post_id, item.note, item.username]), [['1', 'bob', 'bob']]);
    const all = (await call('GET', '/api/annotations?scope=all', { token: admin.token })).body.annotations;
    assert.equal(all.length, 2);
    const exported = (await call('GET', '/api/annotations/export?scope=all', { token: admin.token })).body.annotations;
    assert.equal(exported[0].post.text, 'texte 1');

    const imported = (await call('POST', '/api/annotations/import', { token: bob.token, body: { items: [{ platform: 'twitter', post_id: '1', note: 'local' }, { platform: 'bluesky', post_id: 'at://x', status: 'analyse' }, { platform: 'mastodon', post_id: '2' }] } })).body;
    assert.deepEqual(imported, { imported: 1, skipped: 2 });

    // Désactiver un compte coupe sa session ; le dernier admin ne peut pas être retiré.
    await call('PATCH', `/api/users/${created.body.user.id}`, { token: admin.token, body: { active: false } });
    assert.equal((await call('GET', '/api/annotations', { token: bob.token })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'bob-password' } })).status, 401);
    assert.equal((await call('PATCH', `/api/users/${admin.user.id}`, { token: admin.token, body: { role: 'annotateur' } })).status, 400);

    const changed = await call('POST', '/api/auth/password', { token: admin.token, body: { current: 'admin-password', next: 'new-admin-password' } });
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/api/auth/me', { token: admin.token })).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: changed.body.token })).body.user.username, 'admin');
  } finally {
    server.close();
  }
});
