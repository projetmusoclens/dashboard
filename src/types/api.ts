// Formats des requêtes et réponses de l'API (les modèles métier sont dans index.ts).
import { CollectionStats, Post, PostKind, PostSort, PostTypeCounts } from './index';

export type UserRole = 'admin' | 'annotateur';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  annotations?: number;
}

export interface StoredAnnotation {
  user_id: string;
  username: string;
  platform: 'twitter' | 'bluesky';
  post_id: string;
  status: 'a_analyser' | 'analyse' | 'a_discuter';
  relevance: '' | 'oui' | 'non' | 'incertain';
  theme: string;
  tone: string;
  interaction: string;
  keywords: string;
  note: string;
  updated_at: string;
  created_at?: string;
  post?: { text: string; author_handle: string; timestamp: string; collection_name: string; lang: string } | null;
}

export interface QueryParams {
  collectionId?: string;
  platform?: string;
  lang?: string;
  startDate?: string;
  endDate?: string;
}

export interface Collection {
  id: string;
  name: string;
  count: number;
}

export interface StatsResponse {
  total_posts: number;
  by_platform: Record<string, number>;
  by_lang: Record<string, number>;
  by_keyword: Record<string, number>;
  hashtags: Record<string, number>;
  top_authors: { author: string; count: number }[];
  collection_stats: CollectionStats[];
  posts_vs_replies: { posts: number; replies: number };
  by_type?: PostTypeCounts;
  engagement_avg: Record<string, number | null>;
  engagement_sum: Record<string, number | null>;
}

export interface TimelinePoint {
  ts: number;
  date: string;
  total: number;
  [platform: string]: number | string;
}

export interface TimelineResponse {
  bucket_minutes: number;
  excluded: number;
  platforms: string[];
  points: TimelinePoint[];
}

export interface PostsQuery extends QueryParams {
  limit?: number;
  skip?: number;
  sort?: PostSort;
  q?: string;
  kind?: PostKind;
}

export type GraphType = 'hashtags' | 'mentions';

export interface GraphQuery extends QueryParams {
  maxNodes?: number;
  minEdgeWeight?: number;
}

export interface GraphResponse {
  nodes: { id: string; label: string; value: number }[];
  links: { source: string; target: string; value: number }[];
  // Volume avant plafonnement : nombre total de nœuds et d'arêtes pour ces filtres.
  total_nodes?: number;
  total_links?: number;
}

export type SubgraphPost = Post & { subgraph_nodes: string[]; subgraph_edges: string[] };

export interface SubgraphPostsResponse {
  type: GraphType;
  posts: SubgraphPost[];
  matched: number;
  truncated: boolean;
}

export type ConversationSort = 'replies' | 'participants' | 'depth' | 'likes' | 'recent';

export interface ConversationQuery extends QueryParams {
  q?: string;
  sort?: ConversationSort;
  minReplies?: number;
  root?: '' | 'collected' | 'missing';
  limit?: number;
  skip?: number;
}

// Racine d'une conversation : post collecté, ou parent absent de la base (missing).
export type ConversationRoot = Post | { post_id: string; platform: string; author_handle: string | null; url: string; missing: true };

export interface ConversationSummary {
  root_id: string;
  root_missing: boolean;
  root: ConversationRoot;
  platform: string;
  reply_count: number;
  direct_replies: number;
  participants: number;
  depth: number;
  first_at: string | null;
  last_at: string | null;
  likes: number;
}

export interface ConversationList {
  total: number;
  stats: { conversations: number; replies: number; collected_roots: number };
  items: ConversationSummary[];
}

export interface ConversationDetail {
  root_id: string;
  root_missing: boolean;
  root: ConversationRoot;
  posts: Post[];
  truncated: boolean;
  highlight: string | null;
}
