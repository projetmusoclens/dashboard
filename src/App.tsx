import React, { useEffect, useMemo, useState } from 'react';
import { BarChart2, MessageSquare, GitBranch, Moon, Sun, CircleHelp } from 'lucide-react';
import { TabId, Post, DashboardData } from './types';
import { dashboardData as initialDashboardData } from './data/dashboardData';
import api from './services/api';
import OverviewTab from './components/OverviewTab';
import ExplorerTab from './components/ExplorerTab';
import ThreadsTab from './components/ThreadsTab';
import GraphsTab from './components/GraphsTab';
import GuidedTour from './components/GuidedTour';
import DashboardFilters from './components/DashboardFilters';
import { fmtNum } from './utils/format';
import { GraphResponse, QueryParams, TimelineResponse } from './services/api';
import './App.css';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Vue globale', icon: <BarChart2 size={15} /> },
  { id: 'posts', label: 'Explorer', icon: <MessageSquare size={15} /> },
  { id: 'threads', label: 'Threads', icon: <GitBranch size={15} /> },
  { id: 'graphs', label: 'Graphes', icon: <GitBranch size={15} /> },
];

// Les graphes chargent jusqu'à 2000 nœuds ; l'onglet Graphes en affiche une partie réglable.
const GRAPH_MAX_NODES = 2000;

