const test = require('node:test');
const assert = require('node:assert/strict');
const { lightPost, missingRoot, resolveRoots, selectConversations, summarizeConversations } = require('./conversations');
const { buildThreads } = require('./analytics');

const post = (id, parent, author = id, ts = '2026-07-01T10:00:00Z') => lightPost({ post_id: id, reply_to_id: parent, author_handle: author, timestamp: ts, platform: 'twitter', engagement: { likes: 1 } });
const known = (...posts) => new Map(posts.map((item) => [item.post_id, item]));

test('attaches replies to the topmost collected ancestor or to the missing parent', () => {
  const roots = resolveRoots(known(post('r', null), post('a', 'r'), post('b', 'a'), post('x', 'missing'), post('y', 'x')));
  assert.equal(roots.get('b'), 'r');
  assert.equal(roots.get('r'), 'r');
  assert.equal(roots.get('y'), 'missing');
  assert.equal(roots.get('x'), 'missing');
});

test('summarizes conversations without counting a reply as its own parent', () => {
  const summaries = summarizeConversations(known(
    post('r', null, 'alice', '2026-07-01T10:00:00Z'), post('a', 'r', 'bob', '2026-07-01T10:05:00Z'), post('b', 'a', 'alice', '2026-07-01T11:00:00Z'),
    post('lonely', 'gone', 'carol'),
  ));
  const byRoot = Object.fromEntries(summaries.map((item) => [item.root_id, item]));
  assert.deepEqual(Object.keys(byRoot).sort(), ['gone', 'r']);
  assert.equal(byRoot.r.reply_count, 2);
  assert.equal(byRoot.r.participants, 2);
  assert.equal(byRoot.r.depth, 2);
  assert.equal(byRoot.r.direct_replies, 1);
  assert.equal(byRoot.r.last_at, '2026-07-01T11:00:00.000Z');
  assert.equal(byRoot.gone.root_missing, true);
  const page = selectConversations(summaries, { minReplies: 2 });
  assert.deepEqual(page.items.map((item) => item.root_id), ['r']);
  assert.equal(selectConversations(summaries, { root: 'missing' }).total, 1);
});

test('builds links for missing roots', () => {
  assert.deepEqual(missingRoot('42', { raw_json: { tweet: { inReplyToUsername: 'FIFAWorldCup' } } }), { post_id: '42', platform: 'twitter', author_handle: 'FIFAWorldCup', url: 'https://x.com/FIFAWorldCup/status/42', missing: true });
  assert.equal(missingRoot('at://did:plc:a/app.bsky.feed.post/3k').url, 'https://bsky.app/profile/did:plc:a/post/3k');
});

test('legacy threads never use a reply as its own parent', () => {
  const threads = buildThreads([{ post_id: 'x', reply_to_id: 'gone', platform: 'twitter' }]);
  assert.equal(threads[0].parent.post_id, 'gone');
  assert.equal(threads[0].parent.missing, true);
  assert.deepEqual(threads[0].replies.map((item) => item.post_id), ['x']);
});
