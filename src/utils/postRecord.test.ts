import { Post } from '../types';
import { toRecord } from './postRecord';

const basePost: Post = {
  post_id: '1', author_handle: 'alice', text: 'Salut #FIFA', lang: 'fr', timestamp: '2026-07-04T20:59:09+00:00',
  collection_name: 'twitter_x', is_reply: false, reply_to_id: null, matched_keywords: ['fifa'], has_link: false,
  engagement: { likes: 3, reposts: 1, replies: 0, quotes: 0, views: 40 }, is_deleted: false, platform: 'twitter',
};

test('builds a reader record from a Twitter raw tweet', () => {
  const record = toRecord({ ...basePost, is_quote: true, raw_json: { tweet: {
    type: 'tweet', url: 'https://x.com/alice/status/1', text: 'Salut #FIFA', likeCount: 7,
    author: { name: 'Alice', userName: 'alice', profilePicture: 'https://pbs.twimg.com/a.jpg', isBlueVerified: true },
    entities: { hashtags: [{ text: 'FIFA' }] },
    extendedEntities: { media: [{ type: 'video', media_url_https: 'https://p/x.jpg', video_info: { variants: [{ content_type: 'video/mp4', url: 'https://v/low.mp4', bitrate: 1 }, { content_type: 'video/mp4', url: 'https://v/high.mp4', bitrate: 9 }] } }] },
    quoted_tweet: { text: 'cité', author: { name: 'Bob' }, url: 'https://x.com/bob/status/2' },
  } } });
  expect(record.author).toMatchObject({ name: 'Alice', handle: '@alice', verified: true });
  expect(record.metrics.like).toBe(7);
  expect(record.media).toEqual([{ type: 'video', url: 'https://v/high.mp4', poster: 'https://p/x.jpg', alt: 'Vidéo associée au tweet' }]);
  expect(record.quote).toEqual({ text: 'cité', author: 'Bob', uri: 'https://x.com/bob/status/2' });
  expect(record.entities.hashtags).toEqual(['#FIFA']);
});

test('builds a reader record from a Bluesky post and repost', () => {
  const did = 'did:plc:abc';
  const post = toRecord({ ...basePost, platform: 'bluesky', post_id: `at://${did}/app.bsky.feed.post/3k`, author_handle: did, author_id: did, engagement: { likes: null, reposts: null, replies: null, quotes: null, views: null },
    raw_json: { $type: 'app.bsky.feed.post', embed: { $type: 'app.bsky.embed.images', images: [{ alt: 'img', image: { ref: { $link: 'cid1' }, mimeType: 'image/png' } }] }, facets: [{ features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'wc' }] }] } });
  expect(post.url).toBe(`https://bsky.app/profile/${encodeURIComponent(did)}/post/3k`);
  expect(post.media[0].url).toBe(`https://cdn.bsky.app/img/feed_fullsize/plain/${did}/cid1@png`);
  expect(post.entities.hashtags).toEqual(['#wc']);
  expect(post.metrics.like).toBeNull();
  expect(post.author.name).toBe('Compte Bluesky');
  const named = toRecord({ ...basePost, platform: 'bluesky', post_id: `at://${did}/app.bsky.feed.post/3k`, author_handle: did, author_id: did, author_profile: { handle: 'alice.bsky.social', display_name: 'Alice', avatar: 'https://cdn.bsky.app/a.jpg' }, raw_json: {} });
  expect(named.author).toMatchObject({ name: 'Alice', handle: '@alice.bsky.social', avatar: 'https://cdn.bsky.app/a.jpg' });
  expect(named.url).toBe('https://bsky.app/profile/alice.bsky.social/post/3k');
  const repost = toRecord({ ...basePost, platform: 'bluesky', text: '', is_retweet: true, subject_uri: `at://${did}/app.bsky.feed.post/9z`, raw_json: { record: { $type: 'app.bsky.feed.repost' } } });
  expect(repost.isRetweet).toBe(true);
  expect(repost.repostOf).toBe(`at://${did}/app.bsky.feed.post/9z`);
});
