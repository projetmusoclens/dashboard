const { normalizeCollectionName } = require('./collections');

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function normalizePlatform(post) {
  const value = firstValue(post.platform, post.collection_context?.platform, post.source);
  if (!value) return 'unknown';
  const normalized = String(value).trim().toLowerCase();
  if (normalized.includes('twitter') || normalized.includes('x.com')) return 'twitter';
  if (normalized.includes('blue')) return 'bluesky';
  return normalized;
}

function normalizeTimestamp(post) {
  return firstValue(post.timestamp, post.createdAt, post.created_at, post.collected_at);
}

function normalizeMediaUrls(...sources) {
  const urls = sources.flatMap((source) => {
    const values = Array.isArray(source) ? source : source ? [source] : [];
    return values.map((value) => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object') return null;
      return firstValue(value.url, value.media_url, value.preview_image_url, value.thumbnail_url);
    });
  });
  return Array.from(new Set(urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url))));
}

function normalizeCollectionContext(post) {
  const context = post.collection_context && typeof post.collection_context === 'object'
    ? post.collection_context
    : {};
  return {
    collection_name: firstValue(context.collection_name, context.name, post.collection_name),
    event: firstValue(context.event, post.event),
    platform: normalizePlatform({ platform: firstValue(context.platform, post.platform) }),
    started_at: firstValue(context.started_at),
  };
}

const BLUESKY_QUOTE_EMBEDS = ['app.bsky.embed.record', 'app.bsky.embed.recordWithMedia'];

// Le tweet brut est stocké sous raw_json.tweet ; certains exports le placent directement dans raw_json.
function rawTweet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.tweet && typeof raw.tweet === 'object') return raw.tweet;
  return raw.type === 'tweet' ? raw : null;
}

function detectPostKind(post) {
  const raw = post.raw_json && typeof post.raw_json === 'object' ? post.raw_json : null;
  const tweet = rawTweet(raw);
  const record = raw && raw.record && typeof raw.record === 'object' ? raw.record : raw;
  const recordType = record?.$type || null;
  const isRetweet = post.event_type === 'repost'
    || recordType === 'app.bsky.feed.repost'
    || Boolean(tweet?.retweeted_tweet);
  const isQuote = Boolean(tweet?.quoted_tweet)
    || BLUESKY_QUOTE_EMBEDS.includes(record?.embed?.$type);
  return { isRetweet, isQuote };
}

function normalizePost(post) {
  const rawTs = normalizeTimestamp(post);
  let createdAt = null;
  try {
    createdAt = rawTs ? new Date(rawTs).toISOString() : null;
  } catch (error) {
    createdAt = null;
  }
  const platform = normalizePlatform(post);
  const collectionContext = normalizeCollectionContext(post);
  const replyToId = firstValue(post.reply_to_id);
  const authorHandle = firstValue(post.author_handle, post.author, post.handle) || 'unknown';
  const engagement = post.engagement && typeof post.engagement === 'object' ? post.engagement : {};
  const imageUrls = normalizeMediaUrls(post.image_urls, post.image_url);
  const videoUrls = normalizeMediaUrls(post.video_urls);
  const mediaUrls = normalizeMediaUrls(post.media_urls, post.media_url, post.media);
  const text = String(firstValue(post.text, post.content) || '');
  const { isRetweet, isQuote } = detectPostKind(post);
  return {
    id: String(post.post_id || post._id || ''),
    post_id: String(post.post_id || post._id || ''),
    author_handle: String(authorHandle),
    author_id: firstValue(post.author_id) ? String(post.author_id) : null,
    author: String(firstValue(post.author, post.author_handle, post.handle) || 'unknown'),
    text,
    lang: String(firstValue(post.lang, post.language) || 'unknown').toLowerCase(),
    timestamp: rawTs || '',
    collected_at: firstValue(post.collected_at),
    createdAt,
    platform,
    collection_context: collectionContext,
    collection_name: normalizeCollectionName(collectionContext.collection_name),
    is_reply: Boolean(replyToId),
    reply_to_id: replyToId ? String(replyToId) : null,
    is_retweet: isRetweet,
    is_quote: isQuote,
    event_type: firstValue(post.event_type),
    subject_uri: firstValue(post.subject_uri),
    matched_keywords: Array.isArray(post.matched_keywords) ? post.matched_keywords : [],
    has_link: /https?:\/\//i.test(text),
    image_url: imageUrls[0] || null,
    image_urls: imageUrls,
    media_url: mediaUrls[0] || null,
    media_urls: mediaUrls,
    video_urls: videoUrls,
    raw_json: post.raw_json ?? null,
    engagement: {
      likes: firstValue(engagement.likes, post.likes) === null ? null : Number(firstValue(engagement.likes, post.likes)),
      reposts: firstValue(engagement.reposts, post.reposts) === null ? null : Number(firstValue(engagement.reposts, post.reposts)),
      replies: firstValue(engagement.replies, post.replies) === null ? null : Number(firstValue(engagement.replies, post.replies)),
      quotes: firstValue(engagement.quotes, post.quotes) === null ? null : Number(firstValue(engagement.quotes, post.quotes)),
      views: firstValue(engagement.views, post.views) === null ? null : Number(firstValue(engagement.views, post.views)),
    },
    is_deleted: Boolean(post.is_deleted),
  };
}

module.exports = { detectPostKind, firstValue, normalizePost, normalizePlatform };