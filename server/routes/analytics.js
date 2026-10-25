const { matchesPostQuery, pickFilters: pickQueryFilters } = require('../services/query');
const {
  buildTimeline,
  createGraphBuilder,
  createTemporalGraphBuilder,
  matchSubgraphPost,
  timelineRowsFromPosts,
} = require('../services/analytics');
const { FACTS, factEntities } = require('../services/facts');
const { buildFactsGraph, buildFactsTemporalGraph, containsAny, withMatch } = require('../services/factsGraph');

const GRAPH_DEFAULT_NODES = 300;
// Aligné sur GRAPH_MAX_NODES du frontend (src/config.tsx).
const GRAPH_MAX_NODES = 20000;
const SUBGRAPH_MAX_NODES = GRAPH_MAX_NODES;
const SUBGRAPH_DEFAULT_POSTS = 5000;
const SUBGRAPH_MAX_POSTS = 20000;
// startTime / endTime : fenêtre de temps du graphe dynamique (export des posts d'un sous-graphe).
const FILTER_KEYS = ['collectionId', 'platform', 'lang', 'startDate', 'endDate', 'startTime', 'endTime'];
const PREPARING = 'Les données sont en cours de préparation sur le serveur. Réessayez dans quelques minutes.';

// Filtres reconnus d'une requête (clé de cache et requête post_facts).
const pickFilters = (source) => pickQueryFilters(source, FILTER_KEYS);

