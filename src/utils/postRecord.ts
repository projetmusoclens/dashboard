import { Post } from '../types';

// Vue « lecteur » d'un post, reprise de l'ancien lecteur-annotateur HTML (normalizeTwitter / normalizeBluesky)
// mais construite depuis le Post du dashboard et son raw_json.
export type MediaItem = { type: 'image' | 'video'; url: string; poster?: string; alt: string };

export interface PostRecord {
  post: Post;
  platform: 'twitter' | 'bluesky';
  id: string;
  text: string;
  createdAt: string | null;
  collectedAt: string | null;
  lang: string | null;
  source: string;
  collection: string;
  author: { name: string; handle: string; avatar: string; verified: boolean; id: string | null };
  url: string;
  isReply: boolean;
  isRetweet: boolean;
  isQuote: boolean;
  parentId: string | null;
  conversationId: string | null;
  repostOf: string | null;
  media: MediaItem[];
  external: { title: string; description: string; url: string } | null;
  quote: { text: string; author: string; uri: string } | null;
  entities: { hashtags: string[]; mentions: string[]; urls: string[] };
  metrics: { reply: number | null; retweet: number | null; quote: number | null; like: number | null; view: number | null; bookmark: number | null };
  matchedKeywords: string[];
  keywordsVersion: string | null;
  isDeleted: boolean;
  raw: unknown;
}

export const safeUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

export function shortDid(value: string | null | undefined): string {
  if (!value) return 'Compte inconnu';
  return value.startsWith('did:') ? `${value.slice(0, 18)}…${value.slice(-6)}` : value;
}

const numberOrNull = (...values: unknown[]): number | null => {
  const found = values.find((value) => value !== null && value !== undefined && value !== '');
  if (found === undefined) return null;
  const parsed = Number(found);
  return Number.isFinite(parsed) ? parsed : null;
};

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function rawTweet(raw: any): any | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.tweet && typeof raw.tweet === 'object') return raw.tweet;
  return raw.type === 'tweet' ? raw : null;
}

function fallbackMedia(post: Post): MediaItem[] {
  const images = uniq([post.image_url || '', ...(post.image_urls || []), ...(post.media_urls || []), post.media_url || ''])
    .filter((url) => !/\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url))
    .map((url) => ({ type: 'image' as const, url, alt: 'Média associé' }));
  const videos = uniq([...(post.video_urls || []), ...[...(post.media_urls || [])].filter((url) => /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url))])
    .map((url) => ({ type: 'video' as const, url, alt: 'Vidéo associée' }));
  return [...images, ...videos];
}

function twitterRecord(post: Post): PostRecord {
  const tweet = rawTweet(post.raw_json);
  const author = tweet?.author || {};
  const entities = tweet?.entities || {};
  const tweetMedia: MediaItem[] = ((tweet?.extendedEntities || {}).media || []).map((media: any) => {
    if (media.type === 'video' || media.type === 'animated_gif') {
      const variants = ((media.video_info || {}).variants || [])
        .filter((variant: any) => variant.content_type === 'video/mp4' && variant.url)
        .sort((left: any, right: any) => (right.bitrate || 0) - (left.bitrate || 0));
      return { type: 'video', url: variants[0]?.url || '', poster: media.media_url_https || '', alt: 'Vidéo associée au tweet' };
    }
    return { type: 'image', url: media.media_url_https || '', alt: 'Image associée au tweet' };
  });
  const quoted = tweet?.quoted_tweet;
  const handle = author.userName || post.author_handle;
  return {
    post,
    platform: 'twitter',
    id: String(post.post_id),
    text: tweet?.text ?? post.text ?? '',
    createdAt: post.timestamp || post.createdAt || tweet?.createdAt || null,
    collectedAt: post.collected_at || null,
    lang: post.lang || tweet?.lang || null,
    source: tweet?.source || 'X',
    collection: post.collection_name,
    author: {
      name: author.name || handle || 'Auteur inconnu',
      handle: handle ? `@${handle}` : '',
      avatar: author.profilePicture || '',
      verified: Boolean(author.isVerified || author.isBlueVerified),
      id: author.id || post.author_id || null,
    },
    url: tweet?.url || tweet?.twitterUrl || (handle && post.post_id ? `https://x.com/${handle}/status/${post.post_id}` : ''),
    isReply: Boolean(post.is_reply),
    isRetweet: Boolean(post.is_retweet),
    isQuote: Boolean(post.is_quote),
    parentId: post.reply_to_id || tweet?.inReplyToId || null,
    conversationId: tweet?.conversationId || null,
    repostOf: tweet?.retweeted_tweet?.url || null,
    media: tweetMedia.length ? tweetMedia : fallbackMedia(post),
    external: null,
    quote: quoted ? { text: quoted.text || '', author: quoted.author?.name || quoted.author?.userName || '', uri: quoted.url || quoted.twitterUrl || '' } : null,
    entities: {
      hashtags: (entities.hashtags || []).map((item: any) => `#${item.text}`),
      mentions: (entities.user_mentions || []).map((item: any) => `@${item.screen_name || item.name || ''}`),
      urls: (entities.urls || []).map((item: any) => item.expanded_url || item.url).filter(Boolean),
    },
    metrics: {
      reply: numberOrNull(tweet?.replyCount, post.engagement?.replies),
      retweet: numberOrNull(tweet?.retweetCount, post.engagement?.reposts),
      quote: numberOrNull(tweet?.quoteCount, post.engagement?.quotes),
      like: numberOrNull(tweet?.likeCount, post.engagement?.likes),
      view: numberOrNull(tweet?.viewCount, post.engagement?.views),
      bookmark: numberOrNull(tweet?.bookmarkCount),
    },
    matchedKeywords: post.matched_keywords || [],
    keywordsVersion: post.keywords_version || null,
    isDeleted: Boolean(post.is_deleted),
    raw: post.raw_json ?? post,
  };
}

