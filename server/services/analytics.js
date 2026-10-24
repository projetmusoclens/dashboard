const { collectionKey, normalizeCollectionName } = require('./collections');

// Hashtags Unicode (#España, #كأس_العالم) : le motif Mongo des statistiques suit la même règle.
const HASHTAG_PATTERN = /#[\p{L}\p{N}_]+/gu;
const MONGO_HASHTAG_PATTERN = '#[\\p{L}\\p{N}_]+';
const MENTION_PATTERN = /@[A-Za-z0-9_]+/g;

function extractHashtags(text) {
  return [...new Set((String(text || '').match(HASHTAG_PATTERN) || []).map((value) => value.toLowerCase()))];
}

function extractMentions(text) {
  return [...new Set((String(text || '').match(MENTION_PATTERN) || []).map((value) => value.toLowerCase()))];
}

function edgeKey(source, target) {
  return [source, target].sort().join('::');
}

// Comptes mentionnés dans un post Bluesky : leurs DID, présents dans les facets du post.
function blueskyMentionDids(post) {
  const raw = post.raw_json && typeof post.raw_json === 'object' ? post.raw_json : {};
  const facets = raw.facets || raw.record?.facets || [];
  const dids = [];
  facets.forEach((facet) => (facet?.features || []).forEach((feature) => {
    if (String(feature?.$type || '').endsWith('#mention') && feature.did) dids.push(`@${String(feature.did).toLowerCase()}`);
  }));
  return [...new Set(dids)];
}

