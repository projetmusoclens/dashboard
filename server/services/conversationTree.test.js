const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTree, csvLine, descendants, postUrl, selectDisplayed, slimRaw, treeStats } = require('./conversationTree');

// r ← a, b ; a ← a1, a2 ; b ← b1 ; a1 ← a1x
const replies = [
  ['a', 'r', '2026-07-18T17:01:00Z', 'u1'], ['b', 'r', '2026-07-18T17:00:00Z', 'u2'],
  ['a1', 'a', '2026-07-18T17:03:00Z', 'u3'], ['a2', 'a', '2026-07-18T17:02:00Z', 'u1'],
  ['b1', 'b', new Date('2026-07-18T17:05:00Z'), 'u4'], ['a1x', 'a1', null, 'u5'],
].map(([post_id, reply_to_id, date, author_handle]) => ({ _id: post_id, post_id, reply_to_id, date, author_handle, likes: 1 }));
const childrenOf = async (ids) => replies.filter((item) => ids.includes(item.reply_to_id));

test('a conversation tree is read level by level, replies grouped by parent and oldest first', async () => {
  const tree = await buildTree('r', childrenOf);
  assert.equal(tree.nodes.size, 6);
  assert.deepEqual(descendants(tree, 'r'), ['b', 'a', 'b1', 'a2', 'a1', 'a1x']);
  assert.deepEqual([tree.nodes.get('a1x').depth, tree.complete], [3, true]);
  const capped = await buildTree('r', childrenOf, { maxNodes: 4 });
  assert.deepEqual([capped.nodes.size, capped.complete], [4, false]);
});

test('the displayed part keeps the first levels, the path to the highlight, and reports pending replies', async () => {
  const tree = await buildTree('r', childrenOf);
  assert.deepEqual(selectDisplayed(tree, 'r', { limit: 3 }), { ids: ['b', 'a', 'b1'], pending: { a: 2 }, total: 6 });
  assert.deepEqual(selectDisplayed(tree, 'r', { limit: 2, highlight: 'a1x' }), { ids: ['b', 'a', 'a1', 'a1x'], pending: { a: 1, b: 1 }, total: 6 });
  assert.deepEqual(selectDisplayed(tree, 'a', { limit: 10 }), { ids: ['a2', 'a1', 'a1x'], pending: {}, total: 3 });
});

test('conversation stats cover the whole tree, not only the displayed part', async () => {
  const tree = await buildTree('r', childrenOf);
  assert.deepEqual(treeStats(tree, { author_handle: 'u0' }), { replies: 6, participants: 6, depth: 3, first_at: '2026-07-18T17:00:00.000Z', last_at: '2026-07-18T17:05:00.000Z' });
});

test('display posts keep what the reader shows, without the rest of raw_json', () => {
  const raw = { tweet: { text: 't', url: 'https://x.com/a/status/1', author: { name: 'A', userName: 'a', profilePicture: 'p', followers: 5 }, extendedEntities: { media: [{ type: 'photo', media_url_https: 'm', sizes: {} }] }, place: { big: true }, likeCount: 3 } };
  assert.deepEqual(slimRaw(raw), { tweet: { type: 'tweet', text: 't', url: 'https://x.com/a/status/1', likeCount: 3, author: { name: 'A', userName: 'a', profilePicture: 'p' }, entities: undefined, extendedEntities: { media: [{ type: 'photo', media_url_https: 'm' }] }, retweeted_tweet: undefined, quoted_tweet: undefined } });
  assert.equal(slimRaw({ record: { text: 'b', embed: { $type: 'x' }, other: 1 }, repo: 'did:plc:a' }).record.other, undefined);
  assert.equal(postUrl({ platform: 'bluesky', post_id: 'at://did:plc:a/app.bsky.feed.post/3k' }), 'https://bsky.app/profile/did:plc:a/post/3k');
  assert.equal(postUrl({ platform: 'twitter', post_id: '9', author_handle: 'bob', raw_json: {} }), 'https://x.com/bob/status/9');
  assert.equal(csvLine(['a', 'b"c', null]), '"a","b""c",""\r\n');
});
