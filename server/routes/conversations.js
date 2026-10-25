const { matchesPostQuery, pickFilters } = require('../services/query');
const { lightPost, missingRoot, selectConversations, summarizeConversations } = require('../services/conversations');
const {
  CSV_BOM, CSV_HEADERS, buildTree, csvLine, descendants, postUrl, selectDisplayed, slimRaw, treeStats,
} = require('../services/conversationTree');
const { FACTS } = require('../services/facts');
const { createResponseCache } = require('../services/responseCache');

const MAX_ANCESTOR_LEVELS = 20;
// Posts affichés à l'ouverture d'une conversation (ou d'une branche) ; l'export n'a pas de limite.
const MAX_CONVERSATION_POSTS = 5000;
const PAGE_MAX = 100;
const FILTER_KEYS = ['collectionId', 'platform', 'lang', 'startDate', 'endDate', 'q'];

const FACT_FIELDS = { _id: 0, post_id: 1, reply_to_id: 1, author_handle: 1, timestamp: 1, platform: 1, likes: 1 };
// Les listes d'identifiants sont envoyées par lots : une seule requête dépasserait 16 Mo sur un gros corpus.
const ID_BATCH = 20000;
const lightFact = (fact) => lightPost({ ...fact, engagement: { likes: fact.likes } });

