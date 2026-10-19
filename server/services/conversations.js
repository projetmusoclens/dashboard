// Reconstruction des conversations (threads) à partir des liens reply_to_id.
// Une réponse dont le parent n'a pas été collecté est rattachée à ce parent manquant, présenté
// comme une racine « non collectée », au lieu d'apparaître comme son propre parent.

const LIGHT_FIELDS = ['post_id', 'reply_to_id', 'author_handle', 'timestamp', 'platform', 'engagement'];

function lightPost(post) {
  return {
    post_id: String(post.post_id),
    reply_to_id: post.reply_to_id ? String(post.reply_to_id) : null,
    author_handle: post.author_handle ? String(post.author_handle) : null,
    timestamp: post.timestamp || null,
    platform: post.platform || null,
    likes: Number(post.engagement?.likes) || 0,
  };
}

// Racine de chaque post connu : le plus haut ancêtre collecté, ou l'identifiant du parent manquant.
function resolveRoots(known) {
  const roots = new Map();
  const rootOf = (id) => {
    if (roots.has(id)) return roots.get(id);
    const path = [];
    const seen = new Set();
    let current = known.get(id);
    let root = id;
    while (current) {
      path.push(current.post_id);
      seen.add(current.post_id);
      const parentId = current.reply_to_id;
      if (!parentId || seen.has(parentId)) { root = current.post_id; break; }
      if (roots.has(parentId)) { root = roots.get(parentId); break; }
      if (!known.has(parentId)) { root = parentId; break; }
      current = known.get(parentId);
    }
    path.forEach((postId) => roots.set(postId, root));
    return root;
  };
  known.forEach((_post, id) => rootOf(id));
  return roots;
}

function depthMap(known, rootId) {
  const depths = new Map([[rootId, 0]]);
  const depthOf = (id, guard = 0) => {
    if (depths.has(id)) return depths.get(id);
    const post = known.get(id);
    const parentId = post?.reply_to_id;
    const depth = !parentId || guard > 500 ? 1 : depthOf(parentId, guard + 1) + 1;
    depths.set(id, depth);
    return depth;
  };
  return depthOf;
}

function platformFromId(id) {
  return String(id).startsWith('at://') ? 'bluesky' : 'twitter';
}

// Résumés de toutes les conversations d'un ensemble de posts connus (filtrés + ancêtres).
function summarizeConversations(known) {
  const roots = resolveRoots(known);
  const groups = new Map();
  roots.forEach((rootId, postId) => {
    if (postId === rootId) return;
    if (!groups.has(rootId)) groups.set(rootId, []);
    groups.get(rootId).push(known.get(postId));
  });
  const summaries = [];
  groups.forEach((members, rootId) => {
    const root = known.get(rootId) || null;
    const depthOf = depthMap(known, rootId);
    const participants = new Set(members.map((post) => post.author_handle).filter(Boolean));
    if (root?.author_handle) participants.add(root.author_handle);
    const times = members.map((post) => Date.parse(post.timestamp)).filter(Number.isFinite);
    if (root && Number.isFinite(Date.parse(root.timestamp))) times.push(Date.parse(root.timestamp));
    summaries.push({
      root_id: rootId,
      root_missing: !root,
      platform: root?.platform || members[0]?.platform || platformFromId(rootId),
      reply_count: members.length,
      direct_replies: members.filter((post) => post.reply_to_id === rootId).length,
      participants: participants.size,
      depth: Math.max(...members.map((post) => depthOf(post.post_id))),
      first_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
      last_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
      likes: members.reduce((sum, post) => sum + post.likes, 0) + (root?.likes || 0),
    });
  });
  return summaries;
}

const SORTS = {
  replies: (left, right) => right.reply_count - left.reply_count || right.participants - left.participants,
  participants: (left, right) => right.participants - left.participants || right.reply_count - left.reply_count,
  depth: (left, right) => right.depth - left.depth || right.reply_count - left.reply_count,
  likes: (left, right) => right.likes - left.likes,
  recent: (left, right) => String(right.last_at || '').localeCompare(String(left.last_at || '')),
};

function selectConversations(summaries, { sort = 'replies', minReplies = 1, root = '', limit = 20, skip = 0 } = {}) {
  const filtered = summaries.filter((item) => item.reply_count >= minReplies
    && (root !== 'collected' || !item.root_missing)
    && (root !== 'missing' || item.root_missing));
  filtered.sort(SORTS[sort] || SORTS.replies);
  return {
    total: filtered.length,
    stats: {
      conversations: filtered.length,
      replies: filtered.reduce((sum, item) => sum + item.reply_count, 0),
      collected_roots: filtered.filter((item) => !item.root_missing).length,
    },
    items: filtered.slice(skip, skip + limit),
  };
}

// Racine de remplacement pour un parent absent de la base : lien vers l'original et auteur si connu.
function missingRoot(rootId, child) {
  const platform = platformFromId(rootId);
  const tweet = child?.raw_json?.tweet;
  const author = tweet?.inReplyToUsername || null;
  let url = '';
  if (platform === 'twitter') url = `https://x.com/${author || 'i'}/status/${rootId}`;
  else {
    const [, , repo, collection, rkey] = String(rootId).split('/');
    if (collection === 'app.bsky.feed.post' && rkey) url = `https://bsky.app/profile/${repo}/post/${rkey}`;
  }
  return { post_id: rootId, platform, author_handle: author, url, missing: true };
}

module.exports = {
  LIGHT_FIELDS,
  lightPost,
  missingRoot,
  platformFromId,
  resolveRoots,
  selectConversations,
  summarizeConversations,
};
