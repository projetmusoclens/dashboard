export interface Engagement {
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  views: number | null;
}

export interface CollectionContext {
  collection_name: string | null;
  event: string | null;
  platform: string;
  started_at: string | null;
}

export interface CollectionStats {
  collection_name: string;
  count: number;
  reposts: number;
  quotes: number;
  emojis: number;
  links: number;
  link_rate: number;
}

export interface Post {
  post_id: string;
  author_handle: string;
  text: string;
  lang: string;
  timestamp: string;
  createdAt?: string | null;
  platform?: string;
  collection_name: string;
  collection_context?: CollectionContext;
  id?: string;
  author?: string;
  is_reply: boolean;
  reply_to_id: string | null;
  is_retweet?: boolean;
  is_quote?: boolean;
  event_type?: string | null;
  subject_uri?: string | null;
  author_id?: string | null;
  collected_at?: string | null;
  keywords_version?: string | null;
  raw_json?: any;
  matched_keywords: string[];
  has_link: boolean;
  image_url?: string;
  image_urls?: string[];
  media_url?: string;
  media_urls?: string[];
  video_urls?: string[];
  engagement: Engagement;
  is_deleted: boolean;
}

export interface PostTypeCounts {
  original: number;
  replies: number;
  retweets: number;
  quotes: number;
}

export interface Thread {
  parent: Post;
  replies: Post[];
}

export interface DashboardData {
  title: string;
  subtitle: string;
  total_posts: number;
  by_lang: Record<string, number>;
  by_platform?: Record<string, number>;
  by_keyword: Record<string, number>;
  hashtags: Record<string, number>;
  posts_vs_replies: { posts: number; replies: number };
  by_type?: PostTypeCounts;
  top_liked: Post[];
  top_viewed: Post[];
  posts: Post[];
  top_authors: Record<string, number>;
  threads: Thread[];
  collections?: { id: string; name: string; count: number }[];
  collection_stats: CollectionStats[];
  engagement_avg: Partial<Engagement>;
  engagement_sum: Partial<Engagement>;
}

export type SortKey = 'likes' | 'views' | 'reposts' | 'replies';
export type PostSort = SortKey | 'date';
export type PostKind = 'original' | 'reply' | 'retweet' | 'quote';
export type TabId = 'overview' | 'posts' | 'threads' | 'graphs' | 'users';
