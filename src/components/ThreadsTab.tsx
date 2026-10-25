import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, Heart, MessageCircle, PencilLine, Repeat2, Search, Users, X } from 'lucide-react';
import api from '../services/api';
import { ConversationDetail, ConversationList, ConversationRoot, ConversationSort, ConversationSummary, Post, QueryParams } from '../types';
import { fmtNum } from '../utils/format';
import { downloadBlob } from '../utils/download';
import { safeUrl, toRecord } from '../utils/postRecord';
import { annotationKey } from '../utils/annotations';
import AnnotationPanel, { useDirectory, useMyAnnotations } from './AnnotationPanel';
import { platformLabel } from './OverviewTab';

interface ThreadsTabProps {
  filters: QueryParams;
  highlightedPost?: Post | null;
  onClearHighlight?: () => void;
}

const PAGE_SIZE = 20;
const SORTS: { value: ConversationSort; label: string }[] = [
  { value: 'replies', label: 'Plus de réponses' },
  { value: 'participants', label: 'Plus de participants' },
  { value: 'depth', label: 'Plus profondes' },
  { value: 'likes', label: 'Plus de likes' },
  { value: 'recent', label: 'Plus récentes' },
];

const isMissing = (root: ConversationRoot): root is Extract<ConversationRoot, { missing: true }> => 'missing' in root && root.missing === true;

const formatDate = (raw: string | null | undefined, withDay = true) => {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('fr-FR', withDay ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }).format(date);
};

