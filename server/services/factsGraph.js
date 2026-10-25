const { TIMELINE_BUCKETS, bucketFor, coreTimeBounds, edgeKey } = require('./analytics');
const { factEntities } = require('./facts');

// Graphes calculés sur post_facts, en deux temps pour tenir avec des millions de posts :
// 1. MongoDB compte les nœuds et renvoie les maxNodes plus fréquents ;
// 2. seules les entrées qui contiennent l'un de ces nœuds sont lues, pour compter les arêtes entre eux.
// Même résultat que createGraphBuilder / createTemporalGraphBuilder, sans garder toutes les paires en mémoire.
// total_links n'est pas calculé (il faudrait compter toutes les paires) : il vaut null.

const notEmpty = (field) => ({ [`${field}.0`]: { $exists: true } });
const withMatch = (match, ...extra) => {
  const conditions = [match, ...extra].filter((condition) => condition && Object.keys(condition).length);
  if (!conditions.length) return {};
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

// Nœuds d'une entrée, dans un pipeline : hashtags, ou auteur + comptes mentionnés.
const nodesExpression = (type) => (type === 'mentions' ? { $concatArrays: [['$author_node'], '$mentions'] } : '$hashtags');
const entitiesFilter = (type) => notEmpty(type === 'mentions' ? 'mentions' : 'hashtags');
const containsAny = (type, ids) => (type === 'mentions'
  ? { $or: [{ author_node: { $in: ids } }, { mentions: { $in: ids } }] }
  : { hashtags: { $in: ids } });
const projection = (type, extra = {}) => (type === 'mentions' ? { _id: 0, author_node: 1, mentions: 1, ...extra } : { _id: 0, hashtags: 1, ...extra });

async function topNodes(facts, match, type, maxNodes) {
  const [result = {}] = await facts.aggregate([
    { $match: withMatch(match, entitiesFilter(type)) },
    { $project: { nodes: nodesExpression(type) } },
    { $unwind: '$nodes' },
    { $group: { _id: '$nodes', value: { $sum: 1 } } },
    { $facet: { top: [{ $sort: { value: -1, _id: 1 } }, { $limit: maxNodes }], total: [{ $count: 'count' }] } },
  ], { allowDiskUse: true }).toArray();
  return { top: result.top || [], total: result.total?.[0]?.count || 0 };
}

async function buildFactsGraph(facts, match, type, maxNodes, { minEdgeWeight = 1 } = {}) {
  const { top, total } = await topNodes(facts, match, type, maxNodes);
  const keptIds = new Set(top.map((node) => node._id));
  const edgeCounts = new Map();
  if (keptIds.size > 1) {
    const cursor = facts.find(withMatch(match, containsAny(type, [...keptIds])), { projection: projection(type) });
    for await (const fact of cursor) {
      factEntities(fact, type).edges.forEach(([source, target]) => {
        if (!keptIds.has(source) || !keptIds.has(target)) return;
        const key = edgeKey(source, target);
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      });
    }
  }
  const links = [];
  edgeCounts.forEach((value, key) => {
    const [source, target] = key.split('::');
    if (value >= minEdgeWeight) links.push({ source, target, value });
  });
  return { nodes: top.map((node) => ({ id: node._id, label: node._id, value: node.value })), links, total_nodes: total, total_links: null };
}

// Axe du temps : bornes sans dates aberrantes (même règle que la courbe), taille et nombre de tranches.
async function timeAxis(facts, match, { bucketMinutes, maxBuckets }) {
  const rows = await facts.aggregate([
    { $match: withMatch(match) },
    { $group: { _id: { $dateTrunc: { date: '$date', unit: 'minute' } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
  const undated = rows.filter((row) => !row._id).reduce((sum, row) => sum + row.count, 0);
  const items = rows.filter((row) => row._id).map((row) => ({ t: row._id.getTime(), count: row.count }));
  const total = items.reduce((sum, row) => sum + row.count, 0);
  if (!total) return null;
  const bounds = coreTimeBounds(items, total);
  const kept = items.filter((row) => row.t >= bounds.low && row.t <= bounds.high);
  const minutes = TIMELINE_BUCKETS.includes(bucketMinutes) ? bucketMinutes : bucketFor(kept[kept.length - 1].t - kept[0].t, maxBuckets);
  const bucketMs = minutes * 60000;
  const start = Math.floor(kept[0].t / bucketMs) * bucketMs;
  const buckets = Math.floor((kept[kept.length - 1].t - start) / bucketMs) + 1;
  const volume = new Array(buckets).fill(0);
  kept.forEach((row) => { volume[Math.floor((row.t - start) / bucketMs)] += row.count; });
  const keptTotal = kept.reduce((sum, row) => sum + row.count, 0);
  return {
    start, bucketMs, minutes, buckets, volume,
    range: { date: { $gte: new Date(kept[0].t), $lt: new Date(kept[kept.length - 1].t + 60000) } },
    excluded: undated + total - keptTotal,
  };
}

const bucketExpression = (axis) => ({ $floor: { $divide: [{ $subtract: [{ $toLong: '$date' }, axis.start] }, axis.bucketMs] } });

async function buildFactsTemporalGraph(facts, match, type, maxNodes, { minEdgeWeight = 1, bucketMinutes = null, maxBuckets = 300, peaks = 0 } = {}) {
  const axis = await timeAxis(facts, match, { bucketMinutes, maxBuckets });
  if (!axis) return { nodes: [], links: [], total_nodes: 0, total_links: null, time: { start: null, bucket_minutes: 60, buckets: 0, volume: [], excluded: 0 } };
  const scoped = withMatch(match, axis.range);
  const { top, total } = await topNodes(facts, scoped, type, maxNodes);
  const keptIds = new Set(top.map((node) => node._id));

  // Les `peaks` nœuds les plus fréquents de chaque tranche, même hors du top global.
  if (peaks > 0) {
    const perBucket = await facts.aggregate([
      { $match: withMatch(scoped, entitiesFilter(type)) },
      { $project: { bucket: bucketExpression(axis), nodes: nodesExpression(type) } },
      { $unwind: '$nodes' },
      { $group: { _id: { bucket: '$bucket', node: '$nodes' }, count: { $sum: 1 } } },
      { $group: { _id: '$_id.bucket', top: { $topN: { n: peaks, sortBy: { count: -1 }, output: '$_id.node' } } } },
    ], { allowDiskUse: true }).toArray();
    perBucket.forEach((row) => row.top.forEach((id) => keptIds.add(id)));
  }

  const nodeSeries = new Map([...keptIds].map((id) => [id, new Map()]));
  const nodeTotals = new Map();
  const edgeSeries = new Map();
  const edgeTotals = new Map();
  const bump = (totals, series, key, bucket) => {
    totals.set(key, (totals.get(key) || 0) + 1);
    if (!series.has(key)) series.set(key, new Map());
    const counts = series.get(key);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  };
  if (keptIds.size) {
    const cursor = facts.find(withMatch(scoped, containsAny(type, [...keptIds])), { projection: projection(type, { date: 1 }) });
    for await (const fact of cursor) {
      const bucket = Math.floor((fact.date.getTime() - axis.start) / axis.bucketMs);
      const { nodes, edges } = factEntities(fact, type);
      nodes.forEach((id) => { if (keptIds.has(id)) bump(nodeTotals, nodeSeries, id, bucket); });
      edges.forEach(([source, target]) => {
        if (keptIds.has(source) && keptIds.has(target)) bump(edgeTotals, edgeSeries, edgeKey(source, target), bucket);
      });
    }
  }
  const toSeries = (counts) => Array.from(counts || []).sort((left, right) => left[0] - right[0]);
  const nodes = [...keptIds]
    .map((id) => ({ id, label: id, value: nodeTotals.get(id) || 0, series: toSeries(nodeSeries.get(id)) }))
    .sort((left, right) => right.value - left.value);
  const links = [];
  edgeTotals.forEach((value, key) => {
    const [source, target] = key.split('::');
    if (value >= minEdgeWeight) links.push({ source, target, value, series: toSeries(edgeSeries.get(key)) });
  });
  return {
    nodes,
    links,
    total_nodes: total,
    total_links: null,
    time: { start: new Date(axis.start).toISOString(), bucket_minutes: axis.minutes, buckets: axis.buckets, volume: axis.volume, excluded: axis.excluded },
  };
}

module.exports = { buildFactsGraph, buildFactsTemporalGraph, containsAny, withMatch };
