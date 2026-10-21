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
  buildMatchFromQuery,
  safeHandler,
  profiles,
}) {
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
      return res.json(await profiles.enrichPosts(posts));
    }

    const posts = await dataSource.db.collection('posts')
      .find(Object.keys(match).length ? match : {})
      .sort({ [sort.field]: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .allowDiskUse(true)
      .toArray();
    return res.json(await profiles.enrichPosts(posts.map(normalizePost)));
  }));

  app.get('/api/collection-runs', safeHandler(async (req, res) => {
    const database = getDb();
    if (!database) return res.json([]);
    const runs = await database.collection('collection_runs').find({}).sort({ createdAt: -1, _id: -1 }).limit(50).toArray();
    return res.json(runs);
  }));
}

module.exports = { postsPage, registerPostRoutes };