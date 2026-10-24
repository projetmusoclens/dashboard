import React, { useEffect, useMemo, useState } from 'react';
import { Moon, Sun, CircleHelp, KeyRound, LogOut } from 'lucide-react';
import { Collection, DashboardData, Post, QueryParams, TabId, TimelineResponse } from './types';
import { buildDashboardData, emptyDashboardData } from './data/dashboardData';
import { APP_SUBTITLE, APP_TITLE, TABS } from './config';
import api from './services/api';
import OverviewTab from './components/OverviewTab';
import ExplorerTab from './components/ExplorerTab';
import ThreadsTab from './components/ThreadsTab';
import GraphsTab from './components/GraphsTab';
import GuidedTour from './components/GuidedTour';
import UsersTab from './components/UsersTab';
import ChangePasswordDialog from './components/ChangePasswordDialog';
import { useAuth } from './components/AuthGate';
import DashboardFilters from './components/DashboardFilters';
import ErrorBoundary from './components/ErrorBoundary';
import { fmtNum } from './utils/format';
import './App.css';

const PAGE_SUBTITLES: Record<TabId, string> = {
  overview: 'Vue d’ensemble de la sélection : volume, langues, types de publications et mots-clés',
  posts: 'Lire, qualifier et annoter les publications X et Bluesky de la sélection',
  threads: 'Conversations reconstruites à partir des réponses collectées',
  graphs: 'Réseaux de hashtags et de mentions',
  users: 'Créer les comptes, attribuer les rôles et désactiver un accès',
};

function App() {
  const { user, logout } = useAuth();
  const isAdmin = user.role === 'admin';
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [darkMode, setDarkMode] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [platform, setPlatform] = useState<string>('');
  const [lang, setLang] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loadingWidgets, setLoadingWidgets] = useState(false);

  useEffect(() => {
    api.getCollections()
      .then((result) => setCollections(result.collections || []))
      .catch((error) => console.error('Collections indisponibles', error));
  }, []);

  const filters = useMemo<QueryParams>(() => ({
    ...(selectedCollections.length ? { collectionId: selectedCollections.join(',') } : {}),
    ...(platform ? { platform } : {}),
    ...(lang ? { lang } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  }), [selectedCollections, platform, lang, startDate, endDate]);

  // Statistiques et courbe de la sélection, rechargées à chaque changement de filtre.
  // Les autres onglets chargent leurs propres données quand ils sont ouverts.
  useEffect(() => {
    // Ignore la réponse si les filtres ont changé entre-temps (requête devenue obsolète).
    let cancelled = false;
    setLoadingWidgets(true);
    Promise.all([api.getStats(filters), api.getTimeline(filters)])
      .then(([stats, tl]) => {
        if (cancelled) return;
        setDashboardData(buildDashboardData(stats));
        setTimeline(tl || null);
        setLoadingError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Impossible de récupérer les statistiques :', error);
        setLoadingError(error.message || String(error));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingWidgets(false);
        setLoadingData(false);
      });
    return () => { cancelled = true; };
  }, [filters]);

  const handleSelectPost = (post: Post) => {
    setSelectedPost(post);
    setActiveTab('threads');
  };

  const activeLabel = TABS.find((tab) => tab.id === activeTab)?.label;
  useEffect(() => {
    document.title = `${APP_TITLE} · ${activeLabel ?? 'Dashboard'}`;
  }, [activeLabel]);

  const collectionNames = collections.filter((item) => selectedCollections.includes(item.id)).map((item) => item.name);
  const collectionLabel = !collectionNames.length ? 'toutes les collectes' : collectionNames.length <= 3 ? collectionNames.join(', ') : `${collectionNames.length} collectes`;
  const platformsLabel = Object.keys(dashboardData.by_platform).filter((key) => dashboardData.by_platform[key] > 0).join(' / ');

  return (
    <div className={`app ${darkMode ? 'dark' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-mark">H</div>
          <div>
            <div className="app-name">{APP_TITLE}</div>
            <div className="app-sub">{APP_SUBTITLE}</div>
          </div>
        </div>

        <nav className="nav">
          {visibleTabs.map(tab => (
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
          <div className="stat-row">
            <span>{fmtNum(dashboardData.total_posts)} posts sélectionnés</span>
            <span>{platformsLabel}</span>
          </div>
          <div className="sidebar-user">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-role">{isAdmin ? 'Administrateur' : 'Utilisateur'} · {user.username}</span>
          </div>
          <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
            {darkMode ? 'Mode clair' : 'Mode sombre'}
          </button>
          <button className="theme-toggle" onClick={() => setTourOpen(true)}>
            <CircleHelp size={14} />
            Prise en main
          </button>
          <button className="theme-toggle" onClick={() => setPasswordOpen(true)}>
            <KeyRound size={14} />
            Mon mot de passe
          </button>
          <button className="theme-toggle" onClick={logout}>
            <LogOut size={14} />
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="page-header">
          <div>
            <h1 className="page-title">
              {APP_TITLE} · {activeLabel}
            </h1>
            <p className="page-sub">
              {activeTab === 'threads' && selectedPost ? `Conversation du post de @${selectedPost.author_handle}` : PAGE_SUBTITLES[activeTab]}
            </p>
            {activeTab !== 'users' && (
              <>
                <DashboardFilters
                  collections={collections}
                  languages={dashboardData.by_lang}
                  selectedCollections={selectedCollections}
                  platform={platform}
                  language={lang}
                  startDate={startDate}
                  endDate={endDate}
                  onCollectionsChange={setSelectedCollections}
                  onPlatformChange={setPlatform}
                  onLanguageChange={setLang}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                />
                <div className="page-highlight">
                  <span className="db-dot" />
                  <span>Sélection : {collectionLabel} · {fmtNum(dashboardData.total_posts)} posts</span>
                  {loadingWidgets && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Mise à jour…</span>}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="content">
          {loadingData && (
            <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
              Chargement des données…
            </div>
          )}
          {loadingError && (
            <div style={{ padding: '2rem', color: '#e34948' }}>
              Erreur de chargement : {loadingError}
            </div>
          )}
          {!loadingData && !loadingError && (
            <ErrorBoundary resetKey={activeTab}>
              {activeTab === 'overview' && <OverviewTab data={dashboardData} selectedCollections={selectedCollections} timeline={timeline} />}
              {activeTab === 'posts' && (
                <ExplorerTab
                  filters={filters}
                  platformCounts={dashboardData.by_platform}
                  onOpenThread={handleSelectPost}
                />
              )}
              {activeTab === 'threads' && (
                <ThreadsTab
                  filters={filters}
                  highlightedPost={selectedPost}
                  onClearHighlight={() => setSelectedPost(null)}
                />
              )}
              {activeTab === 'graphs' && <GraphsTab filters={filters} />}
              {activeTab === 'users' && isAdmin && <UsersTab />}
            </ErrorBoundary>
          )}
        </div>
      </main>
      <GuidedTour open={tourOpen} onNavigate={setActiveTab} onClose={() => setTourOpen(false)} />
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

export default App;
