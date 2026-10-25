// Conversation complète sous forme d'arbre léger (identifiants, auteur, date, likes), puis :
// - sélection affichée : les premiers niveaux, dans la limite d'un nombre de posts, plus le chemin
//   vers le post mis en évidence ; les branches non chargées sont signalées (pending) ;
// - résumé (réponses, participants, profondeur, durée) calculé sur toute la conversation ;
// - post allégé pour l'affichage (raw_json réduit aux champs lus par le lecteur).

// Date en millisecondes (Date de post_facts ou texte ISO) ; sans date : en dernier.
const timeOf = (value) => { const time = value ? new Date(value).getTime() : NaN; return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER; };

// Parcours en largeur depuis la racine. childrenOf(ids) renvoie les réponses directes de ces posts
// ({ _id, post_id, reply_to_id, author_handle, date, likes }). maxNodes protège la mémoire.
async function buildTree(rootId, childrenOf, { maxNodes = 300000 } = {}) {
  const nodes = new Map();
  const children = new Map();
  const seen = new Set([rootId]);
  let frontier = [rootId];
  let depth = 0;
  let complete = true;
  while (frontier.length) {
    depth += 1;
    const found = (await childrenOf(frontier))
      .filter((item) => !seen.has(item.post_id))
      .sort((left, right) => timeOf(left.date) - timeOf(right.date) || String(left.post_id).localeCompare(String(right.post_id)));
    const next = [];
    for (const item of found) {
      if (seen.has(item.post_id)) continue;
      if (nodes.size >= maxNodes) { complete = false; break; }
      seen.add(item.post_id);
      nodes.set(item.post_id, { ...item, depth });
      if (!children.has(item.reply_to_id)) children.set(item.reply_to_id, []);
      children.get(item.reply_to_id).push(item.post_id);
      next.push(item.post_id);
    }
    if (!complete) break;
    frontier = next;
  }
  return { rootId, nodes, children, complete };
}

// Descendants d'un post, dans l'ordre de l'arbre (niveau par niveau).
function descendants(tree, startId) {
  const result = [];
  let frontier = [startId];
  while (frontier.length) {
    const next = [];
    frontier.forEach((id) => (tree.children.get(id) || []).forEach((childId) => { result.push(childId); next.push(childId); }));
    frontier = next;
  }
  return result;
}

// Posts à afficher sous startId : les limit premiers descendants, plus le chemin vers highlight.
// pending : pour chaque post affiché (et startId), nombre de réponses directes non chargées.
function selectDisplayed(tree, startId, { limit, highlight = null } = {}) {
  const all = descendants(tree, startId);
  const shown = new Set(all.slice(0, limit));
  let current = highlight && tree.nodes.get(highlight);
  while (current && current.post_id !== startId) {
    shown.add(current.post_id);
    current = tree.nodes.get(current.reply_to_id);
  }
  const pending = {};
  [startId, ...shown].forEach((id) => {
    const missing = (tree.children.get(id) || []).filter((childId) => !shown.has(childId)).length;
    if (missing) pending[id] = missing;
  });
  return { ids: all.filter((id) => shown.has(id)), pending, total: all.length };
}

// Résumé de toute la conversation ; root : entrée légère du post d'origine s'il a été collecté.
function treeStats(tree, root) {
  const participants = new Set(root?.author_handle ? [root.author_handle] : []);
  let depth = 0;
  let first = null;
  let last = null;
  tree.nodes.forEach((node) => {
    if (node.author_handle) participants.add(node.author_handle);
    if (node.depth > depth) depth = node.depth;
    const time = node.date ? new Date(node.date).getTime() : NaN;
    if (Number.isFinite(time)) {
      if (first === null || time < first) first = time;
      if (last === null || time > last) last = time;
    }
  });
  return {
    replies: tree.nodes.size,
    participants: participants.size,
    depth,
    first_at: first === null ? null : new Date(first).toISOString(),
    last_at: last === null ? null : new Date(last).toISOString(),
  };
}

