import {
  AnnotationShares, Collection, PostAnnotations, SharedPostRef, UserProfile, ConversationBranch, ConversationDetail, ConversationList, ConversationQuery, GraphQuery, GraphResponse, GraphType,
  Post, PostsQuery, QueryParams, StatsResponse, StoredAnnotation, SubgraphPostsResponse, TimelineResponse, User, UserRole,
} from '../types';

// Accès à l'API : les composants n'appellent que les fonctions de l'objet `api` (export par défaut).
// Seuls le stockage du jeton et l'événement de session sont exportés à part, pour l'écran de connexion.

const API_BASE = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');
const TOKEN_KEY = 'dashboard-session';
export const AUTH_REQUIRED_EVENT = 'dashboard-auth-required';

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

// Données en préparation sur le serveur (première construction après un déploiement) : nouvel essai
// toutes les 10 s pendant 10 min au plus, l'écran reste en chargement.
const PREPARING_RETRY_MS = 10000;
const PREPARING_MAX_TRIES = 60;
const wait = (ms: number) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

// Appel authentifié : ajoute le jeton, renvoie à l'écran de connexion sur 401 et remonte le message d'erreur de l'API.
async function request<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}, attempt = 1): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data?.preparing && attempt < PREPARING_MAX_TRIES) {
    await wait(PREPARING_RETRY_MS);
    return request<T>(path, { method, body }, attempt + 1);
  }
  if (!res.ok) throw new Error(data?.error || `Erreur API ${res.status}`);
  return data as T;
}

async function getSession(): Promise<User | null> {
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

async function login(username: string, password: string): Promise<{ token: string; user: User } | 'invalid' | 'locked'> {
  const res = await fetch(`${API_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (res.status === 401) return 'invalid';
  if (res.status === 429) return 'locked';
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

type AnnotationFields = Pick<StoredAnnotation, 'status' | 'relevance' | 'theme' | 'tone' | 'interaction' | 'keywords' | 'note'>;

const api = {
  // Session et comptes
  getSession,
  login,
  changePassword: (current: string, next: string) => request<{ token: string; user: User }>('/api/auth/password', { method: 'POST', body: { current, next } }),
  listUsers: () => request<{ users: User[] }>('/api/users'),
  createUser: (input: { username: string; name: string; password: string; role: UserRole }) => request<{ user: User }>('/api/users', { method: 'POST', body: input }),
  updateUser: (id: string, patch: Partial<{ name: string; role: UserRole; active: boolean; password: string }>) =>
    request<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  // Annotations de l'utilisateur connecté (scope=all : toute l'équipe, administrateurs)
  getAnnotations: (scope: 'mine' | 'all' = 'mine') => request<{ annotations: StoredAnnotation[] }>(`/api/annotations${scope === 'all' ? '?scope=all' : ''}`),
  // Champs d'annotation envoyés à l'API (statut, pertinence, thème, tonalité, interaction, mots-clés, commentaire).
  createAnnotation: (platform: string, postId: string, fields: AnnotationFields) =>
    request<{ annotation: StoredAnnotation }>('/api/annotations', { method: 'POST', body: { ...fields, platform, post_id: postId } }),
  updateAnnotation: (id: string, fields: AnnotationFields) => request<{ annotation: StoredAnnotation }>(`/api/annotations/${encodeURIComponent(id)}`, { method: 'PUT', body: fields }),
  deleteAnnotation: (id: string) => request<{ ok: true }>(`/api/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  shareAnnotation: (id: string, userIds: string[], includeNotes: boolean) =>
    request<{ annotation: StoredAnnotation }>(`/api/annotations/${encodeURIComponent(id)}/share`, { method: 'PUT', body: { user_ids: userIds, include_notes: includeNotes } }),
  getPostAnnotations: (platform: string, postId: string) => request<PostAnnotations>(`/api/annotations/post${buildQuery({ platform, post_id: postId })}`),
  getSharedWithMe: () => request<{ posts: SharedPostRef[] }>('/api/annotations/shared-with-me'),
  getDirectory: () => request<{ users: UserProfile[] }>('/api/users/directory'),
  getShares: () => request<AnnotationShares>('/api/annotations/shares'),
  setShares: (userIds: string[], includeNotes: boolean) =>
    request<{ shared_with: string[]; include_notes: boolean }>('/api/annotations/shares', { method: 'PUT', body: { user_ids: userIds, include_notes: includeNotes } }),
  importAnnotations: (items: unknown[]) => request<{ imported: number; skipped: number }>('/api/annotations/import', { method: 'POST', body: { items } }),
  exportAnnotations: (scope: 'mine' | 'all') => request<{ annotations: StoredAnnotation[] }>(`/api/annotations/export${scope === 'all' ? '?scope=all' : ''}`),

  // Données
  getCollections: () => request<{ collections: Collection[] }>('/api/collections'),
  getStats: (params: QueryParams) => request<StatsResponse>(`/api/stats${buildQuery(params)}`),
  getPosts: (params: PostsQuery) => request<Post[]>(`/api/posts${buildQuery(params)}`),
  getTimeline: (params: QueryParams) => request<TimelineResponse>(`/api/stats/timeline${buildQuery(params)}`),
  getGraph: (type: GraphType, params: GraphQuery) => request<GraphResponse>(`/api/graph${buildQuery({ type, ...params })}`),
  getSubgraphPosts: (type: GraphType, nodes: string[], params: QueryParams & { includeRaw?: boolean; limit?: number }) =>
    request<SubgraphPostsResponse>('/api/graph/subgraph', { method: 'POST', body: { type, nodes, ...params } }),
  getConversations: (params: ConversationQuery) => request<ConversationList>(`/api/conversations${buildQuery(params)}`),
  getConversation: (params: { rootId?: string; postId?: string }) => request<ConversationDetail>(`/api/conversation${buildQuery(params)}`),
  getConversationBranch: (rootId: string, branch: string) => request<ConversationBranch>(`/api/conversation${buildQuery({ rootId, branch })}`),
  // Conversation entière (sans limite d'affichage), générée par l'API : renvoie le fichier et son nom.
  exportConversation: async (rootId: string, format: 'csv' | 'json', includeRaw: boolean) => {
    const res = await fetch(`${API_BASE}/api/conversation/export${buildQuery({ rootId, format, ...(includeRaw ? { includeRaw: '1' } : {}) })}`, { headers: { Authorization: `Bearer ${getStoredToken()}` } });
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Erreur API ${res.status}`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `conversation.${format}`;
    return { blob: await res.blob(), name };
  },
};

export default api;
