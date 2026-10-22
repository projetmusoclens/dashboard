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
  return { server, call, store };
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

    await call('POST', '/api/annotations', { token: bob.token, body: { platform: 'twitter', post_id: '1', status: 'analyse', note: 'bob' } });
    await call('POST', '/api/annotations', { token: admin.token, body: { platform: 'twitter', post_id: '1', status: 'a_discuter', note: 'admin' } });
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

async function team(call) {
  const admin = (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin-password' } })).body;
  for (const username of ['alice', 'bob', 'carol']) {
    await call('POST', '/api/users', { token: admin.token, body: { username, name: username.toUpperCase(), password: `${username}-password` } });
  }
  const login = async (username) => (await call('POST', '/api/auth/login', { body: { username, password: `${username}-password` } })).body;
  return { admin, alice: await login('alice'), bob: await login('bob'), carol: await login('carol') };
}

test('a post can receive several annotations, each editable and removable by its author', async () => {
  const { server, call } = await startApp();
  try {
    const { alice, bob } = await team(call);
    const post = { platform: 'twitter', post_id: '42' };
    const first = (await call('POST', '/api/annotations', { token: alice.token, body: { ...post, status: 'a_analyser', note: 'première lecture' } }));
    assert.equal(first.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await call('POST', '/api/annotations', { token: alice.token, body: { ...post, status: 'analyse', theme: 'arbitrage', note: 'seconde lecture' } })).body.annotation;
    let detail = (await call('GET', '/api/annotations/post?platform=twitter&post_id=42', { token: alice.token })).body;
    assert.deepEqual(detail.mine.map((item) => item.note), ['seconde lecture', 'première lecture']);
    assert.ok(detail.mine.every((item) => item.id));

    const edited = await call('PUT', `/api/annotations/${second.id}`, { token: alice.token, body: { status: 'a_discuter', note: 'seconde lecture, corrigée' } });
    assert.equal(edited.body.annotation.status, 'a_discuter');
    assert.equal(edited.body.annotation.created_at, second.created_at);

    // Personne d'autre ne peut modifier, supprimer ni partager l'annotation d'Alice.
    assert.equal((await call('PUT', `/api/annotations/${second.id}`, { token: bob.token, body: { note: 'piraté' } })).status, 404);
    assert.equal((await call('DELETE', `/api/annotations/${second.id}`, { token: bob.token })).status, 404);
    assert.equal((await call('PUT', `/api/annotations/${second.id}/share`, { token: bob.token, body: { user_ids: [bob.user.id] } })).status, 404);

    await call('DELETE', `/api/annotations/${first.body.annotation.id}`, { token: alice.token });
    detail = (await call('GET', '/api/annotations/post?platform=twitter&post_id=42', { token: alice.token })).body;
    assert.deepEqual(detail.mine.map((item) => item.note), ['seconde lecture, corrigée']);
    assert.deepEqual((await call('GET', '/api/annotations/post?platform=twitter&post_id=42', { token: bob.token })).body, { mine: [], shared: [] });
  } finally {
    server.close();
  }
});

test('annotations can be shared one by one or all at once, read-only', async () => {
  const { server, call } = await startApp();
  try {
    const { admin, alice, bob, carol } = await team(call);
    const directory = (await call('GET', '/api/users/directory', { token: alice.token })).body.users;
    assert.deepEqual(directory.map((user) => user.username).sort(), ['admin', 'alice', 'bob', 'carol']);
    assert.equal('role' in directory[0], false);

    const onA = (await call('POST', '/api/annotations', { token: alice.token, body: { platform: 'twitter', post_id: 'A', note: 'sur A' } })).body.annotation;
    const otherOnA = (await call('POST', '/api/annotations', { token: alice.token, body: { platform: 'twitter', post_id: 'A', note: 'autre sur A' } })).body.annotation;
    await call('POST', '/api/annotations', { token: alice.token, body: { platform: 'twitter', post_id: 'B', note: 'sur B' } });

    // Une seule annotation partagée avec Bob (pas avec Alice elle-même ni un identifiant inconnu).
    const shared = await call('PUT', `/api/annotations/${onA.id}/share`, { token: alice.token, body: { user_ids: [bob.user.id, alice.user.id, 'nope'] } });
    assert.deepEqual(shared.body.annotation.shared_with, [bob.user.id]);
    const bobA = (await call('GET', '/api/annotations/post?platform=twitter&post_id=A', { token: bob.token })).body.shared;
    assert.deepEqual(bobA.map((item) => [item.name, item.note]), [['ALICE', 'sur A']]);
    assert.equal('shared_with' in bobA[0], false);
    assert.deepEqual((await call('GET', '/api/annotations/post?platform=twitter&post_id=B', { token: bob.token })).body.shared, []);
    assert.deepEqual((await call('GET', '/api/annotations/post?platform=twitter&post_id=A', { token: carol.token })).body.shared, []);
    assert.deepEqual((await call('GET', '/api/annotations/shared-with-me', { token: bob.token })).body.posts.map((item) => [item.post_id, item.owners]), [['A', ['ALICE']]]);
    assert.equal((await call('GET', '/api/annotations/post?platform=twitter&post_id=A', { token: admin.token })).body.shared.length, 2);

    // Modifier l'annotation garde son partage.
    await call('PUT', `/api/annotations/${onA.id}`, { token: alice.token, body: { note: 'sur A, modifiée' } });
    const mine = (await call('GET', '/api/annotations', { token: alice.token })).body.annotations;
    assert.deepEqual(mine.find((item) => item.id === onA.id).shared_with, [bob.user.id]);
    assert.deepEqual(mine.find((item) => item.id === otherOnA.id).shared_with, []);

    // Tout partager avec Carol : elle voit A (deux annotations) et B.
    await call('PUT', '/api/annotations/shares', { token: alice.token, body: { user_ids: [carol.user.id] } });
    assert.deepEqual((await call('GET', '/api/annotations/shares', { token: carol.token })).body.shared_with_me.map((user) => user.username), ['alice']);
    assert.deepEqual((await call('GET', '/api/annotations/shared-with-me', { token: carol.token })).body.posts.map((item) => item.post_id).sort(), ['A', 'B']);
    assert.equal((await call('GET', '/api/annotations/post?platform=twitter&post_id=A', { token: carol.token })).body.shared.length, 2);

    // Retirer les partages coupe l'accès.
    await call('PUT', `/api/annotations/${onA.id}/share`, { token: alice.token, body: { user_ids: [] } });
    await call('PUT', '/api/annotations/shares', { token: alice.token, body: { user_ids: [] } });
    assert.deepEqual((await call('GET', '/api/annotations/shared-with-me', { token: bob.token })).body.posts, []);
    assert.deepEqual((await call('GET', '/api/annotations/shared-with-me', { token: carol.token })).body.posts, []);
  } finally {
    server.close();
  }
});

test('sharing can leave out the free comment', async () => {
  const { server, call } = await startApp();
  try {
    const { admin, alice, bob, carol } = await team(call);
    const sharedTo = async (token) => (await call('GET', '/api/annotations/post?platform=twitter&post_id=N', { token })).body.shared[0];
    const annotation = (await call('POST', '/api/annotations', { token: alice.token, body: { platform: 'twitter', post_id: 'N', status: 'analyse', theme: 'arbitrage', note: 'commentaire personnel' } })).body.annotation;

    // Une annotation, sans commentaire : Bob voit le reste.
    await call('PUT', `/api/annotations/${annotation.id}/share`, { token: alice.token, body: { user_ids: [bob.user.id], include_notes: false } });
    let seen = await sharedTo(bob.token);
    assert.deepEqual([seen.theme, seen.note, seen.note_hidden, 'share_notes' in seen], ['arbitrage', '', true, false]);

    // Tout partager : le commentaire est inclus par défaut ; ici il est exclu pour Carol.
    await call('PUT', '/api/annotations/shares', { token: alice.token, body: { user_ids: [carol.user.id], include_notes: false } });
    assert.equal((await call('GET', '/api/annotations/shares', { token: alice.token })).body.include_notes, false);
    seen = await sharedTo(carol.token);
    assert.deepEqual([seen.note, seen.note_hidden], ['', true]);

    // Si l'un des deux partages autorise le commentaire, il est visible.
    await call('PUT', '/api/annotations/shares', { token: alice.token, body: { user_ids: [bob.user.id, carol.user.id] } });
    seen = await sharedTo(bob.token);
    assert.deepEqual([seen.note, seen.note_hidden], ['commentaire personnel', undefined]);
    assert.equal((await sharedTo(admin.token)).note, 'commentaire personnel');
  } finally {
    server.close();
  }
});
