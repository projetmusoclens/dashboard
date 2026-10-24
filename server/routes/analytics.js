const {
  eventName,
  mongoCollectionKeyExpression,
  mongoCollectionNameExpression,
} = require('../services/collections');
const {
  escapeRegex,
  matchesPostQuery,
  mongoIsQuoteExpression,
  mongoIsReplyExpression,
  mongoIsRetweetExpression,
} = require('../services/query');
const {
  MONGO_HASHTAG_PATTERN,
  buildTimeline,
  createGraphBuilder,
  createTemporalGraphBuilder,
  matchSubgraphPost,
  timelineRowsFromPosts,
} = require('../services/analytics');

const GRAPH_DEFAULT_NODES = 300;
const GRAPH_MAX_NODES = 5000;
const SUBGRAPH_MAX_NODES = GRAPH_MAX_NODES;
const SUBGRAPH_DEFAULT_POSTS = 5000;
const SUBGRAPH_MAX_POSTS = 20000;
// startTime / endTime : fenêtre de temps du graphe dynamique (export des posts d'un sous-graphe).
const FILTER_KEYS = ['collectionId', 'platform', 'lang', 'startDate', 'endDate', 'startTime', 'endTime'];
const EMOJI_PATTERN = `[${String.fromCodePoint(0x2600)}-${String.fromCodePoint(0x27BF)}]`;