// Statistiques de la sélection, en une agrégation sur post_facts.
async function factsStats(facts, match) {
  const sum = (field) => ({ $sum: { $ifNull: [`$${field}`, 0] } });
  const pipeline = [];
  if (Object.keys(match).length) pipeline.push({ $match: match });
  pipeline.push({ $facet: {
    total: [{ $count: 'count' }],
    by_platform: [{ $group: { _id: '$platform', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
    by_lang: [{ $group: { _id: { $ifNull: ['$lang', 'unknown'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }],
    top_authors: [{ $group: { _id: { $ifNull: ['$author_handle', 'Auteur inconnu'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }],
    by_keyword: [{ $unwind: '$keywords' }, { $group: { _id: '$keywords', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }],
    hashtags: [{ $unwind: '$hashtags' }, { $group: { _id: '$hashtags', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }],
    collection_stats: [{ $group: {
      _id: '$collection_key',
      collection_name: { $min: '$collection_name' },
      event: { $max: '$event' },
      count: { $sum: 1 },
      reposts: sum('reposts'),
      quotes: sum('quotes'),
      links: { $sum: { $cond: ['$has_link', 1, 0] } },
      emojis: { $sum: '$emojis' },
    } }, { $sort: { count: -1, collection_name: 1 } }],
    by_type: [{ $group: {
      _id: null,
      replies: { $sum: { $cond: ['$is_reply', 1, 0] } },
      retweets: { $sum: { $cond: ['$is_retweet', 1, 0] } },
      quotes: { $sum: { $cond: ['$is_quote', 1, 0] } },
      original: { $sum: { $cond: [{ $or: ['$is_reply', '$is_retweet', '$is_quote'] }, 0, 1] } },
    } }],
    engagement_avg: [{ $group: { _id: null, likes: { $avg: '$likes' }, reposts: { $avg: '$reposts' }, replies: { $avg: '$replies' }, quotes: { $avg: '$quotes' }, views: { $avg: '$views' } } }],
    engagement_sum: [{ $group: { _id: null, likes: sum('likes'), reposts: sum('reposts'), replies: sum('replies'), quotes: sum('quotes'), views: sum('views') } }],
  } });

  const [doc = {}] = await facts.aggregate(pipeline, { allowDiskUse: true }).toArray();
  const toCounts = (rows) => (rows || []).reduce((result, item) => { result[item._id] = item.count; return result; }, {});
  const byType = (({ _id, ...counts }) => counts)(doc.by_type?.[0] || { original: 0, replies: 0, retweets: 0, quotes: 0 });
  const strip = (row) => { if (!row) return {}; const { _id, ...values } = row; return values; };
  return {
    total_posts: doc.total?.[0]?.count || 0,
    by_platform: toCounts(doc.by_platform),
    by_lang: toCounts(doc.by_lang),
    top_authors: (doc.top_authors || []).map((item) => ({ author: item._id, count: item.count })),
    by_keyword: toCounts(doc.by_keyword),
    hashtags: toCounts(doc.hashtags),
    collection_stats: (doc.collection_stats || []).map((item) => ({ collection_name: item.collection_name, event: item.event || '', count: item.count, reposts: item.reposts, quotes: item.quotes, emojis: item.emojis, links: item.links, link_rate: item.count ? (item.links / item.count) * 100 : 0 })),
    posts_vs_replies: { posts: (doc.total?.[0]?.count || 0) - (byType.replies || 0), replies: byType.replies || 0 },
    by_type: byType,
    engagement_avg: strip(doc.engagement_avg?.[0]),
    engagement_sum: strip(doc.engagement_sum?.[0]),
  };
}

// Courbe des posts : agrégation à la minute puis regroupement adaptatif dans buildTimeline.
async function factsTimeline(facts, match) {
  const rows = await facts.aggregate([
    { $match: withMatch(match, { date: { $ne: null } }) },
    { $group: { _id: { date: { $dateTrunc: { date: '$date', unit: 'minute' } }, platform: '$platform' }, count: { $sum: 1 } } },
  ], { allowDiskUse: true }).toArray();
  return buildTimeline(rows.map((row) => ({ date: row._id.date, platform: row._id.platform, count: row.count })));
}

function registerAnalyticsRoutes(app, {
  getDataSource,
  normalizePost,
  buildStatsFromPosts,
  buildFactsMatch,
  safeHandler,
  profiles,
  cache,
  facts: factsManager,
}) {
  // Source MongoDB : post_facts ; null (et réponse 503) tant que sa première construction n'est pas finie.
  const factsOf = (dataSource, res) => {
    if (factsManager.ready()) return dataSource.db.collection(FACTS);
    res.status(503).json({ error: PREPARING, preparing: true });
    return null;
  };

  const statsFor = (db, filters) => cache.get('stats', filters, () => factsStats(db.collection(FACTS), buildFactsMatch(filters)));
  const timelineFor = (db, filters) => cache.get('timeline', filters, () => factsTimeline(db.collection(FACTS), buildFactsMatch(filters)));
  const graphFor = (db, filters, { type, maxNodes, temporal, options }) => cache.get('graph', { ...filters, type, maxNodes, temporal, ...options }, () => (temporal
    ? buildFactsTemporalGraph(db.collection(FACTS), buildFactsMatch(filters), type, maxNodes, options)
    : buildFactsGraph(db.collection(FACTS), buildFactsMatch(filters), type, maxNodes, options)));

  app.get('/api/stats', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ total_posts: 0 });
    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query));
      return res.json(buildStatsFromPosts(posts));
    }
    if (!factsOf(dataSource, res)) return undefined;
    return res.json(await statsFor(dataSource.db, pickFilters(req.query)));
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
    let graph;
    if (dataSource.mode === 'archive') {
      const builder = temporal ? createTemporalGraphBuilder(type) : createGraphBuilder(type);
      dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query)).forEach(builder.add);
      graph = builder.result(maxNodes, options);
    } else {
      const facts = factsOf(dataSource, res);
      if (!facts) return undefined;
      graph = await graphFor(dataSource.db, pickFilters(req.query), { type, maxNodes, temporal, options });
    }
    // Comptes Bluesky : le nœud garde son DID comme identifiant, le libellé devient le pseudo.
    if (type === 'mentions') await profiles.labelGraphNodes(graph.nodes.filter((node) => node.id.startsWith('@did:')));
    return res.json(graph);
  }));

  app.get('/api/stats/timeline', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json(buildTimeline([]));
    if (dataSource.mode === 'archive') {
      const posts = dataSource.posts.map(normalizePost).filter((post) => matchesPostQuery(post, req.query));
      return res.json(buildTimeline(timelineRowsFromPosts(posts)));
    }
    if (!factsOf(dataSource, res)) return undefined;
    return res.json(await timelineFor(dataSource.db, pickFilters(req.query)));
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
    const filters = pickFilters(body);
    const selectedIds = new Set(nodes);

    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ type, posts: [], matched: 0, truncated: false });
    let posts = [];
    let matched = 0;
    if (dataSource.mode === 'archive') {
      dataSource.posts.filter((post) => matchesPostQuery(post, filters)).forEach((rawPost) => {
        const post = normalizePost(rawPost);
        const match = matchSubgraphPost(post, type, selectedIds);
        if (!match) return;
        matched += 1;
        if (posts.length >= limit) return;
        if (!includeRaw) delete post.raw_json;
        posts.push({ ...post, ...match });
      });
    } else {
      const facts = factsOf(dataSource, res);
      if (!facts) return undefined;
      // Les entrées post_facts portent les nœuds exacts du graphe : la sélection se lit sans relire le texte,
      // puis seuls les posts retenus sont chargés en entier.
      const kept = [];
      const cursor = facts.find(withMatch(buildFactsMatch(filters), containsAny(type, nodes)), { projection: { _id: 1, hashtags: 1, author_node: 1, mentions: 1 } });
      for await (const fact of cursor) {
        const { nodes: factNodes, edges } = factEntities(fact, type);
        const matchedNodes = factNodes.filter((id) => selectedIds.has(id));
        if (!matchedNodes.length) continue;
        matched += 1;
        if (kept.length >= limit) continue;
        const matchedEdges = edges
          .filter(([source, target]) => source !== target && selectedIds.has(source) && selectedIds.has(target))
          .map(([source, target]) => [source, target].sort().join('::'));
        kept.push({ _id: fact._id, subgraph_nodes: [...new Set(matchedNodes)], subgraph_edges: [...new Set(matchedEdges)] });
      }
      const byId = new Map();
      for (let index = 0; index < kept.length; index += 1000) {
        const ids = kept.slice(index, index + 1000).map((item) => item._id);
        (await dataSource.db.collection('posts').find({ _id: { $in: ids } }).toArray()).forEach((raw) => byId.set(String(raw._id), raw));
      }
      posts = kept.filter((item) => byId.has(String(item._id))).map((item) => {
        const post = normalizePost(byId.get(String(item._id)));
        if (!includeRaw) delete post.raw_json;
        return { ...post, subgraph_nodes: item.subgraph_nodes, subgraph_edges: item.subgraph_edges };
      });
    }
    await profiles.enrichPosts(posts);
    return res.json({ type, posts, matched, truncated: matched > posts.length });
  }));

  // Vues recalculées après chaque reconstruction de post_facts : Vue globale sans filtre, par plateforme
  // et pour chaque événement (eventFilters), puis le graphe affiché par défaut.
  return {
    warm: async (db, eventFilters = []) => {
      for (const filters of [{}, { platform: 'twitter' }, { platform: 'bluesky' }, ...eventFilters]) {
        await statsFor(db, filters);
        await timelineFor(db, filters);
      }
      await graphFor(db, {}, { type: 'hashtags', maxNodes: GRAPH_DEFAULT_NODES, temporal: false, options: { minEdgeWeight: 1, bucketMinutes: null, peaks: 0 } });
    },
  };
}

module.exports = { registerAnalyticsRoutes };
