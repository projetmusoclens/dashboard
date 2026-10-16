import { DashboardData } from '../types';

export const initialDashboardData: DashboardData = {
  title: 'Dashboard World Cup 2026',
  subtitle: 'Données chargées depuis la base de données',
  total_posts: 0,
  by_lang: {},
  by_keyword: {},
  hashtags: {},
  posts_vs_replies: { posts: 0, replies: 0 },
  top_liked: [],
  top_viewed: [],
  posts: [],
  top_authors: {},
  threads: [],
  collection_stats: [],
  engagement_avg: {},
  engagement_sum: {},
};

export const dashboardData = initialDashboardData;

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');

export const fetchDashboardData = async (): Promise<DashboardData> => {
  const url = `${API_BASE_URL}/api/dashboard`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

export const LANG_LABELS: Record<string, string> = {
  en: 'Anglais', es: 'Espagnol', pt: 'Portugais', ar: 'Arabe',
  fr: 'Français', tr: 'Turc', qme: 'Autre', de: 'Allemand', ja: 'Japonais', in: 'Indonésien',
};

export const CHART_COLORS = [
  '#1d9e75', '#2a78d6', '#eda100', '#4a3aa7',
  '#e34948', '#e87ba4', '#eb6834', '#73726c', '#378add', '#639922',
];
