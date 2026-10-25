const test = require('node:test');
const assert = require('node:assert/strict');
const { factEntities, factOf } = require('./facts');
const { graphEntities } = require('./analytics');
const { normalizePost } = require('./normalization');
const { buildFactsMatch, pickFilters } = require('./query');
const { createResponseCache } = require('./responseCache');

const tweet = { _id: 'a1', platform: 'twitter', post_id: '1', author_handle: 'Alice', text: 'Allez #France #FRA vs #España @Bob @carol https://x.co ☀', timestamp: '2026-07-18T17:00:02+00:00', reply_to_id: '9',
  collection_context: { collection_name: ' Twitter_FraEng_PF ', event: 'fra_eng_pf', started_at: '2026-07-18T17:00:03Z' },
  engagement: { likes: 3, reposts: null, replies: 1, quotes: 0, views: '12' }, matched_keywords: ['france'], raw_json: { tweet: { quoted_tweet: { id: '2' } } } };
const bluesky = { _id: 'b1', platform: 'bluesky', post_id: 'at://did:plc:x/app.bsky.feed.post/1', author_handle: 'did:plc:x', text: 'coucou @someone',
  raw_json: { facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:Y' }] }] } };

test('a fact keeps the normalized fields used by stats, lists and conversations', () => {
  const fact = factOf(tweet);
  assert.equal(fact._id, 'a1');
  assert.equal(fact.collection_key, 'twitter_fraeng_pf');
  assert.equal(fact.event, 'fra_eng_pf');
  assert.equal(fact.date.toISOString(), '2026-07-18T17:00:02.000Z');
  assert.deepEqual([fact.is_reply, fact.is_retweet, fact.is_quote, fact.has_link, fact.emojis], [true, false, true, true, 1]);
  assert.deepEqual([fact.likes, fact.reposts, fact.views], [3, null, 12]);
  assert.equal(fact.raw_json, undefined);
});

test('fact entities match graphEntities on the original post, for both graph types', () => {
  for (const raw of [tweet, bluesky, { ...tweet, text: 'sans entité' }]) {
    for (const type of ['hashtags', 'mentions']) {
      assert.deepEqual(factEntities(factOf(raw), type), graphEntities(normalizePost(raw), type), `${raw._id} ${type}`);
    }
  }
});

test('facts filters use plain indexable conditions', () => {
  assert.deepEqual(buildFactsMatch({}), {});
  assert.deepEqual(buildFactsMatch({ collectionId: 'A,b' }), { collection_key: { $in: ['a', 'b'] } });
  assert.deepEqual(buildFactsMatch({ collectionId: 'A' }), { collection_key: 'a' });
  const match = buildFactsMatch({ platform: 'Twitter', startDate: '2026-07-18', endDate: '2026-07-18', startTime: '2026-07-18T10:00:00Z', kind: 'original' });
  assert.deepEqual(match.$and, [
    { platform: 'twitter' },
    { is_retweet: false, is_quote: false, is_reply: false },
    { date: { $gte: new Date('2026-07-18T10:00:00Z'), $lt: new Date('2026-07-19T00:00:00Z') } },
  ]);
});

test('the response cache shares identical computations and forgets everything on clear', async () => {
  const cache = createResponseCache({ maxEntries: 2 });
  let calls = 0;
  const compute = async () => { calls += 1; return calls; };
  const [first, second] = await Promise.all([cache.get('stats', { b: 1, a: 2 }, compute), cache.get('stats', { a: 2, b: 1 }, compute)]);
  assert.deepEqual([first, second, calls], [1, 1, 1]);
  cache.clear();
  assert.equal(await cache.get('stats', { a: 2, b: 1 }, compute), 2);
  await assert.rejects(cache.get('fails', {}, async () => { throw new Error('boom'); }));
  assert.equal(await cache.get('fails', {}, async () => 'ok'), 'ok');
  await cache.get('x', {}, compute);
  await cache.get('y', {}, compute);
  assert.equal(cache.size(), 2);
});

test('cache keys do not depend on the order collections were ticked', () => {
  const keys = ['collectionId', 'platform'];
  assert.deepEqual(pickFilters({ collectionId: 'B, a,,A', platform: 'twitter', other: 'x' }, keys), { collectionId: 'a,b', platform: 'twitter' });
  assert.deepEqual(pickFilters({ collectionId: ' , ' }, keys), {});
});

test('facts are rebuilt at startup, but only once the post count is stable afterwards', async () => {
  const facts = require('./facts');
  const original = { factsStatus: facts.factsStatus, rebuildFacts: facts.rebuildFacts, ensureFactIndexes: facts.ensureFactIndexes };
  let posts = 10;
  let builtFor = null;
  const builds = [];
  facts.factsStatus = async () => ({ exists: builtFor !== null, fresh: builtFor === posts, posts, facts: builtFor || 0 });
  facts.rebuildFacts = async () => { builds.push(posts); builtFor = posts; };
  facts.ensureFactIndexes = async () => {};
  delete require.cache[require.resolve('./factsManager')];
  const { createFactsManager } = require('./factsManager');
  let cleared = 0;
  let warmed = 0;
  const manager = createFactsManager({ getDb: () => ({}), cache: { clear: () => { cleared += 1; } }, warm: async () => { warmed += 1; }, log: () => {} });
  try {
    await manager.check();
    assert.deepEqual([builds, manager.ready(), cleared, warmed], [[10], true, 1, 1]);
    posts = 500;
    await manager.check();
    assert.deepEqual(builds, [10], 'pas de reconstruction pendant que le nombre de posts change');
    await manager.check();
    assert.deepEqual(builds, [10, 500]);
    await manager.check();
    assert.deepEqual([builds, cleared], [[10, 500], 2]);
  } finally {
    Object.assign(facts, original);
    delete require.cache[require.resolve('./factsManager')];
  }
});
