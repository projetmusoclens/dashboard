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

// Une annotation : un même post peut en recevoir plusieurs, de la même personne ou d'autres.
export interface StoredAnnotation {
  id: string;
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
  created_at: string;
  post?: { text: string; author_handle: string; timestamp: string; collection_name: string; lang: string } | null;
  // Annotations d'une autre personne : son nom affiché.
  name?: string;
  // Personnes avec qui cette annotation précise est partagée, et si le commentaire libre l'est aussi
  // (visibles par son auteur seulement).
  shared_with?: string[];
  share_notes?: boolean;
  // Annotation reçue dont le commentaire libre n'est pas partagé.
  note_hidden?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  name: string;
}

// Post dont une annotation d'une autre personne m'est visible.
export interface SharedPostRef {
  platform: 'twitter' | 'bluesky';
  post_id: string;
  owners: string[];
  updated_at: string;
}

export interface AnnotationShares {
  shared_with: UserProfile[];
  // « Tout partager » inclut-il les commentaires libres ?
  include_notes: boolean;
  shared_with_me: UserProfile[];
}

// Pour un post : mes annotations et celles des autres qui me sont visibles, des plus récentes aux plus anciennes.
export interface PostAnnotations {
  mine: StoredAnnotation[];
  shared: StoredAnnotation[];
}

export interface QueryParams {
  collectionId?: string;
  platform?: string;
  lang?: string;
  startDate?: string;
  endDate?: string;
  // Bornes horaires précises (ISO) : fenêtre de temps du graphe dynamique.
  startTime?: string;
  endTime?: string;
}

export interface Collection {
  id: string;
  name: string;
  count: number;
  // Événement de la collecte (collection_context.event), '' s'il n'est pas renseigné.
  event?: string;
  // Date du premier post, pour ordonner les événements.
  first_at?: string | null;
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

// Fiche d'un événement de collecte (match) et son déroulé.
export type EventMomentKind = 'kickoff' | 'goal' | 'penalty' | 'yellow_card' | 'red_card' | 'substitution' | 'var' | 'halftime' | 'second_half' | 'extra_time' | 'shootout' | 'end' | 'other';

export interface EventMoment {
  time: string;
  kind: EventMomentKind;
  minute: string;
  team: string;
  label: string;
}

export interface EventSheet {
  event: string;
  title: string;
  teams: string[];
  stage: string;
  venue: string;
  kickoff_at: string | null;
  score: string;
  summary: string;
  keywords: string;
  collections: string;
  notes: string;
  moments: EventMoment[];
  source: string;
  customized: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface TimelineResponse {
  bucket_minutes: number;
  excluded: number;
  platforms: string[];
  points: TimelinePoint[];
}

export interface PostsQuery extends QueryParams {
  // Identifiants de posts séparés par des virgules (500 au plus).
  ids?: string;
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
  // Graphe dynamique : séries par tranche de temps.
  temporal?: 1;
  bucketMinutes?: number;
  peaks?: number;
}

// Série creuse : [indice de tranche, nombre de posts], triée par tranche.
export type TimeSeries = [number, number][];

export interface GraphTime {
  start: string | null;
  bucket_minutes: number;
  buckets: number;
  // Nombre de posts (filtres actifs) par tranche.
  volume: number[];
  // Posts sans date ou aux dates aberrantes, écartés.
  excluded: number;
}

export interface GraphResponse {
  nodes: { id: string; label: string; value: number; series?: TimeSeries }[];
  links: { source: string; target: string; value: number; series?: TimeSeries }[];
  // Volume avant plafonnement : nombre total de nœuds et d'arêtes pour ces filtres.
  total_nodes?: number;
  // null : non calculé (gros corpus : seules les relations entre les nœuds affichés sont comptées).
  total_links?: number | null;
  time?: GraphTime;
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
  // Posts affichés : les premiers niveaux (5 000 au plus) et le chemin vers le post mis en évidence.
  posts: Post[];
  truncated: boolean;
  highlight: string | null;
  // Réponses directes non chargées, par post ; chargées ensuite branche par branche.
  pending?: Record<string, number>;
  // Nombre total de réponses de la conversation.
  total_posts?: number;
  // Résumé calculé sur toute la conversation, pas seulement sur les posts chargés.
  stats?: { replies: number; participants: number; depth: number; first_at: string | null; last_at: string | null };
}

export interface ConversationBranch {
  root_id: string;
  branch: string;
  posts: Post[];
  pending: Record<string, number>;
  truncated: boolean;
}
