const {
  mongoCollectionKeyExpression,
  mongoCollectionNameExpression,
} = require('../services/collections');
const { matchesPostQuery } = require('../services/query');
const { createGraphBuilder } = require('../services/analytics');

const GRAPH_MAX_NODES = 300;
const EMOJI_PATTERN = `[${String.fromCodePoint(0x2600)}-${String.fromCodePoint(0x27BF)}]`;

function registerAnalyticsRoutes(app, {
  getDataSource,
  normalizePost,
  buildStatsFromPosts,
  buildGraphFromPosts,
  buildMatchFromQuery,
  safeHandler,
}) {
  app.get('/api/stats', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    const match = buildMatchFromQuery(req.query);
    if (dataSource.mode === 'none') return res.json({ total_posts: 0 });

    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query));
      return res.json(buildStatsFromPosts(posts));
    }

    const postsCollection = dataSource.db.collection('posts');
    const pipeline = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push({ $addFields: {
      normalizedPlatform: { $toLower: { $ifNull: ['$platform', { $ifNull: ['$collection_context.platform', 'unknown'] }] } },
      normalizedLang: { $toLower: { $ifNull: ['$lang', 'unknown'] } },
      normalizedAuthor: { $ifNull: ['$author_handle', 'Auteur inconnu'] },
      normalizedCollection: mongoCollectionNameExpression(),
      normalizedCollectionKey: mongoCollectionKeyExpression(),
      hasLink: { $regexMatch: { input: { $ifNull: ['$text', ''] }, regex: 'https?://', options: 'i' } },
      emojiCount: { $size: { $regexFindAll: { input: { $ifNull: ['$text', ''] }, regex: EMOJI_PATTERN } } },
      replyMarker: { $ifNull: ['$reply_to_id', ''] },
      likesValue: { $convert: { input: '$engagement.likes', to: 'double', onError: null, onNull: null } },
      repostsValue: { $convert: { input: '$engagement.reposts', to: 'double', onError: null, onNull: null } },
      repliesValue: { $convert: { input: '$engagement.replies', to: 'double', onError: null, onNull: null } },
      quotesValue: { $convert: { input: '$engagement.quotes', to: 'double', onError: null, onNull: null } },
      viewsValue: { $convert: { input: '$engagement.views', to: 'double', onError: null, onNull: null } },
    } });
    pipeline.push({ $facet: {
      total: [{ $count: 'count' }],
      by_platform: [{ $group: { _id: '$normalizedPlatform', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
      by_lang: [{ $group: { _id: '$normalizedLang', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
      top_authors: [{ $group: { _id: '$normalizedAuthor', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }],
      by_keyword: [{ $unwind: '$matched_keywords' }, { $group: { _id: '$matched_keywords', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }],
      hashtags: [{ $project: { tags: { $regexFindAll: { input: { $ifNull: ['$text', ''] }, regex: '#[A-Za-z0-9_]+' } } } }, { $unwind: '$tags' }, { $group: { _id: { $toLower: '$tags.match' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }],
      collection_stats: [{ $group: { _id: '$normalizedCollectionKey', collection_name: { $min: '$normalizedCollection' }, count: { $sum: 1 }, reposts: { $sum: { $ifNull: ['$repostsValue', 0] } }, quotes: { $sum: { $ifNull: ['$quotesValue', 0] } }, links: { $sum: { $cond: ['$hasLink', 1, 0] } }, emojis: { $sum: '$emojiCount' } } }, { $sort: { count: -1, collection_name: 1 } }],
      posts_vs_replies: [{ $group: { _id: { $cond: [{ $ne: ['$replyMarker', ''] }, 'replies', 'posts'] }, count: { $sum: 1 } } }],
      engagement_avg: [{ $group: { _id: null, likes: { $avg: '$likesValue' }, reposts: { $avg: '$repostsValue' }, replies: { $avg: '$repliesValue' }, quotes: { $avg: '$quotesValue' }, views: { $avg: '$viewsValue' } } }],
      engagement_sum: [{ $group: { _id: null, likes: { $sum: { $ifNull: ['$likesValue', 0] } }, reposts: { $sum: { $ifNull: ['$repostsValue', 0] } }, replies: { $sum: { $ifNull: ['$repliesValue', 0] } }, quotes: { $sum: { $ifNull: ['$quotesValue', 0] } }, views: { $sum: { $ifNull: ['$viewsValue', 0] } } } }],
    } });

    const [doc = {}] = await postsCollection.aggregate(pipeline).toArray();
    const postsVsReplies = (doc.posts_vs_replies || []).reduce((result, item) => { result[item._id] = item.count; return result; }, { posts: 0, replies: 0 });
    return res.json({
      total_posts: doc.total?.[0]?.count || 0,
      by_platform: (doc.by_platform || []).reduce((result, item) => { result[item._id] = item.count; return result; }, {}),
      by_lang: (doc.by_lang || []).reduce((result, item) => { result[item._id] = item.count; return result; }, {}),
      top_authors: (doc.top_authors || []).map((item) => ({ author: item._id, count: item.count })),
      by_keyword: (doc.by_keyword || []).reduce((result, item) => { result[item._id] = item.count; return result; }, {}),
      hashtags: (doc.hashtags || []).reduce((result, item) => { result[item._id] = item.count; return result; }, {}),
      collection_stats: (doc.collection_stats || []).map((item) => ({ collection_name: item.collection_name, count: item.count, reposts: item.reposts, quotes: item.quotes, emojis: item.emojis, links: item.links, link_rate: item.count ? (item.links / item.count) * 100 : 0 })),
      posts_vs_replies: postsVsReplies,
      engagement_avg: doc.engagement_avg?.[0] || {},
      engagement_sum: doc.engagement_sum?.[0] || {},
    });
  }));

  app.get('/api/graph', safeHandler(async (req, res) => {
    const type = req.query.type === 'mentions' ? 'mentions' : 'hashtags';
    const maxNodes = Math.min(Number(req.query.maxNodes) || GRAPH_MAX_NODES, 2000);
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ nodes: [], links: [] });
    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query));
      return res.json(buildGraphFromPosts(posts, type, maxNodes));
    }
    const match = buildMatchFromQuery(req.query);
    const cursor = dataSource.db.collection('posts').find(Object.keys(match).length ? match : {}, { projection: { _id: 0, text: 1, author_handle: 1 } });
    const builder = createGraphBuilder(type);
    for await (const post of cursor) builder.add(post);
    return res.json(builder.result(maxNodes));
  }));

  app.get('/api/stats/timeline', safeHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const dataSource = getDataSource();
    const match = buildMatchFromQuery(req.query);
    if (dataSource.mode === 'none') return res.json([]);

    let unit = 'day';
    if (startDate && endDate) {
      const diffHours = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60);
      if (diffHours > 24 * 90) unit = 'day';
      else unit = 'hour';
    }

    if (dataSource.mode === 'archive') {
      const buckets = new Map();
      dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query)).forEach((post) => {
        const date = new Date(post.timestamp || post.createdAt || post.collected_at || Date.now());
        const key = unit === 'hour' ? `${date.toISOString().slice(0, 13)}:00:00` : date.toISOString().slice(0, 10);
        const item = buckets.get(key) || { date: key, twitter: 0, bluesky: 0, unknown: 0, total: 0 };
        item.total += 1;
        if (post.platform === 'twitter') item.twitter += 1;
        else if (post.platform === 'bluesky') item.bluesky += 1;
        else item.unknown += 1;
        buckets.set(key, item);
      });
      return res.json(Array.from(buckets.values()).sort((left, right) => left.date.localeCompare(right.date)));
    }

    const postsCollection = dataSource.db.collection('posts');
    const pipeline = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push({ $addFields: { normDate: { $convert: { input: { $ifNull: ['$timestamp', '$createdAt'] }, to: 'date', onError: null, onNull: null } } } });
    pipeline.push({ $match: { normDate: { $ne: null } } });
    pipeline.push({ $group: { _id: { date: { $dateTrunc: { date: '$normDate', unit } }, platform: '$platform' }, count: { $sum: 1 } } });
    pipeline.push({ $sort: { '_id.date': 1 } });
    const aggregate = await postsCollection.aggregate(pipeline).toArray();
    const buckets = new Map();
    aggregate.forEach((row) => {
      const date = row._id.date.toISOString();
      const item = buckets.get(date) || { date, twitter: 0, bluesky: 0, unknown: 0, total: 0 };
      const platform = String(row._id.platform || '').toLowerCase();
      item.total += row.count;
      if (platform.includes('twitter')) item.twitter += row.count;
      else if (platform.includes('blue')) item.bluesky += row.count;
      else item.unknown += row.count;
      buckets.set(date, item);
    });
    return res.json(Array.from(buckets.values()));
  }));
}

module.exports = { registerAnalyticsRoutes };