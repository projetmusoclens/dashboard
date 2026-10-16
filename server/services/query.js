const { collectionKey, mongoCollectionKeyExpression } = require('./collections');

function buildMatchFromQuery(query) {
  const conditions = [];
  if (query.collectionId) {
    conditions.push({ $expr: { $eq: [mongoCollectionKeyExpression(), collectionKey(query.collectionId)] } });
  }
  if (query.platform) {
    const platform = String(query.platform).toLowerCase();
    conditions.push({ $or: [{ platform }, { 'collection_context.platform': platform }] });
  }
  if (query.lang) conditions.push({ lang: String(query.lang).toLowerCase() });
  if (query.startDate || query.endDate) {
    const dateExpression = { $convert: { input: { $ifNull: ['$timestamp', '$collected_at'] }, to: 'date', onError: null, onNull: null } };
    const comparisons = [];
    if (query.startDate) comparisons.push({ $gte: [dateExpression, new Date(`${query.startDate}T00:00:00.000Z`)] });
    if (query.endDate) {
      const end = new Date(`${query.endDate}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      comparisons.push({ $lt: [dateExpression, end] });
    }
    conditions.push({ $expr: { $and: comparisons } });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function matchesPostQuery(post, query) {
  if (query.collectionId && collectionKey(post.collection_name) !== collectionKey(query.collectionId)) return false;
  if (query.platform && post.platform !== String(query.platform).toLowerCase()) return false;
  if (query.lang && post.lang !== String(query.lang).toLowerCase()) return false;

  const rawTimestamp = post.timestamp || post.createdAt || post.created_at || post.collected_at;
  const timestamp = new Date(rawTimestamp || 0);
  if (query.startDate && timestamp < new Date(`${query.startDate}T00:00:00.000Z`)) return false;
  if (query.endDate) {
    const endExclusive = new Date(`${query.endDate}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    if (timestamp >= endExclusive) return false;
  }
  return true;
}

module.exports = { buildMatchFromQuery, matchesPostQuery };