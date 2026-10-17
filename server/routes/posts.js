const { matchesPostQuery } = require('../services/query');

const POSTS_DEFAULT_LIMIT = 200;
const POSTS_MAX_LIMIT = 1000;
const POST_SORTS = {
  likes: { field: 'engagement.likes', value: (post) => post.engagement?.likes || 0 },
  views: { field: 'engagement.views', value: (post) => post.engagement?.views || 0 },
  reposts: { field: 'engagement.reposts', value: (post) => post.engagement?.reposts || 0 },
  replies: { field: 'engagement.replies', value: (post) => post.engagement?.replies || 0 },
  date: { field: 'timestamp', value: (post) => new Date(post.timestamp || 0).getTime() || 0 },
};

// Pagination et tri de /api/posts ; sans paramètre, le comportement historique (200 posts par likes) est conservé.
function postsPage(query) {
  const limit = Math.min(Math.max(Math.floor(Number(query.limit)) || POSTS_DEFAULT_LIMIT, 1), POSTS_MAX_LIMIT);
  const skip = Math.max(Math.floor(Number(query.skip)) || 0, 0);
  const sort = POST_SORTS[query.sort] || POST_SORTS.likes;
  return { limit, skip, sort };
}

function registerPostRoutes(app, {
  getDataSource,
  getDb,
  normalizePost,
  buildStatsFromPosts,
  buildThreads,
  buildMatchFromQuery,
  safeHandler,
  databaseName,
}) {
  app.get('/api/dashboard', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') {
      return res.json({
        title: 'Heimdall', subtitle: databaseName, total_posts: 0, by_lang: {}, by_keyword: {},
        posts_vs_replies: { posts: 0, replies: 0 }, top_authors: {}, top_liked: [], top_viewed: [],
        posts: [], threads: [], collections: [], warning: 'No database or archive available',
      });
    }

    let posts;
    let topLiked;
    let topViewed;
    let latestRun = null;
    if (dataSource.mode === 'archive') {
      posts = dataSource.posts;
      topLiked = [...posts].sort((left, right) => (right.engagement?.likes || 0) - (left.engagement?.likes || 0)).slice(0, 50);
      topViewed = [...posts].sort((left, right) => (right.engagement?.views || 0) - (left.engagement?.views || 0)).slice(0, 50);
    } else {
      const postsCollection = dataSource.db.collection('posts');
      const metadataDb = getDb();
      const runsCollection = metadataDb?.collection('collection_runs');
      [posts, topLiked, topViewed, latestRun] = await Promise.all([
        postsCollection.find({}).toArray(),
        postsCollection.find({}).sort({ 'engagement.likes': -1 }).limit(50).toArray(),
        postsCollection.find({}).sort({ 'engagement.views': -1 }).limit(50).toArray(),
        runsCollection ? runsCollection.find({}).sort({ createdAt: -1, _id: -1 }).limit(1).next() : Promise.resolve(null),
      ]);
    }

    const normalizedPosts = posts.map(normalizePost);
    const stats = buildStatsFromPosts(normalizedPosts);
    return res.json({
      title: latestRun?.title || latestRun?.name || 'Heimdall',
      subtitle: latestRun?.subtitle || latestRun?.database || databaseName,
      total_posts: stats.total_posts,
      by_lang: stats.by_lang,
      by_platform: stats.by_platform,
      by_keyword: stats.by_keyword,
      hashtags: stats.hashtags,
      posts_vs_replies: stats.posts_vs_replies,
      top_authors: stats.top_authors,
      collection_stats: stats.collection_stats,
      engagement_avg: stats.engagement_avg,
      top_liked: topLiked.map(normalizePost),
      top_viewed: topViewed.map(normalizePost),
      posts: normalizedPosts,
      threads: buildThreads(normalizedPosts),
      collections: stats.collection_stats.map((item) => ({ id: item.collection_name.toLowerCase(), name: item.collection_name, count: item.count })),
    });
  }));

  app.get('/api/posts', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    const match = buildMatchFromQuery(req.query);
    if (dataSource.mode === 'none') return res.json([]);

    const { limit, skip, sort } = postsPage(req.query);

    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost)
        .filter((post) => matchesPostQuery(post, req.query))
        .sort((left, right) => sort.value(right) - sort.value(left))
        .slice(skip, skip + limit);
      return res.json(posts);
    }

    const posts = await dataSource.db.collection('posts')
      .find(Object.keys(match).length ? match : {})
      .sort({ [sort.field]: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .allowDiskUse(true)
      .toArray();
    return res.json(posts.map(normalizePost));
  }));

  app.get('/api/threads', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json([]);
    const postId = req.query.postId ? String(req.query.postId) : null;
    let posts;

    if (dataSource.mode === 'archive') {
      posts = dataSource.posts.map(normalizePost);
    } else {
      const postsCollection = dataSource.db.collection('posts');
      if (postId) {
        const selected = await postsCollection.findOne({ post_id: postId });
        if (!selected) return res.json([]);
        const chain = [selected];
        let current = selected;
        const visited = new Set();
        while (current.reply_to_id && !visited.has(String(current.reply_to_id))) {
          visited.add(String(current.reply_to_id));
          const parent = await postsCollection.findOne({ post_id: String(current.reply_to_id) });
          if (!parent) break;
          chain.unshift(parent);
          current = parent;
        }
        const ids = chain.map((post) => String(post.post_id));
        const descendants = await postsCollection.find({ $or: [{ post_id: { $in: ids } }, { reply_to_id: { $in: ids } }] }).limit(2000).toArray();
        posts = descendants.map(normalizePost);
      } else {
        const match = buildMatchFromQuery(req.query);
        const replies = await postsCollection.find({ ...match, reply_to_id: { $exists: true, $nin: [null, ''] } }).sort({ timestamp: 1 }).limit(5000).toArray();
        const parentIds = [...new Set(replies.map((post) => String(post.reply_to_id)))];
        const parents = parentIds.length ? await postsCollection.find({ post_id: { $in: parentIds } }).toArray() : [];
        posts = [...parents, ...replies].map(normalizePost);
      }
    }

    if (!postId) posts = posts.filter((post) => matchesPostQuery(post, req.query));
    return res.json(buildThreads(posts));
  }));

  app.get('/api/collection-runs', safeHandler(async (req, res) => {
    const database = getDb();
    if (!database) return res.json([]);
    const runs = await database.collection('collection_runs').find({}).sort({ createdAt: -1, _id: -1 }).limit(50).toArray();
    return res.json(runs);
  }));
}

module.exports = { postsPage, registerPostRoutes };