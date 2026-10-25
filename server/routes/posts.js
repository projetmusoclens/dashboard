const { matchesPostQuery } = require('../services/query');
const { FACTS, FACT_SORT_FIELDS } = require('../services/facts');

const POSTS_DEFAULT_LIMIT = 200;
const POSTS_MAX_LIMIT = 1000;
const SEARCH_INDEX_MS = 1500;
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
  buildFactsMatch,
  safeHandler,
  profiles,
  facts,
}) {
  app.get('/api/posts', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json([]);

    const { limit, skip, sort } = postsPage(req.query);

    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost)
        .filter((post) => matchesPostQuery(post, req.query))
        .sort((left, right) => sort.value(right) - sort.value(left))
        .slice(skip, skip + limit);
      return res.json(await profiles.enrichPosts(posts));
    }

    if (!facts.ready()) return res.status(503).json({ error: 'Les données sont en cours de préparation sur le serveur. Réessayez dans quelques minutes.', preparing: true });
    // Tri et pagination sur post_facts (index plateforme + tri + _id), puis lecture des seuls posts affichés.
    const field = FACT_SORT_FIELDS[req.query.sort] || FACT_SORT_FIELDS.likes;
    const pageQuery = () => dataSource.db.collection(FACTS)
      .find(buildFactsMatch(req.query), { projection: { _id: 1 } })
      .sort({ [field]: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .allowDiskUse(true);
    let page;
    if (!req.query.q) page = await pageQuery().toArray();
    else {
      // Recherche de texte : l'index de tri trouve vite un mot fréquent, mais parcourt tout le corpus dans
      // le désordre pour un mot rare. Au-delà de SEARCH_INDEX_MS, lecture séquentielle puis tri des seuls résultats.
      try {
        page = await pageQuery().maxTimeMS(SEARCH_INDEX_MS).toArray();
      } catch (error) {
        if (error?.code !== 50) throw error;
        page = await pageQuery().hint({ $natural: 1 }).toArray();
      }
    }
    const ids = page.map((item) => item._id);
    const byId = new Map((await dataSource.db.collection('posts').find({ _id: { $in: ids } }).toArray()).map((post) => [String(post._id), post]));
    const posts = ids.map((id) => byId.get(String(id))).filter(Boolean);
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