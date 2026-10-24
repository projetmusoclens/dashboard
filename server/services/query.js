const { collectionKey, mongoCollectionKeyExpression } = require('./collections');

const POST_KINDS = ['original', 'reply', 'retweet', 'quote'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mêmes règles que detectPostKind (normalization.js), exprimées pour les pipelines Mongo.
function mongoIsRetweetExpression() {
  return { $or: [
    { $eq: ['$event_type', 'repost'] },
    { $ne: [{ $ifNull: ['$raw_json.tweet.retweeted_tweet', null] }, null] },
  ] };
}

function mongoIsQuoteExpression() {
  const embedType = { $getField: { field: { $literal: '$type' }, input: { $ifNull: ['$raw_json.embed', {}] } } };
  return { $or: [
    { $ne: [{ $ifNull: ['$raw_json.tweet.quoted_tweet', null] }, null] },
    { $in: [embedType, ['app.bsky.embed.record', 'app.bsky.embed.recordWithMedia']] },
  ] };
}

function mongoIsReplyExpression() {
  return { $ne: [{ $ifNull: ['$reply_to_id', ''] }, ''] };
}

function mongoKindCondition(kind) {
  if (kind === 'retweet') return { $expr: mongoIsRetweetExpression() };
  if (kind === 'quote') return { $expr: mongoIsQuoteExpression() };
  if (kind === 'reply') return { $expr: mongoIsReplyExpression() };
  return { $expr: { $not: [{ $or: [mongoIsRetweetExpression(), mongoIsQuoteExpression(), mongoIsReplyExpression()] }] } };
}

function postMatchesKind(post, kind) {
  if (kind === 'retweet') return Boolean(post.is_retweet);
  if (kind === 'quote') return Boolean(post.is_quote);
  if (kind === 'reply') return Boolean(post.is_reply);
  return !post.is_retweet && !post.is_quote && !post.is_reply;
}

// Identifiants de posts passés en liste séparée par des virgules (?ids=…), 500 au plus.
function queryIds(query) {
  if (typeof query.ids !== 'string' || !query.ids) return null;
  return [...new Set(query.ids.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 500);
}

// Collectes choisies : une seule (?collectionId=a) ou plusieurs séparées par des virgules (?collectionId=a,b).
function queryCollectionKeys(query) {
  const values = Array.isArray(query.collectionId) ? query.collectionId : String(query.collectionId || '').split(',');
  const keys = [...new Set(values.map((value) => String(value).trim()).filter(Boolean).map(collectionKey))];
  return keys.length ? keys : null;
}

// Bornes horaires précises (ISO), en plus des dates au jour : startTime inclus, endTime exclu.
function queryTimeBounds(query) {
  const parse = (value) => { const time = typeof value === 'string' && value ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time) : null; };
  const start = parse(query.startTime);
  const end = parse(query.endTime);
  return start || end ? { start, end } : null;
}

function buildMatchFromQuery(query) {
  const conditions = [];
  const ids = queryIds(query);
  if (ids) conditions.push({ post_id: { $in: ids } });
  const collectionKeys = queryCollectionKeys(query);
  if (collectionKeys) {
    conditions.push({ $expr: { $in: [mongoCollectionKeyExpression(), collectionKeys] } });
  }
  if (query.platform) {
    const platform = String(query.platform).toLowerCase();
    conditions.push({ $or: [{ platform }, { 'collection_context.platform': platform }] });
  }
  if (query.lang) conditions.push({ lang: String(query.lang).toLowerCase() });
  if (query.q && String(query.q).trim()) {
    const pattern = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    conditions.push({ $or: [{ text: pattern }, { author_handle: pattern }, { matched_keywords: pattern }] });
  }
  if (POST_KINDS.includes(query.kind)) conditions.push(mongoKindCondition(query.kind));
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

  const bounds = queryTimeBounds(query);
  if (bounds) {
    // Même date que la courbe et le graphe temporel : timestamp, puis createdAt, puis collected_at.
    const dateExpression = { $convert: { input: { $ifNull: ['$timestamp', { $ifNull: ['$createdAt', '$collected_at'] }] }, to: 'date', onError: null, onNull: null } };
    const comparisons = [];
    if (bounds.start) comparisons.push({ $gte: [dateExpression, bounds.start] });
    if (bounds.end) comparisons.push({ $lt: [dateExpression, bounds.end] });
    conditions.push({ $expr: { $and: comparisons } });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function matchesPostQuery(post, query) {
  const ids = queryIds(query);
  if (ids && !ids.includes(String(post.post_id))) return false;
  const collectionKeys = queryCollectionKeys(query);
  if (collectionKeys && !collectionKeys.includes(collectionKey(post.collection_name))) return false;
  if (query.platform && post.platform !== String(query.platform).toLowerCase()) return false;
  if (query.lang && post.lang !== String(query.lang).toLowerCase()) return false;
  if (query.q && String(query.q).trim()) {
    const needle = String(query.q).trim().toLowerCase();
    const haystack = [post.text, post.author_handle, ...(post.matched_keywords || [])].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if (POST_KINDS.includes(query.kind) && !postMatchesKind(post, query.kind)) return false;

  const rawTimestamp = post.timestamp || post.createdAt || post.created_at || post.collected_at;
  const timestamp = new Date(rawTimestamp || 0);
  if (query.startDate && timestamp < new Date(`${query.startDate}T00:00:00.000Z`)) return false;
  if (query.endDate) {
    const endExclusive = new Date(`${query.endDate}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    if (timestamp >= endExclusive) return false;
  }
  const bounds = queryTimeBounds(query);
  if (bounds?.start && !(timestamp >= bounds.start)) return false;
  if (bounds?.end && !(timestamp < bounds.end)) return false;
  return true;
}

module.exports = {
  POST_KINDS,
  buildMatchFromQuery,
  escapeRegex,
  matchesPostQuery,
  mongoIsQuoteExpression,
  mongoIsReplyExpression,
  mongoIsRetweetExpression,
};
