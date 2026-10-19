const test = require('node:test');
const assert = require('node:assert/strict');

const { createFailureLimiter, createUserAuth, requireAdmin } = require('./auth');
const { createMemoryStore, createToken } = require('../services/accounts');

async function run(middleware, { authorization, method = 'GET' } = {}) {
  const result = { status: 200, nextCalled: false };
  const req = { method, get: (name) => (name === 'authorization' ? authorization : undefined) };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await middleware(req, res, () => { result.nextCalled = true; });
  result.user = req.user;
  return result;
}

async function setup() {
  const store = createMemoryStore();
  const user = await store.insertUser({ username: 'alice', role: 'annotateur', active: true, token_version: 0, password_hash: 'x' });
  return { store, user, auth: createUserAuth({ getStore: () => store, secret: 's3cret' }) };
}

test('accepts a valid token and exposes the user', async () => {
  const { user, auth } = await setup();
  const result = await run(auth, { authorization: `Bearer ${createToken(user, 's3cret')}` });
  assert.equal(result.nextCalled, true);
  assert.equal(result.user.username, 'alice');
});

test('rejects missing, forged, expired and revoked tokens', async () => {
  const { store, user, auth } = await setup();
  assert.equal((await run(auth)).status, 401);
  assert.equal((await run(auth, { authorization: `Bearer ${createToken(user, 'other')}` })).status, 401);
  assert.equal((await run(auth, { authorization: `Bearer ${createToken(user, 's3cret', Date.now() - 8 * 24 * 3600 * 1000)}` })).status, 401);
  const token = createToken(user, 's3cret');
  await store.updateUser(user.id, { token_version: 1 });
  auth.forget(user.id);
  assert.equal((await run(auth, { authorization: `Bearer ${token}` })).status, 401);
});

test('lets CORS preflight requests through', async () => {
  const { auth } = await setup();
  assert.equal((await run(auth, { method: 'OPTIONS' })).nextCalled, true);
});

test('restricts admin routes to administrators', () => {
  const res = { status(code) { this.code = code; return this; }, json() { return this; } };
  requireAdmin({ user: { role: 'annotateur' } }, res, () => assert.fail('should not pass'));
  assert.equal(res.code, 403);
  let passed = false;
  requireAdmin({ user: { role: 'admin' } }, res, () => { passed = true; });
  assert.equal(passed, true);
});

test('blocks an address after repeated failures, then forgets it', () => {
  let clock = 0;
  const limiter = createFailureLimiter({ now: () => clock });
  for (let i = 0; i < 10; i += 1) limiter.fail('1.2.3.4');
  assert.equal(limiter.isBlocked('1.2.3.4'), true);
  assert.equal(limiter.isBlocked('5.6.7.8'), false);
  clock = 16 * 60 * 1000;
  assert.equal(limiter.isBlocked('1.2.3.4'), false);
});
