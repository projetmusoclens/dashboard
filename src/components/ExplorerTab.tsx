import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, GitBranch, Info, PencilLine, Search, Share2, X, ZoomIn } from 'lucide-react';
import api from '../services/api';
import { AnnotationShares, Post, PostKind, PostSort, QueryParams, SharedPostRef, StoredAnnotation } from '../types';
import { fmtNum } from '../utils/format';
import { langLabel } from '../utils/languages';
import { downloadFile, toCsv } from '../utils/download';
import { bskyPostUrl, mediaKind, PostRecord, safeUrl, toRecord } from '../utils/postRecord';
import { Annotation, annotationKey, defaultAnnotation, loadAnnotations, RELEVANCE_LABELS, STATUS_LABELS } from '../utils/annotations';
import AnnotationPanel, { formatDate, fromServer, useDirectory, useMyAnnotations } from './AnnotationPanel';
import { useAuth } from './AuthGate';
import { platformLabel } from './OverviewTab';

interface ExplorerTabProps {
  filters: QueryParams;
  platformCounts: Record<string, number>;
  onOpenThread: (post: Post) => void;
}

type Platform = 'twitter' | 'bluesky';
const PLATFORMS: Platform[] = ['twitter', 'bluesky'];
const PAGE_SIZE = 200;

const SORT_OPTIONS: { value: PostSort; label: string }[] = [
  { value: 'date', label: 'Plus récents' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Vues' },
  { value: 'reposts', label: 'Reposts' },
  { value: 'replies', label: 'Réponses' },
];

const KIND_OPTIONS: { value: '' | PostKind; label: string }[] = [
  { value: '', label: 'Tous les types' },
  { value: 'original', label: 'Posts originaux' },
  { value: 'reply', label: 'Réponses' },
  { value: 'retweet', label: 'Retweets / reposts' },
  { value: 'quote', label: 'Citations' },
];

// Sans engagement côté Bluesky, le tri par date y est plus utile.
const defaultSortFor = (platform: Platform): PostSort => (platform === 'bluesky' ? 'date' : 'likes');

const shortDate = (raw: string | null) => {
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
};

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  return Promise.resolve();
}

const DetailSection: React.FC<{ title: string; rows: [string, React.ReactNode][] }> = ({ title, rows }) => (
  <div className="explorer-detail-section">
    <h3>{title}</h3>
    <div className="explorer-detail-rows">
      {rows.map(([key, value]) => (
        <div className="explorer-detail-row" key={key}>
          <div className="explorer-detail-key">{key}</div>
          <div className="explorer-detail-value">{value === null || value === undefined || value === '' ? '—' : value}</div>
        </div>
      ))}
    </div>
  </div>
);

// « a, b et c »
const frenchList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);

const ANNOTATION_HEADERS = ['annotation_id', 'statut', 'pertinence', 'theme', 'tonalite', 'interaction', 'mots_cles', 'commentaire', 'annotation_creee_le', 'annotation_modifiee_le'];
const annotationCells = (item: StoredAnnotation) => [item.id, item.status, item.relevance, item.theme, item.tone, item.interaction, item.keywords, item.note, item.created_at, item.updated_at];

