const { matchesPostQuery } = require('../services/query');
const {
  LIGHT_FIELDS, lightPost, missingRoot, selectConversations, summarizeConversations,
} = require('../services/conversations');

const MAX_ANCESTOR_LEVELS = 20;
const MAX_CONVERSATION_POSTS = 3000;
const PAGE_MAX = 100;
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_SIZE = 8;
const FILTER_KEYS = ['collectionId', 'platform', 'lang', 'startDate', 'endDate', 'q'];

const lightProjection = Object.fromEntries(LIGHT_FIELDS.map((field) => [field, 1]));

// Résumés mis en cache par jeu de filtres : changer de page ou de tri ne recalcule rien.
const cache = new Map();
function cached(key, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = compute().then((result) => {
    cache.set(key, { at: Date.now(), value: Promise.resolve(result) });
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return result;
  });
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

function registerConversationRoutes(app, { getDataSource, normalizePost, buildMatchFromQuery, safeHandler }) {
  // Posts connus = réponses correspondant aux filtres + tous leurs ancêtres présents en base.
  async function knownPostsFromMongo(db, filters) {
    const posts = db.collection('posts');
    const match = buildMatchFromQuery(filters);
    const replyCondition = { reply_to_id: { $nin: [null, ''] } };
    const query = Object.keys(match).length ? { $and: [match, replyCondition] } : replyCondition;
    const known = new Map();
    (await posts.find(query, { projection: lightProjection }).toArray()).forEach((post) => known.set(String(post.post_id), lightPost(post)));
    const attempted = new Set();
    for (let level = 0; level < MAX_ANCESTOR_LEVELS; level += 1) {
      const frontier = [...new Set(Array.from(known.values()).map((post) => post.reply_to_id).filter((id) => id && !known.has(id) && !attempted.has(id)))];
      if (!frontier.length) break;
      frontier.forEach((id) => attempted.add(id));
      (await posts.find({ post_id: { $in: frontier } }, { projection: lightProjection }).toArray())
        .forEach((post) => known.set(String(post.post_id), lightPost(post)));
    }
    return known;
  }

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
      const [child] = await findChildren(dataSource, [item.root_id]);
      return { ...item, root_missing: true, root: missingRoot(item.root_id, child) };
    }));
  }

  app.get('/api/conversations', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ total: 0, stats: { conversations: 0, replies: 0, collected_roots: 0 }, items: [] });
    const filters = Object.fromEntries(FILTER_KEYS.filter((key) => typeof req.query[key] === 'string' && req.query[key]).map((key) => [key, req.query[key]]));
    const key = `${dataSource.mode}|${JSON.stringify(filters)}`;
    const summaries = await cached(key, async () => summarizeConversations(dataSource.mode === 'archive'
      ? knownPostsFromArchive(dataSource.posts, filters)
      : await knownPostsFromMongo(dataSource.db, filters)));
    const page = selectConversations(summaries, {
      sort: String(req.query.sort || 'replies'),
      minReplies: Math.max(Number(req.query.minReplies) || 1, 1),
      root: ['collected', 'missing'].includes(req.query.root) ? req.query.root : '',
      limit: Math.min(Math.max(Number(req.query.limit) || 20, 1), PAGE_MAX),
      skip: Math.max(Number(req.query.skip) || 0, 0),
    });
    return res.json({ ...page, items: await hydrate(dataSource, page.items) });
  }));

  // Une conversation complète, depuis sa racine (rootId) ou depuis n'importe lequel de ses posts (postId).
  app.get('/api/conversation', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.status(404).json({ error: 'Aucune donnée' });
    const postId = req.query.postId ? String(req.query.postId) : null;
    let rootId = req.query.rootId ? String(req.query.rootId) : null;
    if (!rootId && !postId) return res.status(400).json({ error: 'rootId ou postId requis' });

    if (!rootId) {
      let current = await findPost(dataSource, postId);
      if (!current) return res.status(404).json({ error: 'Post introuvable' });
      const seen = new Set();
      rootId = current.post_id;
      while (current?.reply_to_id && !seen.has(current.post_id)) {
        seen.add(current.post_id);
        rootId = String(current.reply_to_id);
        current = await findPost(dataSource, rootId);
        if (current) rootId = current.post_id;
      }
    }

    const root = await findPost(dataSource, rootId);
    const posts = [];
    const seen = new Set([rootId]);
    let frontier = [rootId];
    let truncated = false;
    while (frontier.length && !truncated) {
      const children = (await findChildren(dataSource, frontier)).filter((post) => !seen.has(post.post_id));
      children.forEach((post) => seen.add(post.post_id));
      if (posts.length + children.length > MAX_CONVERSATION_POSTS) {
        truncated = true;
        posts.push(...children.slice(0, MAX_CONVERSATION_POSTS - posts.length));
      } else posts.push(...children);
      frontier = children.map((post) => post.post_id);
    }
    return res.json({
      root_id: rootId,
      root_missing: !root,
      root: root || missingRoot(rootId, posts.find((post) => post.reply_to_id === rootId)),
      posts,
      truncated,
      highlight: postId,
    });
  }));
}

module.exports = { registerConversationRoutes };