function registerConversationRoutes(app, { getDataSource, normalizePost, buildFactsMatch, safeHandler, profiles, cache, facts }) {
  // Posts connus = réponses correspondant aux filtres + tous leurs ancêtres présents en base (lus dans post_facts).
  async function knownPostsFromMongo(db, filters) {
    const collection = db.collection(FACTS);
    const match = buildFactsMatch(filters);
    const query = Object.keys(match).length ? { $and: [match, { is_reply: true }] } : { is_reply: true };
    const known = new Map();
    for await (const fact of collection.find(query, { projection: FACT_FIELDS })) known.set(String(fact.post_id), lightFact(fact));
    const attempted = new Set();
    for (let level = 0; level < MAX_ANCESTOR_LEVELS; level += 1) {
      const frontier = [...new Set(Array.from(known.values()).map((post) => post.reply_to_id).filter((id) => id && !known.has(id) && !attempted.has(id)))];
      if (!frontier.length) break;
      frontier.forEach((id) => attempted.add(id));
      for (let index = 0; index < frontier.length; index += ID_BATCH) {
        for await (const fact of collection.find({ post_id: { $in: frontier.slice(index, index + ID_BATCH) } }, { projection: FACT_FIELDS })) {
          known.set(String(fact.post_id), lightFact(fact));
        }
      }
    }
    return known;
  }

  const summariesFor = (db, filters) => cache.get('conversations', filters, async () => summarizeConversations(await knownPostsFromMongo(db, filters)));

  function knownPostsFromArchive(allPosts, filters) {
    const byId = new Map(allPosts.map((post) => [String(post.post_id), post]));
    const known = new Map();
    allPosts.filter((post) => post.reply_to_id && matchesPostQuery(post, filters)).forEach((post) => {
      let current = post;
      const seen = new Set();
      while (current && !seen.has(current.post_id)) {
        seen.add(current.post_id);
        known.set(String(current.post_id), lightPost(current));
        current = current.reply_to_id ? byId.get(String(current.reply_to_id)) : null;
      }
    });
    return known;
  }

  async function findPost(dataSource, id) {
    if (dataSource.mode === 'archive') return dataSource.posts.find((post) => String(post.post_id) === id) || null;
    const post = await dataSource.db.collection('posts').findOne({ post_id: id });
    return post ? normalizePost(post) : null;
  }

  async function findChildren(dataSource, parentIds) {
    if (dataSource.mode === 'archive') {
      const parents = new Set(parentIds);
      return dataSource.posts.filter((post) => post.reply_to_id && parents.has(String(post.reply_to_id)));
    }
    const children = await dataSource.db.collection('posts').find({ reply_to_id: { $in: parentIds } }).toArray();
    return children.map(normalizePost);
  }

  async function hydrate(dataSource, items) {
    return Promise.all(items.map(async (item) => {
      if (!item.root_missing) {
        const root = await findPost(dataSource, item.root_id);
        if (root) return { ...item, root };
      }
      // Une seule réponse suffit pour décrire le post d'origine manquant (auteur, lien).
      const child = dataSource.mode === 'archive'
        ? (await findChildren(dataSource, [item.root_id]))[0]
        : await dataSource.db.collection('posts').findOne({ reply_to_id: item.root_id }, { projection: { 'raw_json.tweet.inReplyToUsername': 1 } });
      return { ...item, root_missing: true, root: missingRoot(item.root_id, child) };
    }));
  }

  app.get('/api/conversations', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ total: 0, stats: { conversations: 0, replies: 0, collected_roots: 0 }, items: [] });
    const filters = pickFilters(req.query, FILTER_KEYS);
    if (dataSource.mode !== 'archive' && !facts.ready()) {
      return res.status(503).json({ error: 'Les données sont en cours de préparation sur le serveur. Réessayez dans quelques minutes.', preparing: true });
    }
    const summaries = await (dataSource.mode === 'archive'
      ? summarizeConversations(knownPostsFromArchive(dataSource.posts, filters))
      : summariesFor(dataSource.db, filters));
    const page = selectConversations(summaries, {
      sort: String(req.query.sort || 'replies'),
      minReplies: Math.max(Number(req.query.minReplies) || 1, 1),
      root: ['collected', 'missing'].includes(req.query.root) ? req.query.root : '',
      limit: Math.min(Math.max(Number(req.query.limit) || 20, 1), PAGE_MAX),
      skip: Math.max(Number(req.query.skip) || 0, 0),
    });
    const items = await hydrate(dataSource, page.items);
    await profiles.enrichPosts(items.map((item) => (item.root_missing ? null : item.root)));
    return res.json({ ...page, items });
  }));

  // Arbres des dernières conversations ouvertes (une grande conversation peut compter des dizaines de
  // milliers de réponses) : cache séparé et petit, vidé avec le cache principal.
  const trees = createResponseCache({ maxEntries: 12 });
  cache.onClear(() => trees.clear());

  // Accès à l'arbre d'une conversation : post_facts (MongoDB) ou posts en mémoire (archive).
  const LIGHT = { _id: 1, post_id: 1, reply_to_id: 1, author_handle: 1, date: 1, likes: 1 };
  function treeSource(dataSource) {
    if (dataSource.mode === 'archive') {
      const light = (post) => ({ _id: post.post_id, post_id: String(post.post_id), reply_to_id: post.reply_to_id ? String(post.reply_to_id) : null, author_handle: post.author_handle, date: post.timestamp || null, likes: post.engagement?.likes || 0 });
      const byId = new Map(dataSource.posts.map((post) => [String(post.post_id), post]));
      return {
        findLight: async (id) => (byId.has(id) ? light(byId.get(id)) : null),
        childrenOf: async (ids) => {
          const parents = new Set(ids);
          return dataSource.posts.filter((post) => post.reply_to_id && parents.has(String(post.reply_to_id))).map(light);
        },
        loadPosts: async (lights) => lights.map((item) => byId.get(item.post_id)).filter(Boolean),
      };
    }
    const facts = dataSource.db.collection(FACTS);
    return {
      findLight: (id) => facts.findOne({ post_id: id }, { projection: LIGHT }),
      childrenOf: async (ids) => {
        const found = [];
        for (let index = 0; index < ids.length; index += ID_BATCH) {
          found.push(...await facts.find({ reply_to_id: { $in: ids.slice(index, index + ID_BATCH) } }, { projection: LIGHT }).toArray());
        }
        return found;
      },
      // Posts complets par lots, dans l'ordre demandé.
      loadPosts: async (lights) => {
        const byId = new Map();
        for (let index = 0; index < lights.length; index += 1000) {
          const ids = lights.slice(index, index + 1000).map((item) => item._id);
          (await dataSource.db.collection('posts').find({ _id: { $in: ids } }).toArray()).forEach((post) => byId.set(String(post._id), normalizePost(post)));
        }
        return lights.map((item) => byId.get(String(item._id))).filter(Boolean);
      },
    };
  }

  // Racine d'un post : on remonte les réponses jusqu'au plus haut ancêtre collecté, ou jusqu'au parent manquant.
  async function rootOf(source, postId) {
    let current = await source.findLight(postId);
    if (!current) return null;
    let rootId = current.post_id;
    const seen = new Set();
    while (current?.reply_to_id && !seen.has(current.post_id)) {
      seen.add(current.post_id);
      rootId = String(current.reply_to_id);
      current = await source.findLight(rootId);
    }
    return rootId;
  }

  async function conversationRequest(req, res) {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') { res.status(404).json({ error: 'Aucune donnée' }); return null; }
    if (dataSource.mode !== 'archive' && !facts.ready()) {
      res.status(503).json({ error: 'Les données sont en cours de préparation sur le serveur. Réessayez dans quelques minutes.', preparing: true });
      return null;
    }
    const postId = req.query.postId ? String(req.query.postId) : null;
    const source = treeSource(dataSource);
    const rootId = req.query.rootId ? String(req.query.rootId) : postId ? await rootOf(source, postId) : null;
    if (!rootId) { res.status(postId ? 404 : 400).json({ error: postId ? 'Post introuvable' : 'rootId ou postId requis' }); return null; }
    const tree = await trees.get('tree', { mode: dataSource.mode, rootId }, () => buildTree(rootId, source.childrenOf));
    return { dataSource, source, tree, rootId, postId };
  }

  // Une conversation, depuis sa racine (rootId) ou depuis n'importe lequel de ses posts (postId).
  // Les posts affichés sont limités à MAX_CONVERSATION_POSTS (premiers niveaux + chemin vers postId) ;
  // pending signale les réponses non chargées, que branch=<post_id> charge ensuite pour une branche.
  app.get('/api/conversation', safeHandler(async (req, res) => {
    const context = await conversationRequest(req, res);
    if (!context) return undefined;
    const { dataSource, source, tree, rootId, postId } = context;
    const branch = req.query.branch ? String(req.query.branch) : null;
    if (branch && !tree.nodes.has(branch) && branch !== rootId) return res.status(404).json({ error: 'Branche introuvable' });
    const startId = branch || rootId;
    const selection = selectDisplayed(tree, startId, { limit: MAX_CONVERSATION_POSTS, highlight: branch ? null : postId });
    const posts = (await source.loadPosts(selection.ids.map((id) => tree.nodes.get(id)))).map((post) => ({ ...post, raw_json: slimRaw(post.raw_json) }));
    await profiles.enrichPosts(posts);
    if (branch) return res.json({ root_id: rootId, branch, posts, pending: selection.pending, truncated: selection.ids.length < selection.total });

    const rootLight = await source.findLight(rootId);
    const [root] = rootLight ? await source.loadPosts([rootLight]) : [];
    if (root) { root.raw_json = slimRaw(root.raw_json); await profiles.enrichPosts([root]); }
    let missing = null;
    if (!root) {
      const child = dataSource.mode === 'archive'
        ? dataSource.posts.find((post) => String(post.reply_to_id) === rootId)
        : await dataSource.db.collection('posts').findOne({ reply_to_id: rootId }, { projection: { 'raw_json.tweet.inReplyToUsername': 1 } });
      missing = missingRoot(rootId, child);
    }
    return res.json({
      root_id: rootId,
      root_missing: !root,
      root: root || missing,
      posts,
      pending: selection.pending,
      truncated: selection.ids.length < selection.total,
      total_posts: selection.total,
      tree_complete: tree.complete,
      stats: treeStats(tree, rootLight),
      highlight: postId,
    });
  }));

  // Export de la conversation entière (sans limite d'affichage), en CSV ou en JSON, envoyé par lots.
  app.get('/api/conversation/export', safeHandler(async (req, res) => {
    const context = await conversationRequest(req, res);
    if (!context) return undefined;
    const { source, tree, rootId } = context;
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const includeRaw = req.query.includeRaw === '1' || req.query.includeRaw === 'true';
    const order = descendants(tree, rootId).map((id) => tree.nodes.get(id));
    const rootLight = await source.findLight(rootId);
    const [root] = rootLight ? await source.loadPosts([rootLight]) : [];
    const name = `conversation_${String(root?.author_handle || rootId).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    const clean = (post) => (includeRaw ? post : { ...post, raw_json: undefined });
    const row = (post, depth) => csvLine([post.post_id, post.reply_to_id, depth, post.platform, post.author_handle, post.timestamp, post.text, post.engagement?.likes, post.engagement?.reposts, post.engagement?.replies, post.engagement?.views, postUrl(post)]);
    if (format === 'csv') {
      res.write(CSV_BOM + csvLine(CSV_HEADERS));
      res.write(root ? row(root, 0) : csvLine([rootId, '', 0, '', '', '', '(post non collecté)', '', '', '', '', '']));
    } else {
      res.write(`{"root_id":${JSON.stringify(rootId)},"root_missing":${!root},"root":${JSON.stringify(root ? clean(root) : null)},"tree_complete":${tree.complete},"total_posts":${order.length},"posts":[`);
    }
    for (let index = 0; index < order.length; index += 1000) {
      const batch = order.slice(index, index + 1000);
      const depthOf = new Map(batch.map((node) => [node.post_id, node.depth]));
      const posts = await source.loadPosts(batch);
      res.write(format === 'csv'
        ? posts.map((post) => row(post, depthOf.get(post.post_id))).join('')
        : posts.map((post, position) => `${index + position ? ',' : ''}${JSON.stringify({ ...clean(post), depth: depthOf.get(post.post_id) })}`).join(''));
    }
    res.end(format === 'csv' ? '' : ']}');
    return undefined;
  }));

  // Première page de Threads sans filtre, recalculée après chaque reconstruction de post_facts.
  return { warm: (db) => summariesFor(db, {}) };
}

module.exports = { registerConversationRoutes };