const ExplorerTab: React.FC<ExplorerTabProps> = ({ filters, platformCounts, onOpenThread }) => {
  const { user } = useAuth();
  const legacyFlag = `heimdall-explorer-annotations:imported:${user.id}`;
  const availablePlatforms = useMemo<Platform[]>(() => {
    if (filters.platform) return PLATFORMS.filter((platform) => platform === filters.platform);
    const present = PLATFORMS.filter((platform) => (platformCounts[platform] || 0) > 0);
    return present.length ? present : PLATFORMS;
  }, [filters.platform, platformCounts]);

  const [activePlatform, setActivePlatform] = useState<Platform>(availablePlatforms[0] || 'twitter');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PostSort>(defaultSortFor(availablePlatforms[0] || 'twitter'));
  const [kind, setKind] = useState<'' | PostKind>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [relevanceFilter, setRelevanceFilter] = useState('');
  const [langFilter, setLangFilter] = useState('');
  const [mediaFilter, setMediaFilter] = useState('');

  // « Tous les posts » (recherche dans la base) ou « Partagés avec moi » (posts annotés par d'autres pour moi).
  const [viewMode, setViewMode] = useState<'all' | 'shared'>('all');
  const [sharedRefs, setSharedRefs] = useState<SharedPostRef[] | null>(null);
  const [dbPosts, setDbPosts] = useState<Post[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [legacyCount, setLegacyCount] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState('');

  const listRef = useRef<HTMLDivElement | null>(null);
  const toastRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(''), 1800);
  }, []);

  // Mes annotations, par post (plusieurs par post possibles, de la plus récente à la plus ancienne).
  const { annotations, reload: reloadAnnotations, update: updateMine } = useMyAnnotations(showToast);
  const directory = useDirectory();

  useEffect(() => {
    // Annotations faites dans ce navigateur avant l'arrivée des comptes : proposées à l'import une seule fois.
    try {
      if (!localStorage.getItem(legacyFlag)) setLegacyCount(Object.keys(loadAnnotations()).length);
    } catch {
      setLegacyCount(0);
    }
  }, [legacyFlag]);

  const importLegacy = async () => {
    const items = Object.entries(loadAnnotations()).map(([key, annotation]) => {
      const [platform, ...rest] = key.split(':');
      return { ...annotation, platform, post_id: rest.join(':') };
    });
    try {
      const result = await api.importAnnotations(items);
      try { localStorage.setItem(legacyFlag, new Date().toISOString()); } catch { /* sans stockage, la proposition reviendra */ }
      setLegacyCount(0);
      await reloadAnnotations();
      showToast(`${result.imported} annotation(s) importée(s)${result.skipped ? ` · ${result.skipped} ignorée(s) (déjà présentes ou invalides)` : ''}`);
    } catch (error: any) {
      showToast(`Import impossible : ${error.message || error}`);
    }
  };

  useEffect(() => {
    if (!availablePlatforms.includes(activePlatform) && availablePlatforms[0]) {
      setActivePlatform(availablePlatforms[0]);
      setSort(defaultSortFor(availablePlatforms[0]));
    }
  }, [availablePlatforms, activePlatform]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filtersKey = JSON.stringify(filters);
  const serverParams = useMemo(() => ({
    ...JSON.parse(filtersKey) as QueryParams,
    platform: activePlatform,
    ...(query ? { q: query } : {}),
    ...(kind ? { kind } : {}),
    sort,
  }), [filtersKey, activePlatform, query, kind, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    // Vue « Partagés avec moi » : les posts sont chargés par identifiant, sans les filtres de recherche.
    const load = viewMode === 'shared'
      ? api.getSharedWithMe().then(({ posts: refs }) => {
        if (cancelled) return [];
        setSharedRefs(refs);
        const ids = refs.filter((ref) => ref.platform === activePlatform).map((ref) => ref.post_id);
        return ids.length ? api.getPosts({ ids: ids.slice(0, 500).join(','), platform: activePlatform, sort: 'date', limit: 500 }) : [];
      })
      : api.getPosts({ ...serverParams, limit: PAGE_SIZE, skip: 0 });
    load
      .then((posts) => {
        if (cancelled) return;
        setDbPosts(posts);
        setHasMore(viewMode === 'all' && posts.length === PAGE_SIZE);
      })
      .catch((error) => { if (!cancelled) setLoadError(error.message || String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverParams, viewMode, activePlatform]);

  const loadMore = () => {
    setLoading(true);
    api.getPosts({ ...serverParams, limit: PAGE_SIZE, skip: dbPosts.length })
      .then((posts) => {
        setDbPosts((current) => {
          const known = new Set(current.map((post) => post.post_id));
          return [...current, ...posts.filter((post) => !known.has(post.post_id))];
        });
        setHasMore(posts.length === PAGE_SIZE);
      })
      .catch((error) => setLoadError(error.message || String(error)))
      .finally(() => setLoading(false));
  };

  const records = useMemo(() => dbPosts.map(toRecord), [dbPosts]);
  // Statut d'un post dans la liste et les filtres : celui de ma plus récente annotation.
  const annotationFor = useCallback((record: PostRecord): Annotation => {
    const latest = annotations[annotationKey(record.platform, record.id)]?.[0];
    return latest ? fromServer(latest) : defaultAnnotation();
  }, [annotations]);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    records.forEach((record) => { if (record.lang) counts.set(record.lang, (counts.get(record.lang) || 0) + 1); });
    return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  }, [records]);

  const filtered = useMemo(() => records.filter((record) => {
    const annotation = annotationFor(record);
    const media = mediaKind(record);
    return (!statusFilter || annotation.status === statusFilter)
      && (!relevanceFilter || annotation.relevance === relevanceFilter)
      && (!langFilter || record.lang === langFilter)
      && (!mediaFilter || (mediaFilter === 'media' ? media !== 'none' : media === mediaFilter));
  }), [records, annotationFor, statusFilter, relevanceFilter, langFilter, mediaFilter]);

  const position = filtered.findIndex((record) => record.id === currentId);
  const current = position >= 0 ? filtered[position] : null;

  useEffect(() => {
    if (!filtered.length) { setCurrentId(null); return; }
    if (!filtered.some((record) => record.id === currentId)) setCurrentId(filtered[0].id);
  }, [filtered, currentId]);

  // Partage : personnes avec qui je partage, et qui partagent avec moi.
  const [shares, setShares] = useState<AnnotationShares | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareDraft, setShareDraft] = useState<Set<string>>(() => new Set());
  const [shareSaving, setShareSaving] = useState(false);
  const [shareNotesDraft, setShareNotesDraft] = useState(true);

  useEffect(() => {
    api.getSharedWithMe().then(({ posts }) => setSharedRefs(posts)).catch(() => setSharedRefs(null));
  }, []);
  const sharedOwners = useMemo(() => new Map((sharedRefs || []).map((ref) => [annotationKey(ref.platform, ref.post_id), ref.owners.join(', ')])), [sharedRefs]);

  useEffect(() => {
    api.getShares().then(setShares).catch(() => setShares(null));
  }, []);

  const openShareDialog = () => {
    setShareDraft(new Set((shares?.shared_with || []).map((item) => item.id)));
    setShareNotesDraft(shares?.include_notes !== false);
    setShareDialogOpen(true);
  };

  const saveShares = async () => {
    setShareSaving(true);
    try {
      await api.setShares(Array.from(shareDraft), shareNotesDraft);
      setShares(await api.getShares());
      setShareDialogOpen(false);
      showToast(shareDraft.size ? `Annotations partagées avec ${shareDraft.size} personne(s)${shareNotesDraft ? '' : ', sans les commentaires libres'}` : 'Partage désactivé');
    } catch (error: any) {
      showToast(`Partage impossible : ${error.message || error}`);
    } finally {
      setShareSaving(false);
    }
  };

  const move = useCallback((delta: number) => {
    if (!filtered.length) return;
    const next = ((position < 0 ? 0 : position) + delta + filtered.length) % filtered.length;
    setCurrentId(filtered[next].id);
  }, [filtered, position]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDetailsOpen(false); setZoomUrl(null); setExportOpen(false); return; }
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  useEffect(() => {
    listRef.current?.querySelector('.explorer-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  const selectPlatform = (platform: Platform) => {
    setActivePlatform(platform);
    setSort(defaultSortFor(platform));
    setLangFilter('');
  };

  const exportRecords = (format: 'csv' | 'json') => {
    setExportOpen(false);
    const withAnnotations = filtered.map((record) => ({ record, items: annotations[annotationKey(record.platform, record.id)] || [] }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const enriched = withAnnotations.map(({ record, items }) => ({ ...record.post, raw_json: record.raw, annotations: items }));
      downloadFile(JSON.stringify(enriched, null, 2), `corpus_${activePlatform}_annote_${stamp}.json`, 'application/json;charset=utf-8');
    } else {
      // Une ligne par annotation des posts de la liste.
      const headers = ['annotateur', 'plateforme', 'publication_id', 'url', 'collecte', 'date_publication', 'date_collecte', 'auteur', 'compte', 'texte', ...ANNOTATION_HEADERS];
      const rows = withAnnotations.flatMap(({ record, items }) => items.map((item) => [user.username, record.platform, record.id, record.url, record.collection, record.createdAt, record.collectedAt, record.author.name, record.author.handle, record.text, ...annotationCells(item)]));
      if (!rows.length) { showToast('Aucune annotation dans cette liste'); return; }
      downloadFile(toCsv(headers, rows), `annotations_${activePlatform}_${stamp}.csv`, 'text/csv;charset=utf-8');
    }
    showToast('Export créé');
  };

  // Export de toutes les annotations enregistrées (les siennes, ou celles de l'équipe pour l'admin), avec le texte des posts.
  const exportAllAnnotations = async (scope: 'mine' | 'all') => {
    setExportOpen(false);
    try {
      const { annotations: items } = await api.exportAnnotations(scope);
      if (!items.length) { showToast('Aucune annotation enregistrée'); return; }
      const headers = ['annotateur', 'plateforme', 'publication_id', 'auteur', 'collecte', 'date_publication', 'langue', 'texte', ...ANNOTATION_HEADERS];
      const rows = items.map((item) => [item.username, item.platform, item.post_id, item.post?.author_handle, item.post?.collection_name, item.post?.timestamp, item.post?.lang, item.post?.text, ...annotationCells(item)]);
      downloadFile(toCsv(headers, rows), `annotations_${scope === 'all' ? 'equipe' : user.username}_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
      showToast(`${rows.length} annotation(s) exportée(s)`);
    } catch (error: any) {
      showToast(`Export impossible : ${error.message || error}`);
    }
  };

  const annotationValues = records.map(annotationFor);
  const done = annotationValues.filter((annotation) => annotation.status === 'analyse').length;
  const toDiscuss = annotationValues.filter((annotation) => annotation.status === 'a_discuter').length;
  const tabCount = (platform: Platform) => platformCounts[platform] || 0;

  const renderReader = () => {
    if (!current) {
      return <div className="explorer-empty">{loading ? 'Chargement des publications…' : 'Aucune publication à afficher.'}</div>;
    }
    const metrics: [string, number | null][] = [['Réponses', current.metrics.reply], ['Republications', current.metrics.retweet], ['Citations', current.metrics.quote], ['J’aime', current.metrics.like], ['Vues', current.metrics.view]];
    const hasMetrics = metrics.some(([, value]) => value !== null);
    const chips = [...current.entities.hashtags, ...current.entities.mentions, ...current.matchedKeywords.map((keyword) => `mot-clé : ${keyword}`)];
    const avatar = safeUrl(current.author.avatar);
    return (
      <article className="explorer-card">
        <div className="explorer-card-head">
          <div className="explorer-author">
            {avatar
              ? <img className="explorer-avatar" src={avatar} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
              : <div className={`explorer-avatar placeholder ${current.platform}`}>{current.platform === 'bluesky' ? 'B' : (current.author.name[0] || '?').toUpperCase()}</div>}
            <div style={{ minWidth: 0 }}>
              <div className="explorer-author-name">{current.author.name}{current.author.verified && <span className="explorer-verified"> ● vérifié</span>}</div>
              <div className="explorer-author-handle">{current.author.handle || '—'}</div>
            </div>
          </div>
          <div className="explorer-card-actions">
            <button type="button" className="explorer-btn" onClick={() => copyText(current.text).then(() => showToast('Texte copié'))}><Copy size={13} /> Copier le texte</button>
            <button type="button" className="explorer-btn" onClick={() => setDetailsOpen(true)}><Info size={13} /> Voir les détails</button>
            {(current.isReply || current.post.reply_to_id || (current.metrics.reply || 0) > 0) && (
              <button type="button" className="explorer-btn" onClick={() => onOpenThread(current.post)}><GitBranch size={13} /> Voir le thread</button>
            )}
            {current.url && <a className="explorer-btn primary" href={current.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {current.platform === 'bluesky' ? 'Voir sur Bluesky' : 'Voir sur X'}</a>}
          </div>
        </div>
        <div className="explorer-card-body">
          <div className="explorer-type-row">
            <span className={`explorer-pill ${current.platform === 'bluesky' ? 'bsky' : ''}`}>{platformLabel(current.platform)}</span>
            {current.isReply && <span className="explorer-pill">réponse</span>}
            {current.isRetweet && <span className="explorer-pill">retweet / repost</span>}
            {current.isQuote && <span className="explorer-pill">citation</span>}
            <span className="explorer-pill">{current.collection}</span>
          </div>
          {current.isRetweet && !current.text
            ? (
              <div className="explorer-repost">
                Republication sans texte propre.
                {current.repostOf && (
                  <>
                    {' '}Publication republiée :{' '}
                    {safeUrl(current.repostOf) || bskyPostUrl(current.repostOf)
                      ? <a href={safeUrl(current.repostOf) || bskyPostUrl(current.repostOf)} target="_blank" rel="noopener noreferrer">{current.repostOf}</a>
                      : current.repostOf}
                  </>
                )}
              </div>
            )
            : <div className="explorer-text">{current.text || 'Publication sans texte'}</div>}
          {current.media.length > 0 && (
            <div className={`explorer-media ${current.media.length === 1 ? 'single' : ''}`}>
              {current.media.map((media, index) => {
                const url = safeUrl(media.url);
                if (media.type === 'video' && url) {
                  return <video key={`${url}-${index}`} controls preload="metadata" src={url} poster={safeUrl(media.poster) || undefined} />;
                }
                if (media.type === 'image' && url) {
                  return (
                    <button key={`${url}-${index}`} type="button" className="explorer-media-zoom" onClick={() => setZoomUrl(url)} aria-label={`Agrandir le média ${index + 1}`}>
                      <img loading="lazy" src={url} alt={media.alt || 'Image associée'} onError={(event) => { (event.currentTarget.parentElement as HTMLElement).classList.add('broken'); }} />
                      <span className="explorer-zoom-hint"><ZoomIn size={13} /> Agrandir</span>
                    </button>
                  );
                }
                return <div key={index} className="explorer-media-placeholder">{media.alt || 'Média présent mais non accessible directement'}</div>;
              })}
            </div>
          )}
          {current.external && (
            <a className="explorer-external" href={safeUrl(current.external.url) || '#'} target="_blank" rel="noopener noreferrer">
              <div className="explorer-external-title">{current.external.title || 'Lien externe'}</div>
              {current.external.description && <div className="explorer-external-description">{current.external.description}</div>}
              <div className="explorer-external-url">{current.external.url}</div>
            </a>
          )}
          <div className="explorer-meta">
            {formatDate(current.createdAt)} · {current.source} · {current.lang ? langLabel(current.lang) : 'langue inconnue'}
            {current.collectedAt ? ` · collecté le ${formatDate(current.collectedAt)}` : ''}
          </div>
          {hasMetrics ? (
            <div className="explorer-metrics">
              {metrics.map(([label, value]) => (
                <div key={label} className="explorer-metric"><strong>{fmtNum(value)}</strong><span>{label}</span></div>
              ))}
            </div>
          ) : <div className="explorer-note">Les données d’engagement ne sont pas présentes pour cette publication.</div>}
          {chips.length > 0 && <div className="explorer-entities">{chips.map((chip) => <span key={chip} className="explorer-entity">{chip}</span>)}</div>}
          {current.quote && (
            <div className="explorer-quoted">
              <div className="explorer-quoted-label">Publication citée</div>
              <div className="explorer-author-handle">{current.quote.author || current.quote.uri}</div>
              {current.quote.text && <div className="explorer-quoted-text">{current.quote.text}</div>}
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="explorer">
      <div className="explorer-toolbar">
        <div className="explorer-tabs" role="tablist">
          {availablePlatforms.map((platform) => (
            <button key={platform} type="button" role="tab" aria-selected={platform === activePlatform} className={`explorer-tab ${platform === activePlatform ? 'active' : ''} ${platform}`} onClick={() => selectPlatform(platform)}>
              {platform === 'bluesky' ? 'Posts Bluesky' : 'Tweets X'} <span className="explorer-tab-count">{fmtNum(tabCount(platform))}</span>
            </button>
          ))}
        </div>
        <div className="explorer-actions">
          <button type="button" className="explorer-btn explorer-mobile-annotate" onClick={() => setAnnotationOpen((open) => !open)}><PencilLine size={13} /> Annoter</button>
          <button type="button" className="explorer-btn" onClick={openShareDialog} title="Partager toutes vos annotations avec une ou plusieurs personnes">
            <Share2 size={13} /> Tout partager{shares?.shared_with.length ? ` (${shares.shared_with.length})` : ''}
          </button>
          <div className="explorer-export">
            <button type="button" className="explorer-btn primary" aria-expanded={exportOpen} onClick={() => setExportOpen((open) => !open)}><Download size={13} /> Exporter ▾</button>
            {exportOpen && (
              <div className="explorer-menu">
                <button type="button" onClick={() => exportRecords('csv')}>Annotations de la liste en CSV</button>
                <button type="button" onClick={() => exportRecords('json')}>Corpus enrichi de la liste en JSON</button>
                <button type="button" onClick={() => exportAllAnnotations('mine')}>Toutes mes annotations (CSV)</button>
                {user.role === 'admin' && <button type="button" onClick={() => exportAllAnnotations('all')}>Annotations de toute l’équipe (CSV)</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="explorer-workspace">
        <aside className="explorer-pane explorer-left">
          <div className="explorer-filters">
            <div className="explorer-view-toggle" role="tablist" aria-label="Posts affichés">
              <button type="button" role="tab" aria-selected={viewMode === 'all'} className={viewMode === 'all' ? 'active' : ''} onClick={() => setViewMode('all')}>Tous les posts</button>
              <button type="button" role="tab" aria-selected={viewMode === 'shared'} className={viewMode === 'shared' ? 'active' : ''} onClick={() => setViewMode('shared')}>
                Partagés avec moi{sharedRefs ? ` (${sharedRefs.length})` : ''}
              </button>
            </div>
            {viewMode === 'shared' ? (
              <div className="explorer-section-empty">Posts dont une annotation vous est partagée (tweet par tweet ou par un partage complet), du plus récent au plus ancien. Les filtres de collecte et la recherche ne s’appliquent pas à cette vue.</div>
            ) : (
              <div className="explorer-search">
                <Search size={14} />
                <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Rechercher dans la base (texte, auteur, mot-clé)…" />
              </div>
            )}
            {viewMode === 'all' && (
            <div className="explorer-filter-row">
                <select aria-label="Tri" value={sort} onChange={(event) => setSort(event.target.value as PostSort)}>
                  {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>Tri : {option.label}</option>)}
                </select>
                <select aria-label="Type de publication" value={kind} onChange={(event) => setKind(event.target.value as '' | PostKind)}>
                  {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            )}
            <div className="explorer-filter-row">
              <select aria-label="Statut d’annotation" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">Tous les statuts</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select aria-label="Pertinence" value={relevanceFilter} onChange={(event) => setRelevanceFilter(event.target.value)}>
                <option value="">Toute pertinence</option>
                {Object.entries(RELEVANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="explorer-filter-row">
              <select aria-label="Langue" value={langFilter} onChange={(event) => setLangFilter(event.target.value)}>
                <option value="">Toutes les langues</option>
                {languages.map(([code, count]) => <option key={code} value={code}>{langLabel(code)} ({count})</option>)}
              </select>
              <select aria-label="Médias" value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value)}>
                <option value="">Toutes les publications</option>
                <option value="media">Avec média</option>
                <option value="image">Avec image</option>
                <option value="video">Avec vidéo</option>
                <option value="none">Sans média</option>
              </select>
            </div>
          </div>
          <div className="explorer-status">
            {filtered.length} affichée(s) sur {records.length} chargée(s) · {done} analysée(s) · {toDiscuss} à discuter
            <div className="explorer-progress"><div style={{ width: `${records.length ? Math.round((done / records.length) * 100) : 0}%` }} /></div>
            {loadError && <div className="explorer-error">Erreur : {loadError}</div>}
          </div>
          <div className="explorer-list" ref={listRef}>
            {!filtered.length && !loading && <div className="explorer-empty">Aucune publication ne correspond aux filtres.</div>}
            {filtered.map((record) => {
              const annotation = annotationFor(record);
              const media = mediaKind(record);
              const statusClass = annotation.status === 'analyse' ? 'saved' : annotation.status === 'a_discuter' ? 'discuss' : '';
              return (
                <button key={record.id} type="button" className={`explorer-item ${record.id === currentId ? 'active' : ''}`} onClick={() => { setCurrentId(record.id); if (window.innerWidth <= 760) document.querySelector('.explorer-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  <div className="explorer-item-top">
                    <span className="explorer-item-author">{record.author.name}</span>
                    <span className="explorer-item-date">{shortDate(record.createdAt)}</span>
                  </div>
                  <div className="explorer-item-text">{record.text || (record.isRetweet ? 'Republication sans texte' : 'Publication sans texte')}</div>
                  <div className="explorer-item-footer">
                    {media !== 'none' && <span className="explorer-pill">{media === 'video' ? 'vidéo' : 'image'}</span>}
                    {record.external && <span className="explorer-pill">lien</span>}
                    {record.isQuote && <span className="explorer-pill">cité</span>}
                    {record.isReply && <span className="explorer-pill">réponse</span>}
                    {record.isRetweet && <span className="explorer-pill">repost</span>}
                    {(annotations[annotationKey(record.platform, record.id)] || []).length > 1 && <span className="explorer-pill">{annotations[annotationKey(record.platform, record.id)].length} annotations</span>}
                    {(annotations[annotationKey(record.platform, record.id)] || []).some((item) => item.shared_with?.length) && <span className="explorer-pill bsky">partagée</span>}
                    {viewMode === 'shared' && sharedOwners.get(annotationKey(record.platform, record.id)) && (
                      <span className="explorer-pill saved">de : {sharedOwners.get(annotationKey(record.platform, record.id))}</span>
                    )}
                    {record.metrics.like !== null && <span className="explorer-pill">♥ {fmtNum(record.metrics.like)}</span>}
                    <span className={`explorer-pill ${statusClass}`}>{STATUS_LABELS[annotation.status]}</span>
                    {annotation.relevance && <span className={`explorer-pill ${annotation.relevance === 'non' ? 'no' : annotation.relevance === 'incertain' ? 'discuss' : 'saved'}`}>{RELEVANCE_LABELS[annotation.relevance]}</span>}
                    {annotation.theme && <span className="explorer-pill">{annotation.theme}</span>}
                  </div>
                </button>
              );
            })}
            {hasMore && (
              <button type="button" className="explorer-btn explorer-load-more" disabled={loading} onClick={loadMore}>
                {loading ? 'Chargement…' : `Charger ${PAGE_SIZE} publications de plus`}
              </button>
            )}
            {loading && !dbPosts.length && <div className="explorer-empty">Chargement…</div>}
          </div>
        </aside>

        <section className="explorer-pane explorer-center">
          <div className="explorer-reader-top">
            <div className="explorer-position">{current ? `${current.platform === 'bluesky' ? 'Post' : 'Tweet'} ${position + 1} / ${filtered.length}` : ''}</div>
            <div className="explorer-nav">
              <button type="button" className="explorer-icon-btn" aria-label="Publication précédente" onClick={() => move(-1)}><ChevronLeft size={16} /></button>
              <button type="button" className="explorer-icon-btn" aria-label="Publication suivante" onClick={() => move(1)}><ChevronRight size={16} /></button>
            </div>
          </div>
          {renderReader()}
        </section>

        <aside className={`explorer-pane explorer-annotation ${annotationOpen ? 'open' : ''}`}>
          <AnnotationPanel
            target={current ? { platform: current.platform, id: current.id } : null}
            mine={current ? annotations[annotationKey(current.platform, current.id)] || [] : []}
            onMineChange={updateMine}
            directory={directory}
            notify={showToast}
            headerAction={<button type="button" className="explorer-icon-btn explorer-annotation-close" aria-label="Fermer l’annotation" onClick={() => setAnnotationOpen(false)}><X size={16} /></button>}
          />

          {legacyCount > 0 ? (
            <div className="explorer-hint">
              {legacyCount} annotation(s) faites avant les comptes sont encore dans ce navigateur.
              <button type="button" className="explorer-btn primary" style={{ marginTop: 8 }} onClick={importLegacy}>Les importer dans mon compte</button>
            </div>
          ) : (
            <div className="explorer-hint">
              Vos annotations sont visibles par {frenchList(['vous', 'les administrateurs', ...(shares?.shared_with || []).map((item) => item.name)])}.{shares?.shared_with.length && shares.include_notes === false ? ' Vos commentaires libres ne sont pas inclus dans le partage complet.' : ''}
              {shares?.shared_with_me.length ? ` Partagées avec vous par : ${shares.shared_with_me.map((item) => item.name).join(', ')}.` : ''}
            </div>
          )}
        </aside>
      </div>

      {shareDialogOpen && (
        <div className="explorer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareDialogOpen(false); }}>
          <div className="explorer-modal explorer-share-modal" role="dialog" aria-modal="true" aria-labelledby="explorer-share-title">
            <div className="explorer-modal-head">
              <h2 id="explorer-share-title">Partager toutes mes annotations</h2>
              <button type="button" className="explorer-btn" onClick={() => setShareDialogOpen(false)}>Fermer</button>
            </div>
            <div className="explorer-modal-body">
              <p className="explorer-share-help">
                Les personnes cochées pourront lire toutes vos annotations, présentes et futures, sans pouvoir les modifier. Pour ne partager qu’une annotation, utilisez « Partager » sur cette annotation dans le panneau d’annotation. Les administrateurs voient déjà les annotations de toute l’équipe.
              </p>
              <div className="explorer-share-list">
                {!directory.length && <div className="explorer-section-empty">Chargement des comptes…</div>}
                {directory.filter((item) => item.id !== user.id).map((item) => (
                  <label key={item.id} className="explorer-share-row">
                    <input
                      type="checkbox"
                      checked={shareDraft.has(item.id)}
                      onChange={() => setShareDraft((current) => {
                        const next = new Set(current);
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                        return next;
                      })}
                    />
                    <span><strong>{item.name}</strong> <span className="explorer-share-username">{item.username}</span></span>
                  </label>
                ))}
              </div>
              <label className="explorer-share-notes">
                <input type="checkbox" checked={shareNotesDraft} onChange={(event) => setShareNotesDraft(event.target.checked)} />
                Inclure mes commentaires libres (sinon, seuls le statut, la pertinence, le thème, la tonalité, l’interaction et les mots-clés sont partagés)
              </label>
              {shares?.shared_with_me.length ? (
                <p className="explorer-share-help">Partagent leurs annotations avec vous : {shares.shared_with_me.map((item) => item.name).join(', ')}.</p>
              ) : null}
              <div className="explorer-save-row">
                <button type="button" className="explorer-btn primary" disabled={shareSaving} onClick={saveShares}>{shareSaving ? 'Enregistrement…' : 'Enregistrer le partage'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && current && (
        <div className="explorer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
          <div className="explorer-modal" role="dialog" aria-modal="true" aria-labelledby="explorer-details-title">
            <div className="explorer-modal-head">
              <h2 id="explorer-details-title">Détails techniques de la publication</h2>
              <button type="button" className="explorer-btn" onClick={() => setDetailsOpen(false)}>Fermer</button>
            </div>
            <div className="explorer-modal-body">
              <DetailSection title="Identification" rows={[['Plateforme', platformLabel(current.platform)], ['Identifiant', current.id], ['Collecte', current.collection], ['Conversation', current.conversationId], ['Réponse', current.isReply ? 'Oui' : 'Non'], ['Publication parent', current.parentId], ['Retweet / repost', current.isRetweet ? `Oui${current.repostOf ? ` (${current.repostOf})` : ''}` : 'Non'], ['Citation', current.isQuote ? 'Oui' : 'Non']]} />
              <DetailSection title="Publication" rows={[['Date de publication', formatDate(current.createdAt)], ['Date de collecte', formatDate(current.collectedAt)], ['Langue', current.lang ? `${langLabel(current.lang)} (${current.lang})` : null], ['Source', current.source], ['URL', current.url], ['Supprimée', current.isDeleted ? 'Oui' : 'Non']]} />
              <DetailSection title="Auteur" rows={[['Nom', current.author.name], ['Compte / DID', current.author.handle], ['Identifiant auteur', current.author.id], ['Vérifié', current.author.verified ? 'Oui' : 'Non']]} />
              <DetailSection title="Contenu" rows={[['Hashtags', current.entities.hashtags.join(', ')], ['Mentions', current.entities.mentions.join(', ')], ['Liens', current.entities.urls.join('\n') || current.external?.url], ['Médias', current.media.length], ['Mots-clés collectés', current.matchedKeywords.join(', ')], ['Version des mots-clés', current.keywordsVersion]]} />
              <textarea className="explorer-raw-json" readOnly value={JSON.stringify(current.raw, null, 2)} />
            </div>
          </div>
        </div>
      )}

      {zoomUrl && (
        <div className="explorer-modal-backdrop zoom" role="dialog" aria-modal="true" onClick={() => setZoomUrl(null)}>
          <button type="button" className="explorer-zoom-close" aria-label="Fermer" onClick={() => setZoomUrl(null)}><X size={18} /></button>
          <img src={zoomUrl} alt="Média agrandi" onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      <div className={`explorer-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
};

export default ExplorerTab;
