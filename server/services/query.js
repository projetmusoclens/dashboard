const { collectionKey } = require('./collections');

const POST_KINDS = ['original', 'reply', 'retweet', 'quote'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Filtres reconnus d'une requête, sous une forme stable pour servir de clé de cache :
// les collectes sont triées, l'ordre dans lequel elles ont été cochées ne compte pas.
function pickFilters(source, keys) {
  const filters = {};
  keys.forEach((key) => {
    if (typeof source[key] !== 'string' || !source[key]) return;
    filters[key] = key === 'collectionId'
      ? [...new Set(source[key].split(',').map((value) => value.trim()).filter(Boolean).map(collectionKey))].sort().join(',')
      : source[key];
  });
  if (filters.collectionId === '') delete filters.collectionId;
  return filters;
}

// Filtres de l'API sur post_facts : champs déjà normalisés, donc conditions simples que MongoDB
// sert avec les index. matchesPostQuery applique les mêmes règles en mémoire (mode archive).
function buildFactsMatch(query) {
  const conditions = [];
  const ids = queryIds(query);
  if (ids) conditions.push({ post_id: { $in: ids } });
  const collectionKeys = queryCollectionKeys(query);
  if (collectionKeys) conditions.push({ collection_key: collectionKeys.length === 1 ? collectionKeys[0] : { $in: collectionKeys } });
  if (query.platform) conditions.push({ platform: String(query.platform).toLowerCase() });
  if (query.lang) conditions.push({ lang: String(query.lang).toLowerCase() });
  if (query.q && String(query.q).trim()) {
    const pattern = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    conditions.push({ $or: [{ text: pattern }, { author_handle: pattern }, { keywords: pattern }] });
  }
  if (query.kind === 'retweet') conditions.push({ is_retweet: true });
  if (query.kind === 'quote') conditions.push({ is_quote: true });
  if (query.kind === 'reply') conditions.push({ is_reply: true });
  if (query.kind === 'original') conditions.push({ is_retweet: false, is_quote: false, is_reply: false });
  const date = {};
  if (query.startDate) date.$gte = new Date(`${query.startDate}T00:00:00.000Z`);
  if (query.endDate) {
    const end = new Date(`${query.endDate}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    date.$lt = end;
  }
  const bounds = queryTimeBounds(query);
  if (bounds?.start && (!date.$gte || bounds.start > date.$gte)) date.$gte = bounds.start;
  if (bounds?.end && (!date.$lt || bounds.end < date.$lt)) date.$lt = bounds.end;
  if (Object.keys(date).length) conditions.push({ date });

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

module.exports = {
  POST_KINDS,
  buildFactsMatch,
  pickFilters,
  escapeRegex,
  matchesPostQuery,
};