const pick = (source, keys) => {
  if (!source || typeof source !== 'object') return undefined;
  const result = {};
  keys.forEach((key) => { if (source[key] !== undefined && source[key] !== null) result[key] = source[key]; });
  return result;
};

// raw_json réduit à ce que lit le lecteur (src/utils/postRecord.ts) : auteur, médias, citation, entités, compteurs.
// Divise par cinq environ le poids d'une conversation affichée.
function slimRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tweet = raw.tweet && typeof raw.tweet === 'object' ? raw.tweet : raw.type === 'tweet' ? raw : null;
  if (tweet) {
    return {
      tweet: {
        type: 'tweet',
        ...pick(tweet, ['text', 'createdAt', 'lang', 'source', 'url', 'twitterUrl', 'inReplyToId', 'inReplyToUsername', 'conversationId', 'replyCount', 'retweetCount', 'quoteCount', 'likeCount', 'viewCount', 'bookmarkCount']),
        author: pick(tweet.author, ['id', 'name', 'userName', 'profilePicture', 'isVerified', 'isBlueVerified']),
        entities: tweet.entities ? {
          hashtags: (tweet.entities.hashtags || []).map((item) => pick(item, ['text'])),
          user_mentions: (tweet.entities.user_mentions || []).map((item) => pick(item, ['screen_name', 'name'])),
          urls: (tweet.entities.urls || []).map((item) => pick(item, ['expanded_url', 'url'])),
        } : undefined,
        extendedEntities: tweet.extendedEntities ? {
          media: (tweet.extendedEntities.media || []).map((media) => ({
            ...pick(media, ['type', 'media_url_https']),
            ...(media.video_info ? { video_info: { variants: (media.video_info.variants || []).filter((variant) => variant.content_type === 'video/mp4').map((variant) => pick(variant, ['content_type', 'url', 'bitrate'])) } } : {}),
          })),
        } : undefined,
        retweeted_tweet: tweet.retweeted_tweet ? pick(tweet.retweeted_tweet, ['url']) : undefined,
        quoted_tweet: tweet.quoted_tweet ? { ...pick(tweet.quoted_tweet, ['text', 'url', 'twitterUrl']), author: pick(tweet.quoted_tweet.author, ['name', 'userName']) } : undefined,
      },
    };
  }
  const record = raw.record && typeof raw.record === 'object' ? raw.record : raw;
  return {
    ...pick(raw, ['repo', '$type']),
    record: {
      ...pick(record, ['$type', 'text', 'createdAt', 'langs', 'embed', 'facets']),
      ...(record.reply?.root?.uri ? { reply: { root: { uri: record.reply.root.uri } } } : {}),
      ...(record.subject?.uri ? { subject: { uri: record.subject.uri } } : {}),
    },
  };
}

// Lien vers l'original, pour l'export (même règle que le lecteur, sans le pseudo Bluesky résolu).
function postUrl(post) {
  const tweet = post.raw_json?.tweet;
  if (post.platform === 'bluesky' || String(post.post_id).startsWith('at://')) {
    const [, , repo, collection, rkey] = String(post.post_id).split('/');
    return collection === 'app.bsky.feed.post' && rkey ? `https://bsky.app/profile/${repo}/post/${rkey}` : '';
  }
  return tweet?.url || tweet?.twitterUrl || (post.author_handle && post.post_id ? `https://x.com/${post.author_handle}/status/${post.post_id}` : '');
}

const CSV_HEADERS = ['post_id', 'reply_to_id', 'depth', 'platform', 'author_handle', 'timestamp', 'text', 'likes', 'reposts', 'replies', 'views', 'url'];
// Même format que les exports du navigateur (src/utils/download.ts) : cellules entre guillemets, lignes \r\n.
const csvCell = (value) => `"${(value === null || value === undefined ? '' : String(value)).replace(/"/g, '""')}"`;
const csvLine = (values) => `${values.map(csvCell).join(',')}\r\n`;
// Marque d'ordre des octets : Excel lit alors correctement les accents.
const CSV_BOM = '\uFEFF';

module.exports = { CSV_BOM, CSV_HEADERS, buildTree, csvLine, descendants, postUrl, selectDisplayed, slimRaw, treeStats };
