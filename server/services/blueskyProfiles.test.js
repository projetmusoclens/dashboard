const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileResolver } = require('./blueskyProfiles');

function fakeFetch(profiles) {
  const calls = [];
  const impl = async (url) => {
    const actors = new URL(url).searchParams.getAll('actors');
    calls.push(actors);
    return { ok: true, json: async () => ({ profiles: actors.filter((did) => profiles[did]).map((did) => ({ did, ...profiles[did] })) }) };
  };
  return { impl, calls };
}

test('resolves profiles in batches of 25 and caches them, including unknown accounts', async () => {
  const known = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`did:plc:${index}`, { handle: `user${index}.bsky.social`, displayName: `User ${index}` }]));
  const { impl, calls } = fakeFetch(known);
  const resolver = createProfileResolver({ fetchImpl: impl });
  const dids = [...Object.keys(known), 'did:plc:gone', 'not-a-did'];
  const first = await resolver.resolve(dids);
  assert.deepEqual(calls.map((batch) => batch.length).sort((a, b) => a - b), [6, 25]);
  assert.deepEqual(first.get('did:plc:3'), { handle: 'user3.bsky.social', display_name: 'User 3', avatar: null });
  assert.equal(first.get('did:plc:gone'), null);
  assert.equal(first.has('not-a-did'), false);
  await resolver.resolve(dids);
  assert.equal(calls.length, 2, 'cached profiles are not fetched again');
});

test('enriches Bluesky posts and graph labels, and survives API failures', async () => {
  const { impl } = fakeFetch({ 'did:plc:a': { handle: 'alice.bsky.social', displayName: 'Alice' } });
  const resolver = createProfileResolver({ fetchImpl: impl });
  const posts = [{ platform: 'bluesky', author_id: 'did:plc:a', author_handle: 'did:plc:a' }, { platform: 'twitter', author_handle: 'bob' }];
  await resolver.enrichPosts(posts);
  assert.equal(posts[0].author_profile.display_name, 'Alice');
  assert.equal('author_profile' in posts[1], false);
  const nodes = [{ id: '@did:plc:a', label: '@did:plc:a', value: 3 }];
  await resolver.labelGraphNodes(nodes);
  assert.equal(nodes[0].label, '@alice.bsky.social');

  const failing = createProfileResolver({ fetchImpl: async () => { throw new Error('offline'); } });
  const result = await failing.resolve(['did:plc:z']);
  assert.equal(result.get('did:plc:z'), null);
});

test('answers without waiting for a slow Bluesky API', async () => {
  const resolver = createProfileResolver({ waitMs: 20, fetchImpl: () => new Promise(() => {}) });
  const started = Date.now();
  const result = await resolver.resolve(['did:plc:slow']);
  assert.ok(Date.now() - started < 1000);
  assert.equal(result.get('did:plc:slow'), null);
});
