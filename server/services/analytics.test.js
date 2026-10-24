const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphFromPosts, buildStatsFromPosts, buildTimeline, createTemporalGraphBuilder, matchSubgraphPost } = require('./analytics');
const { detectPostKind, normalizePost } = require('./normalization');
const { matchesPostQuery } = require('./query');
const { postsPage } = require('../routes/posts');

const tweet = (extra = {}) => ({ platform: 'twitter', post_id: '1', author_handle: 'Alice', text: '', raw_json: { tweet: { type: 'tweet', ...extra } } });

test('detects retweets and quotes for Twitter and Bluesky', () => {
  assert.deepEqual(detectPostKind(tweet({ quoted_tweet: { id: '2' } })), { isRetweet: false, isQuote: true });
  assert.deepEqual(detectPostKind(tweet({ retweeted_tweet: { id: '3' } })), { isRetweet: true, isQuote: false });
  assert.deepEqual(detectPostKind({ platform: 'bluesky', event_type: 'repost', raw_json: { record: { $type: 'app.bsky.feed.repost' } } }), { isRetweet: true, isQuote: false });
  assert.deepEqual(detectPostKind({ platform: 'bluesky', raw_json: { $type: 'app.bsky.feed.post', embed: { $type: 'app.bsky.embed.recordWithMedia' } } }), { isRetweet: false, isQuote: true });
  assert.deepEqual(detectPostKind({ platform: 'bluesky', raw_json: { $type: 'app.bsky.feed.post', embed: { $type: 'app.bsky.embed.images' } } }), { isRetweet: false, isQuote: false });
});

test('counts post types without double counting originals', () => {
  const posts = [
    normalizePost(tweet()),
    normalizePost({ ...tweet({ quoted_tweet: { id: '9' } }), reply_to_id: '7' }),
    normalizePost({ platform: 'bluesky', event_type: 'repost', text: null }),
  ];
  assert.deepEqual(buildStatsFromPosts(posts).by_type, { original: 1, replies: 1, retweets: 1, quotes: 1 });
  assert.equal(matchesPostQuery(posts[1], { kind: 'quote' }), true);
  assert.equal(matchesPostQuery(posts[1], { kind: 'original' }), false);
  assert.equal(matchesPostQuery(posts[0], { kind: 'original' }), true);
});

test('extracts unicode hashtags for stats and graphs', () => {
  const post = normalizePost({ platform: 'twitter', text: 'Allez #España et #كأس_العالم #FIFA' });
  assert.deepEqual(Object.keys(buildStatsFromPosts([post]).hashtags).sort(), ['#fifa', '#españa', '#كأس_العالم'].sort());
  assert.equal(buildGraphFromPosts([post], 'hashtags').links.length, 3);
});

test('matches subgraph posts on selected nodes and edges only', () => {
  const selected = new Set(['#a', '#b']);
  assert.deepEqual(matchSubgraphPost({ text: '#a #b #c' }, 'hashtags', selected), { subgraph_nodes: ['#a', '#b'], subgraph_edges: ['#a::#b'] });
  assert.deepEqual(matchSubgraphPost({ text: '#a #c' }, 'hashtags', selected), { subgraph_nodes: ['#a'], subgraph_edges: [] });
  assert.equal(matchSubgraphPost({ text: '#ab #c' }, 'hashtags', selected), null);
  const mention = matchSubgraphPost({ author_handle: 'Bob', text: 'hi @alice @carol' }, 'mentions', new Set(['@bob', '@alice']));
  assert.deepEqual(mention, { subgraph_nodes: ['@bob', '@alice'], subgraph_edges: ['@alice::@bob'] });
});

test('timeline picks a bucket from the data span and excludes far outliers', () => {
  const base = Date.parse('2026-07-04T20:00:00Z');
  const rows = [];
  for (let minute = 0; minute < 600; minute += 1) rows.push({ date: base + minute * 60000, platform: 'twitter', count: 2 });
  rows.push({ date: '2009-04-29T15:33:00Z', platform: 'twitter', count: 1 });
  const timeline = buildTimeline(rows);
  assert.equal(timeline.excluded, 1);
  assert.equal(timeline.bucket_minutes, 5);
  assert.deepEqual(timeline.platforms, ['twitter']);
  assert.equal(timeline.points.reduce((sum, point) => sum + point.total, 0), 1200);
  assert.ok(timeline.points.every((point, index, all) => index === 0 || point.ts - all[index - 1].ts === 5 * 60000));
});

test('timeline keeps every point of a uniform distribution', () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ date: Date.parse('2026-07-01T00:00:00Z') + index * 3600000, platform: index % 2 ? 'bluesky' : 'twitter', count: 1 }));
  const timeline = buildTimeline(rows);
  assert.equal(timeline.excluded, 0);
  assert.deepEqual(timeline.platforms, ['bluesky', 'twitter']);
  assert.deepEqual(buildTimeline([]), { bucket_minutes: 60, excluded: 0, platforms: [], points: [] });
});