function registerAnalyticsRoutes(app, {
  getDataSource,
  normalizePost,
  buildStatsFromPosts,
  buildMatchFromQuery,
  safeHandler,
  profiles,
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
      isReply: mongoIsReplyExpression(),
      isRetweet: mongoIsRetweetExpression(),
      isQuote: mongoIsQuoteExpression(),
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
      hashtags: [{ $project: { tags: { $regexFindAll: { input: { $ifNull: ['$text', ''] }, regex: MONGO_HASHTAG_PATTERN } } } }, { $unwind: '$tags' }, { $group: { _id: { $toLower: '$tags.match' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }],
      collection_stats: [{ $group: { _id: '$normalizedCollectionKey', collection_name: { $min: '$normalizedCollection' }, event: { $max: '$collection_context.event' }, count: { $sum: 1 }, reposts: { $sum: { $ifNull: ['$repostsValue', 0] } }, quotes: { $sum: { $ifNull: ['$quotesValue', 0] } }, links: { $sum: { $cond: ['$hasLink', 1, 0] } }, emojis: { $sum: '$emojiCount' } } }, { $sort: { count: -1, collection_name: 1 } }],
      posts_vs_replies: [{ $group: { _id: { $cond: [{ $ne: ['$replyMarker', ''] }, 'replies', 'posts'] }, count: { $sum: 1 } } }],
      by_type: [{ $group: {
        _id: null,
        replies: { $sum: { $cond: ['$isReply', 1, 0] } },
        retweets: { $sum: { $cond: ['$isRetweet', 1, 0] } },
        quotes: { $sum: { $cond: ['$isQuote', 1, 0] } },
        original: { $sum: { $cond: [{ $or: ['$isReply', '$isRetweet', '$isQuote'] }, 0, 1] } },
      } }],
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
      collection_stats: (doc.collection_stats || []).map((item) => ({ collection_name: item.collection_name, event: eventName(item.event), count: item.count, reposts: item.reposts, quotes: item.quotes, emojis: item.emojis, links: item.links, link_rate: item.count ? (item.links / item.count) * 100 : 0 })),
      posts_vs_replies: postsVsReplies,
      by_type: (({ _id, ...counts }) => counts)(doc.by_type?.[0] || { original: 0, replies: 0, retweets: 0, quotes: 0 }),
      engagement_avg: doc.engagement_avg?.[0] || {},
      engagement_sum: doc.engagement_sum?.[0] || {},
    });
  }));

  app.get('/api/graph', safeHandler(async (req, res) => {
    const type = req.query.type === 'mentions' ? 'mentions' : 'hashtags';
    const maxNodes = Math.min(Math.max(Number(req.query.maxNodes) || GRAPH_DEFAULT_NODES, 1), GRAPH_MAX_NODES);
    const minEdgeWeight = Math.max(Number(req.query.minEdgeWeight) || 1, 1);
    // temporal=1 : séries par tranche de temps pour chaque nœud et arête (graphe dynamique).
    const temporal = req.query.temporal === '1' || req.query.temporal === 'true';
    const options = { minEdgeWeight, bucketMinutes: Number(req.query.bucketMinutes) || null, peaks: Math.min(Math.max(Number(req.query.peaks) || 0, 0), 10) };
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ nodes: [], links: [], total_nodes: 0, total_links: 0 });
    const builder = temporal ? createTemporalGraphBuilder(type) : createGraphBuilder(type);
    if (dataSource.mode === 'archive') {
      dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query)).forEach(builder.add);
    } else {
      const match = buildMatchFromQuery(req.query);
      const projection = { _id: 0, text: 1, author_handle: 1, platform: 1, 'raw_json.facets': 1, ...(temporal ? { timestamp: 1, createdAt: 1, collected_at: 1 } : {}) };
      const cursor = dataSource.db.collection('posts').find(Object.keys(match).length ? match : {}, { projection });
      for await (const post of cursor) builder.add(post);
    }
    const graph = builder.result(maxNodes, options);
    // Comptes Bluesky : le nœud garde son DID comme identifiant, le libellé devient le pseudo.
    if (type === 'mentions') await profiles.labelGraphNodes(graph.nodes.filter((node) => node.id.startsWith('@did:')));
    return res.json(graph);
  }));

  // Courbe des posts : agrégation à la minute puis regroupement adaptatif dans buildTimeline.
  app.get('/api/stats/timeline', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json(buildTimeline([]));

    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query));
      return res.json(buildTimeline(timelineRowsFromPosts(posts)));
    }

    const match = buildMatchFromQuery(req.query);
    const pipeline = [];
    if (Object.keys(match).length > 0) pipeline.push({ $match: match });
    pipeline.push({ $addFields: { normDate: { $convert: { input: { $ifNull: ['$timestamp', { $ifNull: ['$createdAt', '$collected_at'] }] }, to: 'date', onError: null, onNull: null } } } });
    pipeline.push({ $match: { normDate: { $ne: null } } });
    pipeline.push({ $group: {
      _id: {
        date: { $dateTrunc: { date: '$normDate', unit: 'minute' } },
        platform: { $toLower: { $ifNull: ['$platform', { $ifNull: ['$collection_context.platform', 'unknown'] }] } },
      },
      count: { $sum: 1 },
    } });
    const aggregate = await dataSource.db.collection('posts').aggregate(pipeline, { allowDiskUse: true }).toArray();
    return res.json(buildTimeline(aggregate.map((row) => ({ date: row._id.date, platform: row._id.platform, count: row.count }))));
  }));

  // Posts liés à un sous-graphe choisi dans l'onglet Graphes (nœuds sélectionnés + filtres actifs).
  app.post('/api/graph/subgraph', safeHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const type = body.type === 'mentions' ? 'mentions' : 'hashtags';
    const nodes = Array.isArray(body.nodes) ? [...new Set(body.nodes.filter((node) => typeof node === 'string' && node))] : [];
    if (!nodes.length) return res.status(400).json({ error: 'nodes must be a non-empty array of node ids' });
    if (nodes.length > SUBGRAPH_MAX_NODES) return res.status(400).json({ error: `At most ${SUBGRAPH_MAX_NODES} nodes can be exported` });
    const limit = Math.min(Math.max(Number(body.limit) || SUBGRAPH_DEFAULT_POSTS, 1), SUBGRAPH_MAX_POSTS);
    const includeRaw = body.includeRaw === true;
    const filters = Object.fromEntries(FILTER_KEYS.filter((key) => typeof body[key] === 'string' && body[key]).map((key) => [key, body[key]]));
    const selectedIds = new Set(nodes);

    const posts = [];
    let matched = 0;
    const collect = (rawPost) => {
      const post = normalizePost(rawPost);
      const match = matchSubgraphPost(post, type, selectedIds);
      if (!match) return;
      matched += 1;
      if (posts.length >= limit) return;
      if (!includeRaw) delete post.raw_json;
      posts.push({ ...post, ...match });
    };

    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ type, posts: [], matched: 0, truncated: false });
    if (dataSource.mode === 'archive') {
      dataSource.posts.filter((post) => matchesPostQuery(post, filters)).forEach(collect);
    } else {
      // Pré-filtre Mongo large (sous-chaîne) ; matchSubgraphPost applique ensuite la règle exacte du graphe.
      // raw_json reste lu : il sert à détecter retweets et citations avant d'être retiré.
      const terms = nodes.map((node) => escapeRegex(node.replace(/^[#@]/, ''))).join('|');
      const dids = nodes.filter((node) => node.startsWith('@did:')).map((node) => node.slice(1));
      const prefilter = type === 'mentions'
        ? { $or: [
          { text: new RegExp(`@(?:${terms})`, 'i') },
          { author_handle: new RegExp(`^(?:${terms})$`, 'i') },
          ...(dids.length ? [{ 'raw_json.facets.features.did': { $in: dids } }] : []),
        ] }
        : { text: new RegExp(`#(?:${terms})`, 'i') };
      const filterMatch = buildMatchFromQuery(filters);
      const query = Object.keys(filterMatch).length ? { $and: [filterMatch, prefilter] } : prefilter;
      const cursor = dataSource.db.collection('posts').find(query);
      for await (const post of cursor) collect(post);
    }
    await profiles.enrichPosts(posts);
    return res.json({ type, posts, matched, truncated: matched > posts.length });
  }));
}

module.exports = { registerAnalyticsRoutes };