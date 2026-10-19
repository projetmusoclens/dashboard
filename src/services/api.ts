import { CollectionStats, Post, PostKind, PostSort, PostTypeCounts, Thread } from '../types';

const API_BASE = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');
const TOKEN_KEY = 'dashboard-session';
export const AUTH_REQUIRED_EVENT = 'dashboard-auth-required';

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

// Jeton de session conservé 7 jours dans le navigateur (localStorage).
export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function storeToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Stockage indisponible : il faudra se reconnecter au prochain chargement.
  }
}

// Ajoute le jeton à chaque appel ; un 401 renvoie à l'écran de connexion.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  return res;
}

// Appel JSON qui remonte le message d'erreur de l'API.
async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, init.body ? { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) } } : init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Erreur API ${res.status}`);
  return body as T;
}

export async function getSession(): Promise<User | null> {
  if (!getStoredToken()) {
    // Réveille l'API (offre gratuite) pour distinguer « pas de session » de « serveur injoignable ».
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return null;
  }
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${getStoredToken()}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return (await res.json()).user;
}

export async function login(username: string, password: string): Promise<{ token: string; user: User } | 'invalid' | 'locked'> {
  const res = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (res.status === 401) return 'invalid';
  if (res.status === 429) return 'locked';
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const changePassword = (current: string, next: string) =>
  apiJson<{ token: string; user: User }>('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });

export const listUsers = () => apiJson<{ users: User[] }>('/api/users');
export const createUser = (input: { username: string; name: string; password: string; role: UserRole }) =>
  apiJson<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(input) });
export const updateUser = (id: string, patch: Partial<{ name: string; role: UserRole; active: boolean; password: string }>) =>
  apiJson<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

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

export const getAnnotations = (scope: 'mine' | 'all' = 'mine') =>
  apiJson<{ annotations: StoredAnnotation[] }>(`/api/annotations${scope === 'all' ? '?scope=all' : ''}`);
export const saveAnnotation = (annotation: Partial<Omit<StoredAnnotation, 'platform'>> & { platform: string; post_id: string }) =>
  apiJson<{ annotation: StoredAnnotation }>('/api/annotations', { method: 'PUT', body: JSON.stringify(annotation) });
export const deleteAnnotation = (platform: string, postId: string) =>
  apiJson<{ ok: true }>('/api/annotations', { method: 'DELETE', body: JSON.stringify({ platform, post_id: postId }) });
export const importAnnotations = (items: unknown[]) =>
  apiJson<{ imported: number; skipped: number }>('/api/annotations/import', { method: 'POST', body: JSON.stringify({ items }) });
export const exportAnnotations = (scope: 'mine' | 'all') =>
  apiJson<{ annotations: StoredAnnotation[] }>(`/api/annotations/export${scope === 'all' ? '?scope=all' : ''}`);

export interface QueryParams {
  collectionId?: string;
  platform?: string;
  lang?: string;
  startDate?: string;
  endDate?: string;
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

export type SubgraphPost = Post & { subgraph_nodes: string[]; subgraph_edges: string[] };

export interface SubgraphPostsResponse {
  type: 'hashtags' | 'mentions';
  posts: SubgraphPost[];
  matched: number;
  truncated: boolean;
}

export type ConversationSort = 'replies' | 'participants' | 'depth' | 'likes' | 'recent';

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

export interface GraphResponse {
  nodes: { id: string; label: string; value: number }[];
  links: { source: string; target: string; value: number }[];
}

function buildQuery(params: object) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    if (v === '') return;
    q.append(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function getCollections(): Promise<{ collections: { id: string; name: string; count: number }[] }> {
  const res = await apiFetch(`/api/collections`);
  if (!res.ok) throw new Error('Failed to load collections');
  return res.json();
}

export async function getStats(params: QueryParams): Promise<StatsResponse> {
  const q = buildQuery(params);
  const res = await apiFetch(`/api/stats${q}`);
  if (!res.ok) throw new Error('Failed to load stats');
  return res.json();
}

export async function getPosts(params: PostsQuery): Promise<Post[]> {
  const q = buildQuery(params);
  const res = await apiFetch(`/api/posts${q}`);
  if (!res.ok) throw new Error('Failed to load posts');
  return res.json();
}

export async function getTimeline(params: QueryParams): Promise<TimelineResponse> {
  const q = buildQuery(params);
  const res = await apiFetch(`/api/stats/timeline${q}`);
  if (!res.ok) throw new Error('Failed to load timeline');
  return res.json();
}

export async function getThreads(params: QueryParams & { postId?: string }): Promise<Thread[]> {
  const q = buildQuery(params);
  const res = await apiFetch(`/api/threads${q}`);
  if (!res.ok) throw new Error('Failed to load threads');
  return res.json();
}

export async function getGraph(type: 'hashtags' | 'mentions', params: QueryParams & { maxNodes?: number }): Promise<GraphResponse> {
  const q = buildQuery({ type, ...params });
  const res = await apiFetch(`/api/graph${q}`);
  if (!res.ok) throw new Error('Failed to load graph');
  return res.json();
}

export async function getSubgraphPosts(type: 'hashtags' | 'mentions', nodes: string[], params: QueryParams & { includeRaw?: boolean; limit?: number }): Promise<SubgraphPostsResponse> {
  const res = await apiFetch('/api/graph/subgraph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, nodes, ...params }),
  });
  if (!res.ok) throw new Error('Failed to load subgraph posts');
  return res.json();
}

export async function getConversations(params: QueryParams & { q?: string; sort?: ConversationSort; minReplies?: number; root?: '' | 'collected' | 'missing'; limit?: number; skip?: number }): Promise<ConversationList> {
  const res = await apiFetch(`/api/conversations${buildQuery(params)}`);
  if (!res.ok) throw new Error('Failed to load conversations');
  return res.json();
}

export async function getConversation(params: { rootId?: string; postId?: string }): Promise<ConversationDetail> {
  const res = await apiFetch(`/api/conversation${buildQuery(params)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Conversation introuvable' : 'Failed to load conversation');
  return res.json();
}

const api = { getConversations, getConversation, getCollections, getStats, getPosts, getTimeline, getThreads, getGraph, getSubgraphPosts };
export default api;
