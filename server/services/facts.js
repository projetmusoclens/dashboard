const { collectionKey, eventName, normalizeCollectionName } = require('./collections');
const { normalizePost } = require('./normalization');
const { blueskyMentionDids, extractHashtags, extractMentions } = require('./analytics');

// Collection allégée « post_facts » : une entrée par post avec seulement ce que les statistiques,
// la courbe, les graphes, les listes et les conversations utilisent (pas de raw_json). Elle tient
// en mémoire même avec plusieurs millions de posts, et ses champs sont indexables tels quels.
// Elle est reconstruite à partir de « posts » quand ceux-ci changent (import) ou quand FACTS_VERSION change.

const FACTS_VERSION = 1;
const FACTS = 'post_facts';
const FACTS_BUILD = 'post_facts_build';
const FACTS_META = 'facts_meta';
const EMOJI_PATTERN = /[☀-➿]/g;

// Tri de l'Explorer : champ de post_facts correspondant à chaque tri de /api/posts.
const FACT_SORT_FIELDS = { likes: 'likes', views: 'views', reposts: 'reposts', replies: 'replies', date: 'date' };

// Tris de l'Explorer : plateforme, champ trié, _id (départage stable), puis la collecte, qui permet
// de filtrer par événement dans l'index lui-même, sans lire les entrées.
const FACT_INDEXES = [
  { key: { post_id: 1 }, name: 'post_id' },
  { key: { collection_key: 1, date: 1 }, name: 'collection_date' },
  { key: { date: 1 }, name: 'date' },
  { key: { reply_to_id: 1 }, name: 'reply_to_id' },
  { key: { hashtags: 1 }, name: 'hashtags' },
  { key: { mentions: 1 }, name: 'mentions' },
  ...Object.values(FACT_SORT_FIELDS).map((field) => ({ key: { platform: 1, [field]: -1, _id: -1, collection_key: 1 }, name: `sort_${field}` })),
];

// Index de post_facts alignés sur FACT_INDEXES : les manquants sont créés, les anciens supprimés.
// Changer un index ne demande donc pas de reconstruire la collection.
async function ensureFactIndexes(db, { log = console.log } = {}) {
  const collection = db.collection(FACTS);
  const existing = await collection.indexes().catch(() => []);
  const wanted = new Map(FACT_INDEXES.map((index) => [index.name, JSON.stringify(index.key)]));
  for (const index of existing) {
    if (index.name !== '_id_' && wanted.get(index.name) !== JSON.stringify(index.key)) {
      await collection.dropIndex(index.name);
      log(`post_facts : index ${index.name} supprimé.`);
    }
  }
  const present = new Set(existing.filter((index) => wanted.get(index.name) === JSON.stringify(index.key)).map((index) => index.name));
  for (const index of FACT_INDEXES) {
    if (present.has(index.name)) continue;
    await collection.createIndex(index.key, { name: index.name });
    log(`post_facts : index ${index.name} créé.`);
  }
}

const numberOrNull = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));

// Entrée post_facts d'un post brut. Mêmes règles que normalizePost et graphEntities.
function factOf(raw) {
  const post = normalizePost(raw);
  const time = new Date(post.timestamp || post.createdAt || post.collected_at || NaN);
  const mentions = post.platform === 'bluesky' ? blueskyMentionDids(post) : extractMentions(post.text);
  return {
    _id: raw._id,
    post_id: post.post_id,
    platform: post.platform,
    collection_key: collectionKey(post.collection_name),
    collection_name: normalizeCollectionName(post.collection_name),
    event: eventName(post.collection_context?.event),
    started_at: post.collection_context?.started_at || null,
    date: Number.isFinite(time.getTime()) ? time : null,
    timestamp: post.timestamp || null,
    lang: post.lang,
    author_handle: post.author_handle,
    author_node: post.author_handle ? `@${String(post.author_handle).toLowerCase()}` : '@Auteur inconnu',
    text: post.text,
    keywords: post.matched_keywords,
    hashtags: extractHashtags(post.text),
    mentions,
    emojis: (post.text.match(EMOJI_PATTERN) || []).length,
    has_link: post.has_link,
    is_reply: post.is_reply,
    is_retweet: post.is_retweet,
    is_quote: post.is_quote,
    reply_to_id: post.reply_to_id,
    likes: numberOrNull(post.engagement.likes),
    reposts: numberOrNull(post.engagement.reposts),
    replies: numberOrNull(post.engagement.replies),
    quotes: numberOrNull(post.engagement.quotes),
    views: numberOrNull(post.engagement.views),
  };
}

// Nœuds et arêtes d'une entrée post_facts : identiques à graphEntities sur le post d'origine.
function factEntities(fact, type) {
  if (type === 'mentions') {
    const mentions = fact.mentions || [];
    if (!mentions.length) return { nodes: [], edges: [] };
    return { nodes: [fact.author_node, ...mentions], edges: mentions.map((mention) => [fact.author_node, mention]) };
  }
  const hashtags = fact.hashtags || [];
  const edges = [];
  for (let index = 0; index < hashtags.length; index += 1) {
    for (let next = index + 1; next < hashtags.length; next += 1) edges.push([hashtags[index], hashtags[next]]);
  }
  return { nodes: hashtags, edges };
}

// État de post_facts : à jour si même version et même nombre d'entrées que de posts.
async function factsStatus(db) {
  const [meta, posts, facts] = await Promise.all([
    db.collection(FACTS_META).findOne({ _id: 'post_facts' }),
    db.collection('posts').estimatedDocumentCount(),
    db.collection(FACTS).estimatedDocumentCount().catch(() => 0),
  ]);
  const exists = facts > 0;
  const fresh = Boolean(meta && meta.version === FACTS_VERSION && meta.posts === posts && facts === posts);
  return { exists, fresh, posts, facts, meta };
}

// Reconstruction complète dans une collection temporaire, puis remplacement d'un coup :
// l'ancienne version reste servie pendant le calcul.
async function rebuildFacts(db, { batchSize = 5000, log = console.log } = {}) {
  const started = Date.now();
  const build = db.collection(FACTS_BUILD);
  await build.drop().catch(() => {});
  const total = await db.collection('posts').estimatedDocumentCount();
  const cursor = db.collection('posts').find({}, { batchSize: 2000 });
  let batch = [];
  let done = 0;
  let nextLog = 250000;
  const flush = async () => {
    if (!batch.length) return;
    await build.insertMany(batch, { ordered: false });
    done += batch.length;
    batch = [];
    if (done >= nextLog) {
      log(`post_facts : ${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} posts`);
      nextLog += 250000;
    }
  };
  for await (const raw of cursor) {
    batch.push(factOf(raw));
    if (batch.length >= batchSize) await flush();
  }
  await flush();
  for (const index of FACT_INDEXES) await build.createIndex(index.key, { name: index.name });
  await build.rename(FACTS, { dropTarget: true });
  await db.collection(FACTS_META).updateOne(
    { _id: 'post_facts' },
    { $set: { version: FACTS_VERSION, posts: done, built_at: new Date(), seconds: Math.round((Date.now() - started) / 1000) } },
    { upsert: true },
  );
  log(`post_facts reconstruit : ${done.toLocaleString('fr-FR')} posts en ${Math.round((Date.now() - started) / 1000)} s.`);
  return done;
}

module.exports = {
  FACTS,
  FACTS_VERSION,
  FACT_INDEXES,
  FACT_SORT_FIELDS,
  ensureFactIndexes,
  factEntities,
  factOf,
  factsStatus,
  rebuildFacts,
};
