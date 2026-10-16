const { collectionKey, normalizeCollectionName } = require('./collections');

function buildThreads(posts) {
  const byId = new Map(posts.map((post) => [String(post.post_id), post]));
  const grouped = new Map();
  posts.filter((post) => post.reply_to_id).forEach((reply) => {
    let root = reply;
    const visited = new Set();
    while (root.reply_to_id && byId.has(String(root.reply_to_id)) && !visited.has(String(root.post_id))) {
      visited.add(String(root.post_id));
      root = byId.get(String(root.reply_to_id));
    }
    const rootId = String(root.post_id);
    if (!grouped.has(rootId)) grouped.set(rootId, { parent: root, replies: [] });
    grouped.get(rootId).replies.push(reply);
  });
  return Array.from(grouped.values()).sort((left, right) => right.replies.length - left.replies.length);
}

function buildStatsFromPosts(posts) {
  const byPlatform = {};
  const byLang = {};
  const byKeyword = {};
  const hashtags = {};
  const authors = {};
  const collections = {};
  const averages = { likes: [], reposts: [], replies: [], quotes: [], views: [] };
  const sums = { likes: 0, reposts: 0, replies: 0, quotes: 0, views: 0 };
  const postsVsReplies = { posts: 0, replies: 0 };

  posts.forEach((post) => {
    byPlatform[post.platform] = (byPlatform[post.platform] || 0) + 1;
    byLang[post.lang] = (byLang[post.lang] || 0) + 1;
    authors[post.author_handle] = (authors[post.author_handle] || 0) + 1;
    postsVsReplies[post.is_reply ? 'replies' : 'posts'] += 1;
    post.matched_keywords.forEach((keyword) => { byKeyword[keyword] = (byKeyword[keyword] || 0) + 1; });
    (post.text.match(/#[A-Za-z0-9_]+/g) || []).forEach((tag) => {
      const key = tag.toLowerCase();
      hashtags[key] = (hashtags[key] || 0) + 1;
    });
    const collectionName = normalizeCollectionName(post.collection_name);
    const key = collectionKey(collectionName);
    const item = collections[key] || { collection_name: collectionName, count: 0, reposts: 0, quotes: 0, emojis: 0, links: 0 };
    item.count += 1;
    item.reposts += post.engagement.reposts || 0;
    item.quotes += post.engagement.quotes || 0;
    item.emojis += (post.text.match(/[\u2600-\u27BF]/g) || []).length;
    item.links += post.has_link ? 1 : 0;
    collections[key] = item;
    Object.keys(averages).forEach((metric) => {
      const value = post.engagement[metric];
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        averages[metric].push(value);
        sums[metric] += value;
      }
    });
  });

  const topAuthors = Object.entries(authors).sort((left, right) => right[1] - left[1]).slice(0, 20).map(([author, count]) => ({ author, count }));
  const engagement_avg = Object.fromEntries(Object.entries(averages).map(([key, values]) => [key, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null]));
  const collection_stats = Object.values(collections)
    .map((item) => ({ ...item, link_rate: item.count ? (item.links / item.count) * 100 : 0 }))
    .sort((left, right) => right.count - left.count || left.collection_name.localeCompare(right.collection_name));
  return { total_posts: posts.length, by_platform: byPlatform, by_lang: byLang, by_keyword: byKeyword, hashtags, top_authors: topAuthors, collection_stats, posts_vs_replies: postsVsReplies, engagement_avg, engagement_sum: sums };
}

function createGraphBuilder(type) {
  const nodeCounts = new Map();
  const edgeCounts = new Map();
  const addNode = (id) => nodeCounts.set(id, (nodeCounts.get(id) || 0) + 1);
  const addEdge = (source, target) => {
    const key = [source, target].sort().join('::');
    edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  };

  const add = (post) => {
    if (type === 'mentions') {
      const author = post.author_handle ? `@${String(post.author_handle).toLowerCase()}` : '@Auteur inconnu';
      const mentions = [...new Set((String(post.text || '').match(/@([A-Za-z0-9_]+)/g) || []).map((value) => value.toLowerCase()))];
      mentions.forEach((mention) => { addNode(author); addNode(mention); addEdge(author, mention); });
      return;
    }
    const hashtags = [...new Set((String(post.text || '').match(/#[A-Za-z0-9_]+/g) || []).map((value) => value.toLowerCase()))];
    hashtags.forEach(addNode);
    for (let index = 0; index < hashtags.length; index += 1) {
      for (let next = index + 1; next < hashtags.length; next += 1) addEdge(hashtags[index], hashtags[next]);
    }
  };

  // maxNodes garde les nœuds les plus fréquents et les liens entre eux.
  const result = (maxNodes = Infinity) => {
    const kept = Array.from(nodeCounts).sort((a, b) => b[1] - a[1]).slice(0, maxNodes);
    const keptIds = new Set(kept.map(([id]) => id));
    const links = [];
    edgeCounts.forEach((value, key) => {
      const [source, target] = key.split('::');
      if (keptIds.has(source) && keptIds.has(target)) links.push({ source, target, value });
    });
    return { nodes: kept.map(([id, value]) => ({ id, label: id, value })), links };
  };

  return { add, result };
}

function buildGraphFromPosts(posts, type, maxNodes) {
  const builder = createGraphBuilder(type);
  posts.forEach(builder.add);
  return builder.result(maxNodes);
}

module.exports = { buildGraphFromPosts, createGraphBuilder, buildStatsFromPosts, buildThreads };