export function bskyPostUrl(uri: string | null | undefined, actor?: string | null): string {
  if (!uri || !uri.startsWith('at://')) return '';
  const [, , repo, collection, rkey] = uri.split('/');
  if (collection !== 'app.bsky.feed.post' || !rkey) return '';
  return `https://bsky.app/profile/${encodeURIComponent(actor || repo)}/post/${encodeURIComponent(rkey)}`;
}

function blobImageUrl(did: string | null, blob: any): string {
  const cid = blob?.ref?.$link;
  if (!did || !cid) return '';
  const mime = blob.mimeType || 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpeg';
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${cid}@${ext}`;
}

function bskyMedia(embed: any, did: string | null): MediaItem[] {
  if (!embed || typeof embed !== 'object') return [];
  const type = embed.$type;
  if (type === 'app.bsky.embed.images' || type === 'app.bsky.embed.gallery') {
    return (embed.images || []).map((image: any) => ({ type: 'image' as const, url: blobImageUrl(did, image.image), alt: image.alt || '' }));
  }
  if (type === 'app.bsky.embed.video') {
    return [{ type: 'video', url: '', alt: 'Vidéo Bluesky présente dans le post, sans URL de lecture directe dans les données.' }];
  }
  if (type === 'app.bsky.embed.recordWithMedia') return bskyMedia(embed.media, did);
  return [];
}

function bskyExternal(embed: any): PostRecord['external'] {
  if (!embed || typeof embed !== 'object') return null;
  if (embed.$type === 'app.bsky.embed.external' && embed.external) {
    return { title: embed.external.title || '', description: embed.external.description || '', url: embed.external.uri || '' };
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia') return bskyExternal(embed.media);
  return null;
}

function bskyQuote(embed: any): PostRecord['quote'] {
  if (!embed || typeof embed !== 'object') return null;
  if (embed.$type === 'app.bsky.embed.record') return { text: 'Publication citée', author: '', uri: embed.record?.uri || '' };
  if (embed.$type === 'app.bsky.embed.recordWithMedia') return bskyQuote(embed.record);
  return null;
}

function blueskyRecord(post: Post): PostRecord {
  const raw = post.raw_json && typeof post.raw_json === 'object' ? post.raw_json : {};
  const record = raw.record && typeof raw.record === 'object' ? raw.record : raw;
  const did = post.author_id || raw.repo || (String(post.post_id).startsWith('at://') ? String(post.post_id).split('/')[2] : null);
  const handle = post.author_handle && post.author_handle !== 'unknown' ? post.author_handle : did || '';
  const embed = record.embed || null;
  const hashtags: string[] = [];
  const mentions: string[] = [];
  const urls: string[] = [];
  (record.facets || []).forEach((facet: any) => (facet.features || []).forEach((feature: any) => {
    const type = feature.$type || '';
    if (type.endsWith('#tag') && feature.tag) hashtags.push(`#${feature.tag}`);
    if (type.endsWith('#mention') && feature.did) mentions.push(shortDid(feature.did));
    if (type.endsWith('#link') && feature.uri) urls.push(feature.uri);
  }));
  const engagement: any = post.engagement || {};
  // Nom, pseudo et avatar fournis par l'API (résolus auprès de Bluesky à partir du DID).
  const profile = post.author_profile || null;
  return {
    post,
    platform: 'bluesky',
    id: String(post.post_id),
    text: post.text || record.text || '',
    createdAt: post.timestamp || record.createdAt || null,
    collectedAt: post.collected_at || null,
    lang: post.lang && post.lang !== 'unknown' ? post.lang : (record.langs || [])[0] || null,
    source: 'Bluesky',
    collection: post.collection_name,
    author: {
      name: profile?.display_name || profile?.handle || (handle && !handle.startsWith('did:') ? handle : 'Compte Bluesky'),
      handle: profile?.handle ? `@${profile.handle}` : shortDid(handle),
      avatar: profile?.avatar || '',
      verified: false,
      id: did,
    },
    url: bskyPostUrl(String(post.post_id), profile?.handle || (handle && !handle.startsWith('did:') ? handle : did)),
    isReply: Boolean(post.is_reply),
    isRetweet: Boolean(post.is_retweet),
    isQuote: Boolean(post.is_quote),
    parentId: post.reply_to_id || null,
    conversationId: record.reply?.root?.uri || null,
    repostOf: post.subject_uri || record.subject?.uri || null,
    media: [...bskyMedia(embed, did), ...fallbackMedia(post)],
    external: bskyExternal(embed),
    quote: bskyQuote(embed),
    entities: { hashtags: uniq(hashtags), mentions: uniq(mentions), urls: uniq(urls) },
    metrics: {
      reply: numberOrNull(engagement.replies),
      retweet: numberOrNull(engagement.reposts),
      quote: numberOrNull(engagement.quotes),
      like: numberOrNull(engagement.likes),
      view: numberOrNull(engagement.views),
      bookmark: null,
    },
    matchedKeywords: (post.matched_keywords || []).filter((keyword) => !keyword.startsWith('__')),
    keywordsVersion: post.keywords_version || null,
    isDeleted: Boolean(post.is_deleted),
    raw: post.raw_json ?? post,
  };
}

export function toRecord(post: Post): PostRecord {
  return post.platform === 'bluesky' ? blueskyRecord(post) : twitterRecord(post);
}

export function mediaKind(record: PostRecord): 'video' | 'image' | 'none' {
  if (record.media.some((item) => item.type === 'video')) return 'video';
  if (record.media.some((item) => item.type === 'image')) return 'image';
  return 'none';
}