// Nœuds et arêtes qu'un post apporte au graphe ; partagé par la construction et l'export de sous-graphe.
// Mentions : sur X, les @pseudo du texte ; sur Bluesky, les DID des facets, comme pour les auteurs.
function graphEntities(post, type) {
  if (type === 'mentions') {
    const mentions = post.platform === 'bluesky' ? blueskyMentionDids(post) : extractMentions(post.text);
    if (!mentions.length) return { nodes: [], edges: [] };
    const author = post.author_handle ? `@${String(post.author_handle).toLowerCase()}` : '@Auteur inconnu';
    return { nodes: [author, ...mentions], edges: mentions.map((mention) => [author, mention]) };
  }
  const hashtags = extractHashtags(post.text);
  const edges = [];
  for (let index = 0; index < hashtags.length; index += 1) {
    for (let next = index + 1; next < hashtags.length; next += 1) edges.push([hashtags[index], hashtags[next]]);
  }
  return { nodes: hashtags, edges };
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
  const byType = { original: 0, replies: 0, retweets: 0, quotes: 0 };

  posts.forEach((post) => {
    byPlatform[post.platform] = (byPlatform[post.platform] || 0) + 1;
    byLang[post.lang] = (byLang[post.lang] || 0) + 1;
    authors[post.author_handle] = (authors[post.author_handle] || 0) + 1;
    postsVsReplies[post.is_reply ? 'replies' : 'posts'] += 1;
    if (post.is_reply) byType.replies += 1;
    if (post.is_retweet) byType.retweets += 1;
    if (post.is_quote) byType.quotes += 1;
    if (!post.is_reply && !post.is_retweet && !post.is_quote) byType.original += 1;
    post.matched_keywords.forEach((keyword) => { byKeyword[keyword] = (byKeyword[keyword] || 0) + 1; });
    (post.text.match(HASHTAG_PATTERN) || []).forEach((tag) => {
      const key = tag.toLowerCase();
      hashtags[key] = (hashtags[key] || 0) + 1;
    });
    const collectionName = normalizeCollectionName(post.collection_name);
    const key = collectionKey(collectionName);
    const item = collections[key] || { collection_name: collectionName, count: 0, reposts: 0, quotes: 0, emojis: 0, links: 0 };
    item.count += 1;
    item.reposts += post.engagement.reposts || 0;
    item.quotes += post.engagement.quotes || 0;
    item.emojis += (post.text.match(/[☀-➿]/g) || []).length;
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
  return { total_posts: posts.length, by_platform: byPlatform, by_lang: byLang, by_keyword: byKeyword, hashtags, top_authors: topAuthors, collection_stats, posts_vs_replies: postsVsReplies, by_type: byType, engagement_avg, engagement_sum: sums };
}

function createGraphBuilder(type) {
  const nodeCounts = new Map();
  const edgeCounts = new Map();

  const add = (post) => {
    const { nodes, edges } = graphEntities(post, type);
    nodes.forEach((id) => nodeCounts.set(id, (nodeCounts.get(id) || 0) + 1));
    edges.forEach(([source, target]) => {
      const key = edgeKey(source, target);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    });
  };

  // Garde les maxNodes nœuds les plus fréquents et les liens entre eux d'un poids au moins minEdgeWeight.
  // total_nodes / total_links donnent le volume complet avant ces limites.
  const result = (maxNodes = Infinity, { minEdgeWeight = 1 } = {}) => {
    const kept = Array.from(nodeCounts).sort((a, b) => b[1] - a[1]).slice(0, maxNodes);
    const keptIds = new Set(kept.map(([id]) => id));
    const links = [];
    edgeCounts.forEach((value, key) => {
      const [source, target] = key.split('::');
      if (value >= minEdgeWeight && keptIds.has(source) && keptIds.has(target)) links.push({ source, target, value });
    });
    return { nodes: kept.map(([id, value]) => ({ id, label: id, value })), links, total_nodes: nodeCounts.size, total_links: edgeCounts.size };
  };

  return { add, result };
}

// Date de publication d'un post, comme pour la courbe : timestamp, puis createdAt, puis collected_at.
function postTime(post) {
  return new Date(post.timestamp || post.createdAt || post.collected_at || NaN).getTime();
}

// Séries creuses [[tranche, compte], …] triées par tranche.
const toSeries = (counts) => Array.from(counts).sort((left, right) => left[0] - right[0]);

// Graphe temporel : mêmes nœuds et arêtes que createGraphBuilder, avec en plus, pour chacun,
// le nombre de posts par tranche de temps. Le navigateur peut ainsi parcourir le temps sans nouvelle requête.
function createTemporalGraphBuilder(type) {
  const records = [];
  let undated = 0;

  const add = (post) => {
    const t = postTime(post);
    if (!Number.isFinite(t)) { undated += 1; return; }
    const { nodes, edges } = graphEntities(post, type);
    records.push({ t, nodes, edges });
  };

  // bucketMinutes : taille imposée, sinon la plus fine qui donne au plus maxBuckets tranches.
  // peaks : ajoute les `peaks` nœuds les plus fréquents de chaque tranche, même hors du top global.
  const result = (maxNodes = Infinity, { minEdgeWeight = 1, bucketMinutes = null, maxBuckets = 300, peaks = 0 } = {}) => {
    const empty = { nodes: [], links: [], total_nodes: 0, total_links: 0, time: { start: null, bucket_minutes: 60, buckets: 0, volume: [], excluded: undated } };
    if (!records.length) return empty;
    records.sort((left, right) => left.t - right.t);
    const bounds = coreTimeBounds(records.map((record) => ({ t: record.t, count: 1 })), records.length);
    const kept = records.filter((record) => record.t >= bounds.low && record.t <= bounds.high);
    const minutes = TIMELINE_BUCKETS.includes(bucketMinutes) ? bucketMinutes : bucketFor(kept[kept.length - 1].t - kept[0].t, maxBuckets);
    const bucketMs = minutes * 60000;
    const start = Math.floor(kept[0].t / bucketMs) * bucketMs;
    const bucketCount = Math.floor((kept[kept.length - 1].t - start) / bucketMs) + 1;

    const volume = new Array(bucketCount).fill(0);
    const nodeTotals = new Map();
    const nodeSeries = new Map();
    const edgeTotals = new Map();
    const edgeSeries = new Map();
    const bump = (totals, series, key, bucket) => {
      totals.set(key, (totals.get(key) || 0) + 1);
      if (!series.has(key)) series.set(key, new Map());
      const counts = series.get(key);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    };
    kept.forEach((record) => {
      const bucket = Math.floor((record.t - start) / bucketMs);
      volume[bucket] += 1;
      record.nodes.forEach((id) => bump(nodeTotals, nodeSeries, id, bucket));
      record.edges.forEach(([source, target]) => bump(edgeTotals, edgeSeries, edgeKey(source, target), bucket));
    });

    const keptIds = new Set(Array.from(nodeTotals).sort((a, b) => b[1] - a[1]).slice(0, maxNodes).map(([id]) => id));
    if (peaks > 0) {
      const perBucket = Array.from({ length: bucketCount }, () => []);
      nodeSeries.forEach((counts, id) => counts.forEach((count, bucket) => perBucket[bucket].push([id, count])));
      perBucket.forEach((entries) => entries.sort((a, b) => b[1] - a[1]).slice(0, peaks).forEach(([id]) => keptIds.add(id)));
    }
    const nodes = Array.from(keptIds)
      .map((id) => ({ id, label: id, value: nodeTotals.get(id), series: toSeries(nodeSeries.get(id)) }))
      .sort((left, right) => right.value - left.value);
    const links = [];
    edgeTotals.forEach((value, key) => {
      const [source, target] = key.split('::');
      if (value >= minEdgeWeight && keptIds.has(source) && keptIds.has(target)) links.push({ source, target, value, series: toSeries(edgeSeries.get(key)) });
    });
    return {
      nodes,
      links,
      total_nodes: nodeTotals.size,
      total_links: edgeTotals.size,
      time: { start: new Date(start).toISOString(), bucket_minutes: minutes, buckets: bucketCount, volume, excluded: undated + records.length - kept.length },
    };
  };

  return { add, result };
}

function buildGraphFromPosts(posts, type, maxNodes, options) {
  const builder = createGraphBuilder(type);
  posts.forEach(builder.add);
  return builder.result(maxNodes, options);
}

// Indique quels nœuds et arêtes de la sélection un post contient ; null s'il n'en contient aucun.
function matchSubgraphPost(post, type, selectedIds) {
  const { nodes, edges } = graphEntities(post, type);
  const matchedNodes = nodes.filter((id) => selectedIds.has(id));
  if (!matchedNodes.length) return null;
  const matchedEdges = edges
    .filter(([source, target]) => source !== target && selectedIds.has(source) && selectedIds.has(target))
    .map(([source, target]) => edgeKey(source, target));
  return { subgraph_nodes: [...new Set(matchedNodes)], subgraph_edges: [...new Set(matchedEdges)] };
}

// Pas de regroupement (minutes) : le plus fin qui garde au plus maxPoints points sur la période.
const TIMELINE_BUCKETS = [1, 5, 10, 15, 30, 60, 180, 360, 720, 1440, 10080];

// Bornes du cœur de la distribution : on retire 0,5 % de chaque côté, puis on garde une marge de 25 %.
// items : [{ t, count }] triés par date.
function coreTimeBounds(items, total) {
  const cut = total * 0.005;
  let cumulative = 0;
  let low = items[0].t;
  for (const row of items) { cumulative += row.count; if (cumulative > cut) { low = row.t; break; } }
  cumulative = 0;
  let high = items[items.length - 1].t;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    cumulative += items[index].count;
    if (cumulative > cut) { high = items[index].t; break; }
  }
  const margin = Math.max(high - low, 60 * 60 * 1000) * 0.25;
  return { low: low - margin, high: high + margin };
}

const bucketFor = (spanMs, maxPoints) => TIMELINE_BUCKETS.find((minutes) => spanMs / (minutes * 60000) <= maxPoints) || TIMELINE_BUCKETS[TIMELINE_BUCKETS.length - 1];

// rows : [{ date, platform, count }] à la minute. Les dates aberrantes loin du cœur de la
// distribution (ex. horodatages Bluesky de 2009) sont exclues et comptées à part.
function buildTimeline(rows, { maxPoints = 160 } = {}) {
  const items = rows
    .map((row) => ({ t: new Date(row.date).getTime(), platform: String(row.platform || 'unknown').toLowerCase(), count: Number(row.count) || 0 }))
    .filter((row) => Number.isFinite(row.t) && row.count > 0)
    .sort((left, right) => left.t - right.t);
  const total = items.reduce((sum, row) => sum + row.count, 0);
  if (!total) return { bucket_minutes: 60, excluded: 0, platforms: [], points: [] };

  const bounds = coreTimeBounds(items, total);
  const kept = items.filter((row) => row.t >= bounds.low && row.t <= bounds.high);
  const excluded = total - kept.reduce((sum, row) => sum + row.count, 0);

  const start = kept[0].t;
  const end = kept[kept.length - 1].t;
  const bucketMinutes = bucketFor(end - start, maxPoints);
  const bucketMs = bucketMinutes * 60000;
  const platforms = [...new Set(kept.map((row) => row.platform))].sort();
  const first = Math.floor(start / bucketMs) * bucketMs;
  const last = Math.floor(end / bucketMs) * bucketMs;
  const blank = () => Object.fromEntries(platforms.map((platform) => [platform, 0]));
  const buckets = new Map();
  for (let t = first; t <= last; t += bucketMs) buckets.set(t, { ts: t, date: new Date(t).toISOString(), total: 0, ...blank() });
  kept.forEach((row) => {
    const bucket = buckets.get(Math.floor(row.t / bucketMs) * bucketMs);
    bucket.total += row.count;
    bucket[row.platform] += row.count;
  });
  return { bucket_minutes: bucketMinutes, excluded, platforms, points: Array.from(buckets.values()) };
}

function timelineRowsFromPosts(posts) {
  const rows = new Map();
  posts.forEach((post) => {
    const time = new Date(post.timestamp || post.createdAt || post.collected_at).getTime();
    if (!Number.isFinite(time)) return;
    const minute = Math.floor(time / 60000) * 60000;
    const key = `${minute}|${post.platform}`;
    const row = rows.get(key) || { date: minute, platform: post.platform, count: 0 };
    row.count += 1;
    rows.set(key, row);
  });
  return Array.from(rows.values());
}

module.exports = {
  MONGO_HASHTAG_PATTERN,
  buildGraphFromPosts,
  buildStatsFromPosts,
  buildTimeline,
  createGraphBuilder,
  createTemporalGraphBuilder,
  TIMELINE_BUCKETS,
  edgeKey,
  extractHashtags,
  extractMentions,
  blueskyMentionDids,
  graphEntities,
  matchSubgraphPost,
  timelineRowsFromPosts,
};