function duration(first: string | null, last: string | null) {
  if (!first || !last) return '';
  const minutes = Math.round((Date.parse(last) - Date.parse(first)) / 60000);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} jours`;
}

function rootTitle(root: ConversationRoot) {
  if (isMissing(root)) return root.author_handle ? `@${root.author_handle}` : 'Auteur inconnu';
  const record = toRecord(root);
  return record.author.handle && !record.author.handle.startsWith('did:') ? record.author.handle : record.author.name;
}

type TreeNode = { post: Post; children: TreeNode[]; depth: number };

function buildTree(detail: ConversationDetail, order: 'chrono' | 'likes'): { roots: TreeNode[]; ancestors: Set<string> } {
  const children = new Map<string, Post[]>();
  detail.posts.forEach((post) => {
    const parent = post.reply_to_id || detail.root_id;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(post);
  });
  const compare = order === 'likes'
    ? (left: Post, right: Post) => (right.engagement?.likes || 0) - (left.engagement?.likes || 0)
    : (left: Post, right: Post) => String(left.timestamp).localeCompare(String(right.timestamp));
  const build = (parentId: string, depth: number, guard: Set<string>): TreeNode[] => (children.get(parentId) || [])
    .filter((post) => !guard.has(post.post_id))
    .sort(compare)
    .map((post) => ({ post, depth, children: build(post.post_id, depth + 1, new Set(guard).add(post.post_id)) }));
  // Chemin de la racine au post mis en évidence, pour le déplier et le surligner.
  const ancestors = new Set<string>();
  const byId = new Map(detail.posts.map((post) => [post.post_id, post]));
  let current = detail.highlight ? byId.get(detail.highlight) : undefined;
  while (current) {
    ancestors.add(current.post_id);
    current = current.reply_to_id ? byId.get(current.reply_to_id) : undefined;
  }
  return { roots: build(detail.root_id, 1, new Set([detail.root_id])), ancestors };
}

const Metrics: React.FC<{ post: Post }> = ({ post }) => (
  <span className="threads-metrics">
    <span><Heart size={11} /> {fmtNum(post.engagement?.likes)}</span>
    <span><Repeat2 size={11} /> {fmtNum(post.engagement?.reposts)}</span>
    <span><MessageCircle size={11} /> {fmtNum(post.engagement?.replies)}</span>
    <span><Eye size={11} /> {fmtNum(post.engagement?.views)}</span>
  </span>
);

// Même règle que toRecord : un post sans plateforme est un tweet.
const platformOf = (post: Post) => (post.platform === 'bluesky' ? 'bluesky' : 'twitter');
const postKey = (post: Post) => annotationKey(platformOf(post), post.post_id);

// Post choisi pour le panneau d'annotation, et nombre de mes annotations par post.
interface AnnotateContext { targetId: string | null; counts: Record<string, number>; onSelect: (post: Post) => void }

const PostBody: React.FC<{ post: Post; large?: boolean; annotate: AnnotateContext }> = ({ post, large, annotate }) => {
  const record = toRecord(post);
  const avatar = safeUrl(record.author.avatar);
  const images = record.media.filter((media) => media.type === 'image' && safeUrl(media.url)).slice(0, 4);
  return (
    <div className={`threads-post ${annotate.targetId === post.post_id ? 'annotating' : ''}`}>
      <div className="threads-post-head">
        {avatar ? <img className="threads-avatar" src={avatar} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className="threads-avatar placeholder">{(record.author.name[0] || '?').toUpperCase()}</span>}
        <span className="threads-author" title={record.author.handle}>{record.author.name}</span>
        <span className="threads-handle">{record.author.handle}</span>
        <span className="threads-date">{formatDate(record.createdAt)}</span>
        {record.url && <a className="threads-link" href={record.url} target="_blank" rel="noopener noreferrer" title="Voir l’original"><ExternalLink size={12} /></a>}
        <button
          type="button"
          className={`threads-annotate ${annotate.targetId === post.post_id ? 'active' : ''}`}
          title="Annoter ce post"
          aria-pressed={annotate.targetId === post.post_id}
          onClick={() => annotate.onSelect(post)}
        >
          <PencilLine size={11} /> {annotate.counts[postKey(post)] || 'Annoter'}
        </button>
      </div>
      <div className={`threads-text ${large ? 'large' : ''}`}>{record.text || (record.isRetweet ? 'Republication sans texte' : 'Publication sans texte')}</div>
      {images.length > 0 && (
        <div className="threads-images">
          {images.map((media) => <a key={media.url} href={safeUrl(media.url)} target="_blank" rel="noopener noreferrer"><img src={safeUrl(media.url)} alt={media.alt} loading="lazy" /></a>)}
        </div>
      )}
      <Metrics post={post} />
    </div>
  );
};

// Réponses non chargées d'un post (grandes conversations) : bouton pour charger sa branche.
interface BranchContext { pending: Record<string, number>; loading: Set<string>; onLoad: (postId: string) => void }

const MoreReplies: React.FC<{ postId: string; branches: BranchContext }> = ({ postId, branches }) => {
  const missing = branches.pending[postId];
  if (!missing) return null;
  const loading = branches.loading.has(postId);
  return (
    <button type="button" className="threads-more-replies" disabled={loading} onClick={() => branches.onLoad(postId)}>
      {loading ? 'Chargement…' : `Charger ${fmtNum(missing)} réponse${missing > 1 ? 's' : ''} de plus`}
    </button>
  );
};

const TreeItem: React.FC<{ node: TreeNode; highlight: string | null; ancestors: Set<string>; collapsed: Set<string>; onToggle: (id: string) => void; annotate: AnnotateContext; branches: BranchContext }> = ({ node, highlight, ancestors, collapsed, onToggle, annotate, branches }) => {
  const isCollapsed = collapsed.has(node.post.post_id) && !ancestors.has(node.post.post_id);
  const count = node.children.length;
  return (
    <li className={`threads-node ${node.post.post_id === highlight ? 'highlight' : ''} ${ancestors.has(node.post.post_id) ? 'on-path' : ''}`} data-post-id={node.post.post_id}>
      <PostBody post={node.post} annotate={annotate} />
      {count > 0 && (
        <button type="button" className="threads-toggle" onClick={() => onToggle(node.post.post_id)}>
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {count} réponse{count > 1 ? 's' : ''}
        </button>
      )}
      {count > 0 && !isCollapsed && (
        <ul className="threads-children">
          {node.children.map((child) => <TreeItem key={child.post.post_id} node={child} highlight={highlight} ancestors={ancestors} collapsed={collapsed} onToggle={onToggle} annotate={annotate} branches={branches} />)}
        </ul>
      )}
      {!isCollapsed && <MoreReplies postId={node.post.post_id} branches={branches} />}
    </li>
  );
};

const ThreadsTab: React.FC<ThreadsTabProps> = ({ filters, highlightedPost, onClearHighlight }) => {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ConversationSort>('replies');
  const [minReplies, setMinReplies] = useState(2);
  const [rootFilter, setRootFilter] = useState<'' | 'collected' | 'missing'>('');
  const [list, setList] = useState<ConversationList | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [order, setOrder] = useState<'chrono' | 'likes'>('chrono');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const viewerRef = useRef<HTMLDivElement | null>(null);
  // Branches en cours de chargement, et export complet (généré par l'API).
  const [branchLoading, setBranchLoading] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState<'' | 'csv' | 'json'>('');
  const [exportRaw, setExportRaw] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Annotation : un post de la conversation à la fois, avec le même panneau que l'Explorer.
  const [toast, setToast] = useState('');
  const toastRef = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastRef.current);
    toastRef.current = window.setTimeout(() => setToast(''), 1800);
  }, []);
  const { annotations, update: updateMine } = useMyAnnotations(showToast);
  const directory = useDirectory();
  const [annotationTarget, setAnnotationTarget] = useState<Post | null>(null);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const annotationCounts = useMemo(() => Object.fromEntries(Object.entries(annotations).map(([key, list]) => [key, list.length])), [annotations]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filtersKey = JSON.stringify(filters);
  const listParams = useMemo(() => ({ ...(JSON.parse(filtersKey) as QueryParams), ...(query ? { q: query } : {}), sort, minReplies, root: rootFilter }), [filtersKey, query, sort, minReplies, rootFilter]);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    api.getConversations({ ...listParams, limit: PAGE_SIZE, skip: 0 })
      .then((result) => { if (!cancelled) setList(result); })
      .catch((error) => { if (!cancelled) setListError(error.message || String(error)); })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [listParams]);

  const loadMore = () => {
    if (!list) return;
    setListLoading(true);
    api.getConversations({ ...listParams, limit: PAGE_SIZE, skip: list.items.length })
      .then((result) => setList({ ...result, items: [...list.items, ...result.items] }))
      .catch((error) => setListError(error.message || String(error)))
      .finally(() => setListLoading(false));
  };

  // Un post choisi dans l'Explorer prime ; sinon la première conversation de la liste est ouverte.
  useEffect(() => {
    if (highlightedPost || selectedRoot || !list?.items.length) return;
    setSelectedRoot(list.items[0].root_id);
  }, [list, highlightedPost, selectedRoot]);

  useEffect(() => {
    const params = highlightedPost ? { postId: highlightedPost.post_id } : selectedRoot ? { rootId: selectedRoot } : null;
    if (!params) { setDetail(null); return undefined; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    api.getConversation(params)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        // Le post mis en évidence (venu de l'Explorer) ou, à défaut, le post d'origine s'il a été collecté.
        const highlighted = result.highlight ? result.posts.find((post) => post.post_id === result.highlight) : undefined;
        setAnnotationTarget(highlighted || (isMissing(result.root) ? null : result.root));
        // Les grandes conversations s'ouvrent repliées au-delà du premier niveau.
        setCollapsed(result.posts.length > 60 ? new Set(result.posts.filter((post) => post.reply_to_id !== result.root_id).map((post) => post.reply_to_id as string)) : new Set());
      })
      .catch((error) => { if (!cancelled) { setDetail(null); setDetailError(error.message || String(error)); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [highlightedPost, selectedRoot]);

  const tree = useMemo(() => (detail ? buildTree(detail, order) : null), [detail, order]);

  useEffect(() => {
    if (!detail?.highlight) return;
    window.setTimeout(() => viewerRef.current?.querySelector('.threads-node.highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [detail, tree]);

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const parentsWithReplies = useMemo(() => new Set((detail?.posts || []).map((post) => post.reply_to_id).filter((id): id is string => Boolean(id) && id !== detail?.root_id)), [detail]);

  // Ajoute à l'arbre les réponses d'une branche non chargée.
  const loadBranch = (postId: string) => {
    if (!detail) return;
    const rootId = detail.root_id;
    setBranchLoading((current) => new Set(current).add(postId));
    api.getConversationBranch(rootId, postId)
      .then((branch) => setDetail((current) => {
        if (!current || current.root_id !== rootId) return current;
        const known = new Set(current.posts.map((post) => post.post_id));
        const pending = { ...(current.pending || {}), ...branch.pending };
        delete pending[postId];
        return { ...current, posts: [...current.posts, ...branch.posts.filter((post) => !known.has(post.post_id))], pending };
      }))
      .catch((error) => showToast(`Branche non chargée : ${error.message || error}`))
      .finally(() => setBranchLoading((current) => { const next = new Set(current); next.delete(postId); return next; }));
  };
  const branches: BranchContext = { pending: detail?.pending || {}, loading: branchLoading, onLoad: loadBranch };

  const exportFull = async (format: 'csv' | 'json') => {
    if (!detail) return;
    setExporting(format);
    setExportError(null);
    try {
      const { blob, name } = await api.exportConversation(detail.root_id, format, format === 'json' && exportRaw);
      downloadBlob(blob, name);
    } catch (error: any) {
      setExportError(error.message || String(error));
    } finally {
      setExporting('');
    }
  };

  const annotate: AnnotateContext = {
    targetId: annotationTarget?.post_id || null,
    counts: annotationCounts,
    onSelect: (post) => { setAnnotationTarget(post); setAnnotationOpen(true); },
  };

  const selectConversation = (item: ConversationSummary) => {
    onClearHighlight?.();
    setSelectedRoot(item.root_id);
  };

  // Résumé de toute la conversation (calculé par l'API) ; à défaut, sur les posts chargés.
  const summary = useMemo(() => {
    if (!detail) return null;
    if (detail.stats) {
      return { replies: detail.stats.replies, participants: detail.stats.participants, depth: detail.stats.depth, span: duration(detail.stats.first_at, detail.stats.last_at) };
    }
    const byId = new Map(detail.posts.map((post) => [post.post_id, post]));
    const depths = new Map<string, number>();
    const depthOf = (id: string, guard = 0): number => {
      if (depths.has(id)) return depths.get(id)!;
      const parent = byId.get(id)?.reply_to_id;
      const value = !parent || parent === detail.root_id || !byId.has(parent) || guard > 500 ? 1 : depthOf(parent, guard + 1) + 1;
      depths.set(id, value);
      return value;
    };
    const times = detail.posts.map((post) => post.timestamp).filter(Boolean).sort();
    return {
      replies: detail.posts.length,
      participants: new Set([...(isMissing(detail.root) ? [] : [detail.root.author_handle]), ...detail.posts.map((post) => post.author_handle)].filter(Boolean)).size,
      depth: detail.posts.reduce((max, post) => Math.max(max, depthOf(post.post_id)), 0),
      span: duration(times[0] || null, times[times.length - 1] || null),
    };
  }, [detail]);

  return (
    <div className="threads">
      <div className="threads-toolbar">
        <div className="threads-search">
          <Search size={14} />
          <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Rechercher dans les réponses (texte, auteur, mot-clé)…" />
        </div>
        <select aria-label="Tri des conversations" value={sort} onChange={(event) => setSort(event.target.value as ConversationSort)}>
          {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select aria-label="Nombre minimal de réponses" value={minReplies} onChange={(event) => setMinReplies(Number(event.target.value))}>
          {[1, 2, 3, 5, 10, 20].map((value) => <option key={value} value={value}>{value === 1 ? 'Toutes les tailles' : `≥ ${value} réponses`}</option>)}
        </select>
        <select aria-label="Post d’origine" value={rootFilter} onChange={(event) => setRootFilter(event.target.value as '' | 'collected' | 'missing')}>
          <option value="">Post d’origine : tous</option>
          <option value="collected">Post d’origine collecté</option>
          <option value="missing">Post d’origine non collecté</option>
        </select>
      </div>
      <div className="threads-stats">
        {list ? `${fmtNum(list.stats.conversations)} conversation(s) · ${fmtNum(list.stats.replies)} réponse(s) · ${fmtNum(list.stats.collected_roots)} avec le post d’origine collecté` : ''}
        {listLoading && ' · chargement…'}
        {listError && <span className="threads-error"> · Erreur : {listError}</span>}
      </div>

      <div className="threads-layout">
        <aside className="threads-list">
          {list?.items.map((item) => {
            const active = !highlightedPost && item.root_id === selectedRoot;
            return (
              <button key={item.root_id} type="button" className={`threads-item ${active ? 'active' : ''}`} onClick={() => selectConversation(item)}>
                <div className="threads-item-top">
                  <span className="threads-item-author">{rootTitle(item.root)}</span>
                  <span className={`threads-pill ${item.platform}`}>{platformLabel(item.platform)}</span>
                </div>
                <div className="threads-item-text">
                  {isMissing(item.root) ? <em>Post d’origine non collecté</em> : (item.root.text || 'Publication sans texte')}
                </div>
                <div className="threads-item-badges">
                  <span title="Réponses"><MessageCircle size={11} /> {fmtNum(item.reply_count)}</span>
                  <span title="Participants"><Users size={11} /> {fmtNum(item.participants)}</span>
                  <span title="Profondeur maximale">prof. {item.depth}</span>
                  {item.likes > 0 && <span title="Likes cumulés"><Heart size={11} /> {fmtNum(item.likes)}</span>}
                  <span title="Durée">{duration(item.first_at, item.last_at)}</span>
                </div>
              </button>
            );
          })}
          {list && !list.items.length && !listLoading && <div className="threads-empty">Aucune conversation ne correspond à ces critères. Essayez « Toutes les tailles ».</div>}
          {list && list.items.length < list.total && (
            <button type="button" className="threads-more" disabled={listLoading} onClick={loadMore}>
              {listLoading ? 'Chargement…' : `Charger plus (${fmtNum(list.total - list.items.length)} restantes)`}
            </button>
          )}
        </aside>

        <section className="threads-viewer" ref={viewerRef}>
          {highlightedPost && (
            <div className="threads-banner">
              Conversation du post de @{highlightedPost.author_handle} sélectionné dans l’Explorer
              <button type="button" onClick={() => onClearHighlight?.()} aria-label="Revenir à la liste"><X size={14} /></button>
            </div>
          )}
          {detailLoading && <div className="threads-empty">Chargement de la conversation…</div>}
          {detailError && !detailLoading && (
            <div className="threads-empty">
              {highlightedPost ? `Aucune conversation trouvée pour ce post (${detailError}).` : detailError}
            </div>
          )}
          {detail && tree && !detailLoading && summary && (
            <>
              <div className="threads-viewer-head">
                <div className="threads-summary">
                  <span><strong>{fmtNum(summary.replies)}</strong> réponse(s)</span>
                  <span><strong>{fmtNum(summary.participants)}</strong> participant(s)</span>
                  <span>profondeur <strong>{summary.depth}</strong></span>
                  {summary.span && <span>sur {summary.span}</span>}
                  {Object.keys(detail.pending || {}).length > 0 && (
                    <span className="threads-partial" title="Les réponses non affichées se chargent branche par branche ; les exports contiennent toute la conversation.">
                      {fmtNum(detail.posts.length)} sur {fmtNum(detail.total_posts ?? summary.replies)} affichées
                    </span>
                  )}
                </div>
                <div className="threads-actions">
                  <select aria-label="Ordre des réponses" value={order} onChange={(event) => setOrder(event.target.value as 'chrono' | 'likes')}>
                    <option value="chrono">Ordre chronologique</option>
                    <option value="likes">Les plus aimées d’abord</option>
                  </select>
                  <button type="button" onClick={() => setCollapsed(new Set())}>Tout déplier</button>
                  <button type="button" onClick={() => setCollapsed(new Set(parentsWithReplies))}>Replier</button>
                  <button type="button" disabled={Boolean(exporting)} onClick={() => exportFull('csv')} title="Toute la conversation, y compris les réponses non affichées"><Download size={12} /> {exporting === 'csv' ? 'Export…' : 'CSV'}</button>
                  <button type="button" disabled={Boolean(exporting)} onClick={() => exportFull('json')} title="Toute la conversation, y compris les réponses non affichées"><Download size={12} /> {exporting === 'json' ? 'Export…' : 'JSON'}</button>
                  <label className="threads-export-raw" title="Ajoute les données brutes de chaque post au JSON (fichier beaucoup plus lourd)">
                    <input type="checkbox" checked={exportRaw} onChange={(event) => setExportRaw(event.target.checked)} /> raw_json
                  </label>
                </div>
              </div>
              {exportError && <div className="threads-error" style={{ fontSize: 12, marginBottom: 8 }}>Export impossible : {exportError}</div>}

              <div className={`threads-root ${detail.highlight === detail.root_id ? 'highlight' : ''}`}>
                {isMissing(detail.root) ? (
                  <div className="threads-missing">
                    <div className="threads-missing-title">Post d’origine non collecté{detail.root.author_handle ? ` · @${detail.root.author_handle}` : ''}</div>
                    <div className="threads-missing-text">Ce post ne fait pas partie de la collecte ; seules les réponses ci-dessous ont été collectées.</div>
                    {detail.root.url && <a href={detail.root.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Voir le post d’origine sur {platformLabel(detail.root.platform)}</a>}
                  </div>
                ) : <PostBody post={detail.root} large annotate={annotate} />}
              </div>

              {tree.roots.length ? (
                <ul className="threads-children top">
                  {tree.roots.map((node) => <TreeItem key={node.post.post_id} node={node} highlight={detail.highlight} ancestors={tree.ancestors} collapsed={collapsed} onToggle={toggle} annotate={annotate} branches={branches} />)}
                </ul>
              ) : !branches.pending[detail.root_id] && <div className="threads-empty">Aucune réponse collectée pour ce post.</div>}
              <MoreReplies postId={detail.root_id} branches={branches} />
            </>
          )}
          {!detail && !detailLoading && !detailError && <div className="threads-empty">Sélectionnez une conversation dans la liste.</div>}
        </section>

        <aside className={`explorer-pane explorer-annotation threads-annotation ${annotationOpen ? 'open' : ''}`}>
          {annotationTarget ? (
            <div className="threads-annotation-target">
              <span className="threads-annotation-target-label">Post annoté</span>
              <strong>{toRecord(annotationTarget).author.name}</strong> · {formatDate(annotationTarget.timestamp)}
              <div className="threads-annotation-target-text">{annotationTarget.text || 'Publication sans texte'}</div>
            </div>
          ) : (
            <div className="threads-annotation-target">Cliquez sur « Annoter » à côté d’un post de la conversation pour l’annoter.</div>
          )}
          <AnnotationPanel
            target={annotationTarget ? { platform: platformOf(annotationTarget), id: annotationTarget.post_id } : null}
            mine={annotationTarget ? annotations[postKey(annotationTarget)] || [] : []}
            onMineChange={updateMine}
            directory={directory}
            notify={showToast}
            headerAction={<button type="button" className="explorer-icon-btn explorer-annotation-close" aria-label="Fermer l’annotation" onClick={() => setAnnotationOpen(false)}><X size={16} /></button>}
          />
        </aside>
      </div>
      <div className={`explorer-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
};

export default ThreadsTab;
