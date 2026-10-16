const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCollections } = require('./collections');
const { buildGraphFromPosts, buildStatsFromPosts } = require('./analytics');
const { normalizePost } = require('./normalization');
const { matchesPostQuery } = require('./query');

function makePost(collectionName) {
  return {
    platform: 'twitter',
    lang: 'fr',
    author_handle: 'author',
    text: '',
    collection_name: collectionName,
    is_reply: false,
    has_link: false,
    matched_keywords: [],
    engagement: { likes: null, reposts: null, replies: null, quotes: null, views: null },
  };
}

test('groups posts by normalized collection_context name, not keywords or batches', () => {
  const collections = groupCollections([
    { collection_context: { collection_name: 'twitter_fra_live' }, matched_keywords: ['worldcup'] },
    { collection_context: { collection_name: ' twitter_fra_live ' }, batch_id: 'batch-2' },
    { collection_context: { collection_name: 'TWITTER_FRA_LIVE' } },
    { collection_context: { collection_name: 'bluesky_fra_live' } },
  ]);

  assert.deepEqual(collections, [
    { id: 'twitter_fra_live', name: 'twitter_fra_live', count: 3 },
    { id: 'bluesky_fra_live', name: 'bluesky_fra_live', count: 1 },
  ]);
});

test('places missing or blank context names in one explicit unknown group', () => {
  const collections = groupCollections([
    {},
    { collection_context: { collection_name: '' } },
  ]);

  assert.deepEqual(collections, [
    { id: 'collecte inconnue', name: 'Collecte inconnue', count: 2 },
  ]);
});

test('uses collection identity consistently in local stats and archive filters', () => {
  const posts = [makePost('twitter_fra_live'), makePost(' TWITTER_FRA_LIVE ')];
  const stats = buildStatsFromPosts(posts);

  assert.equal(stats.collection_stats.length, 1);
  assert.equal(stats.collection_stats[0].count, 2);
  assert.equal(matchesPostQuery(posts[0], { collectionId: 'TWITTER_FRA_LIVE' }), true);
  assert.equal(matchesPostQuery(posts[0], { collectionId: 'worldcup' }), false);
});

test('preserves full relation weights when building mention graphs', () => {
  const graph = buildGraphFromPosts([
    { author_handle: 'source', text: 'Hello @target' },
    { author_handle: 'source', text: 'Again @target' },
    { author_handle: 'source', text: 'And @target' },
  ], 'mentions');

  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].value, 3);
});

test('keeps image, video and object media URLs in normalized posts', () => {
  const post = normalizePost({
    post_id: 'post-1',
    text: 'A post',
    collection_context: { collection_name: 'twitter_event' },
    image_url: 'https://media.example/image.jpg',
    video_urls: ['https://media.example/video.mp4'],
    media: [{ url: 'https://media.example/clip.webm' }],
  });

  assert.deepEqual(post.image_urls, ['https://media.example/image.jpg']);
  assert.deepEqual(post.video_urls, ['https://media.example/video.mp4']);
  assert.deepEqual(post.media_urls, ['https://media.example/clip.webm']);
});