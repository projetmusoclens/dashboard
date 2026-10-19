import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, ExternalLink, Eye, Heart, MessageCircle, Repeat2, Search, Users, X } from 'lucide-react';
import api, { ConversationDetail, ConversationList, ConversationRoot, ConversationSort, ConversationSummary, QueryParams } from '../services/api';
import { Post } from '../types';
import { fmtNum } from '../utils/format';
import { downloadFile, fileSlug, toCsv } from '../utils/download';
import { safeUrl, toRecord } from '../utils/postRecord';
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

const PostBody: React.FC<{ post: Post; large?: boolean }> = ({ post, large }) => {
  const record = toRecord(post);
  const avatar = safeUrl(record.author.avatar);
  const images = record.media.filter((media) => media.type === 'image' && safeUrl(media.url)).slice(0, 4);
  return (
    <div className="threads-post">
      <div className="threads-post-head">
        {avatar ? <img className="threads-avatar" src={avatar} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className="threads-avatar placeholder">{(record.author.name[0] || '?').toUpperCase()}</span>}
        <span className="threads-author" title={record.author.handle}>{record.author.name}</span>
        <span className="threads-handle">{record.author.handle}</span>
        <span className="threads-date">{formatDate(record.createdAt)}</span>
        {record.url && <a className="threads-link" href={record.url} target="_blank" rel="noopener noreferrer" title="Voir l’original"><ExternalLink size={12} /></a>}
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

const TreeItem: React.FC<{ node: TreeNode; highlight: string | null; ancestors: Set<string>; collapsed: Set<string>; onToggle: (id: string) => void }> = ({ node, highlight, ancestors, collapsed, onToggle }) => {
  const isCollapsed = collapsed.has(node.post.post_id) && !ancestors.has(node.post.post_id);
  const count = node.children.length;
  return (
    <li className={`threads-node ${node.post.post_id === highlight ? 'highlight' : ''} ${ancestors.has(node.post.post_id) ? 'on-path' : ''}`} data-post-id={node.post.post_id}>
      <PostBody post={node.post} />
      {count > 0 && (
        <button type="button" className="threads-toggle" onClick={() => onToggle(node.post.post_id)}>
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {count} réponse{count > 1 ? 's' : ''}
        </button>
      )}
      {count > 0 && !isCollapsed && (
        <ul className="threads-children">
          {node.children.map((child) => <TreeItem key={child.post.post_id} node={child} highlight={highlight} ancestors={ancestors} collapsed={collapsed} onToggle={onToggle} />)}
        </ul>
      )}
    </li>
  );
};

function exportConversation(detail: ConversationDetail, format: 'csv' | 'json') {
  const depth = new Map<string, number>([[detail.root_id, 0]]);
  const byId = new Map(detail.posts.map((post) => [post.post_id, post]));
  const depthOf = (id: string, guard = 0): number => {
    if (depth.has(id)) return depth.get(id)!;
    const parent = byId.get(id)?.reply_to_id;
    const value = !parent || guard > 500 ? 1 : depthOf(parent, guard + 1) + 1;
    depth.set(id, value);
    return value;
  };
  const base = `conversation_${fileSlug(rootTitle(detail.root))}_${new Date().toISOString().slice(0, 10)}`;
  if (format === 'json') {
    const posts = detail.posts.map((post) => ({ ...post, depth: depthOf(post.post_id) }));
    downloadFile(JSON.stringify({ root_id: detail.root_id, root_missing: detail.root_missing, root: detail.root, truncated: detail.truncated, posts }, null, 2), `${base}.json`, 'application/json;charset=utf-8');
    return;
  }
  const rows = [detail.root, ...detail.posts].map((item) => {
    if (isMissing(item)) return [item.post_id, '', 0, item.platform, item.author_handle, '', '(post non collecté)', '', '', '', '', item.url];
    const record = toRecord(item);
    return [item.post_id, item.reply_to_id, item.post_id === detail.root_id ? 0 : depthOf(item.post_id), item.platform, item.author_handle, item.timestamp, item.text, item.engagement?.likes, item.engagement?.reposts, item.engagement?.replies, item.engagement?.views, record.url];
  });
  downloadFile(toCsv(['post_id', 'reply_to_id', 'depth', 'platform', 'author_handle', 'timestamp', 'text', 'likes', 'reposts', 'replies', 'views', 'url'], rows), `${base}.csv`, 'text/csv;charset=utf-8');
}

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

  const selectConversation = (item: ConversationSummary) => {
    onClearHighlight?.();
    setSelectedRoot(item.root_id);
  };

  const summary = useMemo(() => {
    if (!detail) return null;
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
                  {detail.truncated && <span className="threads-error">conversation tronquée à {fmtNum(detail.posts.length)} posts</span>}
                </div>
                <div className="threads-actions">
                  <select aria-label="Ordre des réponses" value={order} onChange={(event) => setOrder(event.target.value as 'chrono' | 'likes')}>
                    <option value="chrono">Ordre chronologique</option>
                    <option value="likes">Les plus aimées d’abord</option>
                  </select>
                  <button type="button" onClick={() => setCollapsed(new Set())}>Tout déplier</button>
                  <button type="button" onClick={() => setCollapsed(new Set(parentsWithReplies))}>Replier</button>
                  <button type="button" onClick={() => exportConversation(detail, 'csv')}><Download size={12} /> CSV</button>
                  <button type="button" onClick={() => exportConversation(detail, 'json')}><Download size={12} /> JSON</button>
                </div>
              </div>

              <div className={`threads-root ${detail.highlight === detail.root_id ? 'highlight' : ''}`}>
                {isMissing(detail.root) ? (
                  <div className="threads-missing">
                    <div className="threads-missing-title">Post d’origine non collecté{detail.root.author_handle ? ` · @${detail.root.author_handle}` : ''}</div>
                    <div className="threads-missing-text">Ce post ne fait pas partie de la collecte ; seules les réponses ci-dessous ont été collectées.</div>
                    {detail.root.url && <a href={detail.root.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Voir le post d’origine sur {platformLabel(detail.root.platform)}</a>}
                  </div>
                ) : <PostBody post={detail.root} large />}
              </div>

              {tree.roots.length ? (
                <ul className="threads-children top">
                  {tree.roots.map((node) => <TreeItem key={node.post.post_id} node={node} highlight={detail.highlight} ancestors={tree.ancestors} collapsed={collapsed} onToggle={toggle} />)}
                </ul>
              ) : <div className="threads-empty">Aucune réponse collectée pour ce post.</div>}
            </>
          )}
          {!detail && !detailLoading && !detailError && <div className="threads-empty">Sélectionnez une conversation dans la liste.</div>}
        </section>
      </div>
    </div>
  );
};

export default ThreadsTab;
