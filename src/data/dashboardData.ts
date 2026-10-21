import { DashboardData, StatsResponse } from '../types';

export const emptyDashboardData: DashboardData = {
  total_posts: 0,
  by_lang: {},
  by_platform: {},
  by_keyword: {},
  hashtags: {},
  posts_vs_replies: { posts: 0, replies: 0 },
  top_authors: {},
  collection_stats: [],
  engagement_avg: {},
  engagement_sum: {},
};

// L'API renvoie les auteurs en liste [{ author, count }] ; la vue globale les attend en objet { auteur: nombre }.
export function normalizeTopAuthors(value: { author: string; count: number }[] | Record<string, number> | undefined): Record<string, number> {
  if (Array.isArray(value)) {
    return value.reduce((authors, item) => {
      if (item?.author) authors[item.author] = Number(item.count) || 0;
      return authors;
    }, {} as Record<string, number>);
  }
  return value || {};
}

// Données de la vue globale à partir de la réponse de /api/stats.
export function buildDashboardData(stats: StatsResponse): DashboardData {
  return {
    total_posts: stats.total_posts || 0,
    by_lang: stats.by_lang || {},
    by_platform: stats.by_platform || {},
    by_keyword: stats.by_keyword || {},
    hashtags: stats.hashtags || {},
    posts_vs_replies: stats.posts_vs_replies || { posts: 0, replies: 0 },
    by_type: stats.by_type,
    top_authors: normalizeTopAuthors(stats.top_authors),
    collection_stats: stats.collection_stats || [],
    engagement_avg: stats.engagement_avg || {},
    engagement_sum: stats.engagement_sum || {},
  };
}

export const LANG_LABELS: Record<string, string> = {
  en: 'Anglais', es: 'Espagnol', pt: 'Portugais', ar: 'Arabe',
  fr: 'Français', tr: 'Turc', de: 'Allemand', ja: 'Japonais', id: 'Indonésien',
};

export const CHART_COLORS = [
  '#1d9e75', '#2a78d6', '#eda100', '#4a3aa7',
  '#e34948', '#e87ba4', '#eb6834', '#73726c', '#378add', '#639922',
  '#0f8b8d', '#b5179e', '#8d6e00', '#5c7cfa', '#c2410c', '#4d7c0f',
];