test('posts paging keeps the historical default and caps the limit', () => {
  assert.equal(postsPage({}).limit, 200);
  assert.equal(postsPage({ limit: '5000' }).limit, 1000);
  assert.equal(postsPage({ skip: '-4' }).skip, 0);
  assert.equal(postsPage({ sort: 'date' }).sort.field, 'timestamp');
  assert.equal(postsPage({ sort: 'nope' }).sort.field, 'engagement.likes');
});

test('uses Bluesky facet DIDs for mentions and keeps edge totals', () => {
  const bluesky = normalizePost({
    platform: 'bluesky', post_id: 'at://did:plc:a/app.bsky.feed.post/1', author_handle: 'did:plc:a', text: 'coucou @bob.bsky.social',
    raw_json: { $type: 'app.bsky.feed.post', facets: [{ features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:b' }] }] },
  });
  const graph = buildGraphFromPosts([bluesky], 'mentions');
  assert.deepEqual(graph.nodes.map((node) => node.id).sort(), ['@did:plc:a', '@did:plc:b']);
  const tweets = ['#a #b', '#a #b', '#a #c'].map((text) => normalizePost({ platform: 'twitter', text }));
  const filtered = buildGraphFromPosts(tweets, 'hashtags', Infinity, { minEdgeWeight: 2 });
  assert.deepEqual(filtered.links, [{ source: '#a', target: '#b', value: 2 }]);
  assert.equal(filtered.total_nodes, 3);
  assert.equal(filtered.total_links, 2);
});

test('filters posts by a list of ids', () => {
  const post = normalizePost({ platform: 'twitter', post_id: '7', text: '' });
  assert.equal(matchesPostQuery(post, { ids: '1,7, 9' }), true);
  assert.equal(matchesPostQuery(post, { ids: '1,9' }), false);
});

test('temporal graph keeps per-bucket counts for nodes and edges', () => {
  const at = (hour, text) => ({ platform: 'twitter', text, timestamp: `2026-07-12T${String(hour).padStart(2, '0')}:10:00.000Z` });
  const builder = createTemporalGraphBuilder('hashtags');
  [at(0, '#fra #esp'), at(0, '#fra'), at(3, '#fra #esp'), at(5, '#arg'), { platform: 'twitter', text: '#nodate' }].forEach(builder.add);
  const graph = builder.result(Infinity, { bucketMinutes: 60 });
  assert.equal(graph.time.bucket_minutes, 60);
  assert.equal(graph.time.start, '2026-07-12T00:00:00.000Z');
  assert.equal(graph.time.buckets, 6);
  assert.deepEqual(graph.time.volume, [2, 0, 0, 1, 0, 1]);
  assert.equal(graph.time.excluded, 1);
  const fra = graph.nodes.find((node) => node.id === '#fra');
  assert.equal(fra.value, 3);
  assert.deepEqual(fra.series, [[0, 2], [3, 1]]);
  assert.deepEqual(graph.links.map((link) => [link.source, link.target, link.value, link.series]), [['#esp', '#fra', 2, [[0, 1], [3, 1]]]]);
});

test('temporal graph can add the busiest nodes of each bucket', () => {
  const posts = [];
  for (let index = 0; index < 5; index += 1) posts.push({ platform: 'twitter', text: '#big', timestamp: '2026-07-12T00:00:00.000Z' });
  posts.push({ platform: 'twitter', text: '#peak', timestamp: '2026-07-12T02:00:00.000Z' });
  posts.push({ platform: 'twitter', text: '#other #other2', timestamp: '2026-07-12T00:00:00.000Z' });
  const run = (peaks) => { const builder = createTemporalGraphBuilder('hashtags'); posts.forEach(builder.add); return builder.result(1, { bucketMinutes: 60, peaks }).nodes.map((node) => node.id); };
  assert.deepEqual(run(0), ['#big']);
  assert.deepEqual(run(1).sort(), ['#big', '#peak']);
});

test('time bounds filter posts to the hour', () => {
  const post = normalizePost({ platform: 'twitter', text: 'x', timestamp: '2026-07-12T10:30:00.000Z' });
  assert.equal(matchesPostQuery(post, { startTime: '2026-07-12T10:00:00.000Z', endTime: '2026-07-12T11:00:00.000Z' }), true);
  assert.equal(matchesPostQuery(post, { startTime: '2026-07-12T11:00:00.000Z' }), false);
  assert.equal(matchesPostQuery(post, { endTime: '2026-07-12T10:30:00.000Z' }), false);
});