function normalizeTopAuthors(value: { author: string; count: number }[] | Record<string, number> | undefined): Record<string, number> {
  if (Array.isArray(value)) {
    return value.reduce((authors, item) => {
      if (item?.author) authors[item.author] = Number(item.count) || 0;
      return authors;
    }, {} as Record<string, number>);
  }
  return value || {};
}

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData>(initialDashboardData);
  const [darkMode, setDarkMode] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [graphSubtitle, setGraphSubtitle] = useState('Relations de mentions');
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [collections, setCollections] = useState<{ id: string; name: string; count: number }[]>([]);
  const [platform, setPlatform] = useState<string>('');
  const [lang, setLang] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loadingWidgets, setLoadingWidgets] = useState(false);
  const [graphs, setGraphs] = useState<{ hashtags: GraphResponse; mentions: GraphResponse } | null>(null);

  // Load collections and initial stats/posts/timeline
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoadingData(true);
      try {
        const colsResp = await api.getCollections();
        const cols = colsResp.collections || [];
        if (!mounted) return;
        setCollections(cols);
        // default to all collections
        setSelectedCollection('');

        // fetch stats and posts for initial selection (or global)
        const params: any = {};
        const stats = await api.getStats(params);
        const posts = await api.getPosts({ limit: 200 });

        const computed: DashboardData = {
          title: initialDashboardData.title,
          subtitle: initialDashboardData.subtitle,
          total_posts: stats.total_posts,
          by_lang: stats.by_lang || {},
          by_platform: stats.by_platform || {},
          by_keyword: stats.by_keyword || {},
          hashtags: stats.hashtags || {},
          posts_vs_replies: stats.posts_vs_replies,
          by_type: stats.by_type,
          top_liked: (posts || []).slice().sort((a: Post, b: Post) => (b.engagement.likes || 0) - (a.engagement.likes || 0)).slice(0, 50),
          top_viewed: (posts || []).slice().sort((a: Post, b: Post) => (b.engagement.views || 0) - (a.engagement.views || 0)).slice(0, 50),
          posts: posts || [],
          top_authors: normalizeTopAuthors(stats.top_authors),
          threads: [],
          collections: cols,
          collection_stats: stats.collection_stats,
          engagement_avg: stats.engagement_avg,
          engagement_sum: stats.engagement_sum,
        };

        setDashboardData(computed);
        setLoadingData(false);
      } catch (err: any) {
        console.error('Impossible de récupérer les données depuis l’API backend :', err);
        setLoadingError(err.message || String(err));
        setLoadingData(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const filters = useMemo<QueryParams>(() => ({
    ...(selectedCollection ? { collectionId: selectedCollection } : {}),
    ...(platform ? { platform } : {}),
    ...(lang ? { lang } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }), [selectedCollection, platform, lang, startDate, endDate]);

  // refetch when filters change (collection, platform, lang, date range)
  useEffect(() => {
    let mounted = true;
    const loadFilters = async () => {
      setLoadingWidgets(true);
      try {
        const params = filters;

        const [stats, posts, tl, threads, hashtagGraph, mentionGraph] = await Promise.all([
          api.getStats(params),
          api.getPosts({ ...params, limit: 200 }),
          api.getTimeline(params),
          api.getThreads(params),
          api.getGraph('hashtags', { ...params, maxNodes: GRAPH_MAX_NODES }),
          api.getGraph('mentions', { ...params, maxNodes: GRAPH_MAX_NODES }),
        ]);

        if (!mounted) return;
        const computed: DashboardData = {
          title: initialDashboardData.title,
          subtitle: initialDashboardData.subtitle,
          total_posts: stats.total_posts,
          by_lang: stats.by_lang || {},
          by_platform: stats.by_platform || {},
          by_keyword: stats.by_keyword || {},
          hashtags: stats.hashtags || {},
          posts_vs_replies: stats.posts_vs_replies,
          by_type: stats.by_type,
          top_liked: (posts || []).slice().sort((a: Post, b: Post) => (b.engagement.likes || 0) - (a.engagement.likes || 0)).slice(0, 50),
          top_viewed: (posts || []).slice().sort((a: Post, b: Post) => (b.engagement.views || 0) - (a.engagement.views || 0)).slice(0, 50),
          posts: posts || [],
          top_authors: normalizeTopAuthors(stats.top_authors),
          threads,
          collections,
          collection_stats: stats.collection_stats,
          engagement_avg: stats.engagement_avg,
          engagement_sum: stats.engagement_sum,
        };
        setDashboardData(computed);
        setTimeline(tl || null);
        setGraphs({ hashtags: hashtagGraph, mentions: mentionGraph });
      } catch (err: any) {
        console.error('Filter load error', err);
      } finally {
        if (mounted) setLoadingWidgets(false);
      }
    };
    loadFilters();
    return () => { mounted = false; };
  }, [filters, collections]);

  useEffect(() => {
    if (!selectedPost) return;
    api.getThreads({ postId: selectedPost.post_id })
      .then((threads) => setDashboardData((current) => ({ ...current, threads })))
      .catch((error) => console.error('Thread load error', error));
  }, [selectedPost]);

  const handleSelectPost = (post: Post) => {
    setSelectedPost(post);
    setActiveTab('threads');
  };

  useEffect(() => {
    const activeTabLabel = TABS.find(t => t.id === activeTab)?.label;
    document.title = `${dashboardData.title} · ${activeTabLabel ?? 'Dashboard'}`;
  }, [dashboardData.title, activeTab]);

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-mark">H</div>
          <div>
            <div className="app-name">{dashboardData.title}</div>
            <div className="app-sub">{dashboardData.subtitle}</div>
          </div>
        </div>

        <nav className="nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="db-badge">
            <span className="db-dot" />
            {dashboardData.subtitle}
          </div>
          <div className="stat-row">
            <span>{fmtNum(dashboardData.total_posts)} posts</span>
            <span>{Object.keys(dashboardData.by_platform || {}).join(' / ') || 'Plateformes inconnues'}</span>
          </div>
          <div className="stat-row">
            <span>Données MongoDB</span>
          </div>
          <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            {darkMode ? 'Mode clair' : 'Mode sombre'}
          </button>
          <button className="theme-toggle" onClick={() => setTourOpen(true)}>
            <CircleHelp size={14} />
            Prise en main
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="page-header">
          <div>
            <h1 className="page-title">
              {dashboardData.title} · {TABS.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="page-sub">
              {activeTab === 'overview' && `${dashboardData.subtitle} · Analyse des données collectées · FIFA World Cup 2026 Opening Ceremony`}
              {activeTab === 'posts' && 'Lire, qualifier et annoter les publications X et Bluesky de la sélection'}
              {activeTab === 'threads' && (selectedPost ? `Thread de @${selectedPost.author_handle}` : `${dashboardData.threads.length} threads actifs collectés`)}
              {activeTab === 'graphs' && graphSubtitle}
            </p>
            <DashboardFilters
              collections={collections}
              languages={dashboardData.by_lang || {}}
              selectedCollection={selectedCollection}
              platform={platform}
              language={lang}
              startDate={startDate}
              endDate={endDate}
              onCollectionChange={setSelectedCollection}
              onPlatformChange={setPlatform}
              onLanguageChange={setLang}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />
            <div className="page-highlight">
              <span className="db-dot" />
              <span>Surveillance claire · points clés mis en avant</span>
              {loadingWidgets && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Mise à jour...</span>}
            </div>
          </div>
        </div>

        <div className="content">
          {loadingData && (
            <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
              Chargement des données depuis MongoDB...
            </div>
          )}
          {loadingError && (
            <div style={{ padding: '2rem', color: '#e34948' }}>
              Erreur de chargement : {loadingError}
            </div>
          )}
          {!loadingData && !loadingError && (
            <>
              {activeTab === 'overview' && <OverviewTab data={dashboardData} selectedCollection={selectedCollection} timeline={timeline} />}
              {activeTab === 'posts' && (
                <ExplorerTab
                  filters={filters}
                  platformCounts={dashboardData.by_platform || {}}
                  onOpenThread={handleSelectPost}
                />
              )}
              {activeTab === 'threads' && (
                <ThreadsTab
                  threads={dashboardData.threads}
                  highlightedPost={selectedPost}
                />
              )}
              {activeTab === 'graphs' && (
                <GraphsTab posts={dashboardData.posts} graphData={graphs || undefined} filters={filters} onGraphChange={setGraphSubtitle} />
              )}
            </>
          )}
        </div>
      </main>
      <GuidedTour open={tourOpen} onNavigate={setActiveTab} onClose={() => setTourOpen(false)} />
    </div>
  );
}

export default App;
