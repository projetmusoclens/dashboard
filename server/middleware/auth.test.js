const test = require('node:test');
const assert = require('node:assert/strict');

const { createPasswordAuth } = require('./auth');

function run(middleware, { authorization, method = 'GET', ip = '1.2.3.4' } = {}) {
  const result = { status: 200, nextCalled: false };
  const req = { method, ip, get: (name) => (name === 'authorization' ? authorization : undefined) };
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  middleware(req, res, () => { result.nextCalled = true; });
  return result;
}

test('lets every request through when no password is configured', () => {
  assert.equal(run(createPasswordAuth('')).nextCalled, true);
});

test('accepts the right password and rejects a wrong or missing one', () => {
  const auth = createPasswordAuth('secret');
  assert.equal(run(auth, { authorization: 'Bearer secret' }).nextCalled, true);
  assert.equal(run(auth, { authorization: 'Bearer nope' }).status, 401);
  assert.equal(run(auth).status, 401);
});

test('lets CORS preflight requests through without a password', () => {
  assert.equal(run(createPasswordAuth('secret'), { method: 'OPTIONS' }).nextCalled, true);
});

test('blocks an address after repeated failures, then forgets it', () => {
  let clock = 0;
  const auth = createPasswordAuth('secret', { now: () => clock });
  for (let i = 0; i < 10; i += 1) run(auth, { authorization: 'Bearer nope' });

  assert.equal(run(auth, { authorization: 'Bearer secret' }).status, 429);
  assert.equal(run(auth, { authorization: 'Bearer secret', ip: '5.6.7.8' }).nextCalled, true);

  clock = 16 * 60 * 1000;
  assert.equal(run(auth, { authorization: 'Bearer secret' }).nextCalled, true);
});
