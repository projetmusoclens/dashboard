import { CollectionStats, Post, PostKind, PostSort, PostTypeCounts, Thread } from '../types';

const API_BASE = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');
const PASSWORD_KEY = 'dashboard-password';
export const AUTH_REQUIRED_EVENT = 'dashboard-auth-required';

export function getStoredPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) || '';
  } catch {
    return '';
  }
}

export function storePassword(password: string) {
  try {
    if (password) sessionStorage.setItem(PASSWORD_KEY, password);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Stockage indisponible : le mot de passe sera redemandé au prochain chargement.
  }
}

// Ajoute le mot de passe à chaque appel ; un 401 renvoie à l'écran de connexion.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const password = getStoredPassword();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  if (password) headers.Authorization = `Bearer ${password}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  return res;
}

export async function checkPassword(password: string): Promise<'ok' | 'invalid' | 'locked'> {
  const res = await fetch(`${API_BASE}/api/auth/check`, {
    headers: password ? { Authorization: `Bearer ${password}` } : {},
  });
  if (res.ok) return 'ok';
  if (res.status === 429) return 'locked';
  if (res.status === 401) return 'invalid';
  throw new Error(`API error: ${res.status}`);
}

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

const api = { getCollections, getStats, getPosts, getTimeline, getThreads, getGraph, getSubgraphPosts };
export default api;
