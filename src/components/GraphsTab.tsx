import React, { useEffect, useMemo, useRef, useState } from 'react';
// Use Sigma.js + graphology ; les layouts sont dans utils/graphLayouts.
// @ts-ignore
import Graph from 'graphology';
import { Post } from '../types';
import api, { QueryParams } from '../services/api';
import { fmtNum } from '../utils/format';
import { CHART_COLORS } from '../data/dashboardData';
import { bfsDistances, computeLayout, detectCommunities, LARGE_GRAPH_NODES, LAYOUTS, LayoutId, layoutUsesFocus } from '../utils/graphLayouts';
import { buildSubgraph, edgesToCsv, nodesToCsv, postsToCsv, SubgraphMeta, subgraphToGexf } from '../utils/subgraphExport';
import { downloadFile, fileSlug } from '../utils/download';

interface GraphsTabProps {
  posts: Post[];
  graphData?: {
    hashtags: { nodes: { id: string; label: string; value: number }[]; links: GraphEdge[] };
    mentions: { nodes: { id: string; label: string; value: number }[]; links: GraphEdge[] };
  };
  filters?: QueryParams;
  onGraphChange?: (subtitle: string) => void;
}

type GraphType = 'mentions' | 'hashtags';

type SeriesItem = { name: string; value: number };
type GraphNode = { id: string; label: string; value: number; color: string; type?: 'author' | 'mention' };
type GraphEdge = { source: string; target: string; value: number };
type GraphData = { summary: SeriesItem[]; relations: SeriesItem[] };
type NeighborItem = { id: string; label: string; distance: number; value: number; degree: number; weight: number | null };

const SELECTED_COLOR = '#e34948';
const SELECTED_EDGE_COLOR = 'rgba(227, 73, 72, 0.85)';
const FOCUS_EDGE_COLOR = 'rgba(42, 120, 214, 0.7)';
const EDGE_COLOR = '#b8c2d1';
const FADED_NODE_COLOR = '#d5dbe3';
const FADED_EDGE_COLOR = 'rgba(150, 160, 175, 0.12)';
const MAX_NEIGHBOR_ROWS = 400;
// Plafond serveur de /api/graph/subgraph : au-delà, l'export signale la troncature.
const SUBGRAPH_POST_LIMIT = 20000;

// Sigma (WebGL) ne lit pas les couleurs hsl() : conversion en hexadécimal.
const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

const colorForId = (id: string) => {
  // deterministic HSL color based on id
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  // authors/mentions get bluish-green palette depending on prefix
  if (id.startsWith('@')) return hslToHex(hue, 60, 48);
  if (id.startsWith('#')) return hslToHex((hue + 80) % 360, 60, 42);
  return hslToHex(hue, 50, 45);
};

const edgeSizeForWeight = (w: number | undefined) => {
  const v = typeof w === 'number' ? w : Number(w) || 1;
  // use a log scale to avoid huge sizes; clamp to reasonable range
  const size = Math.log(v + 1) * 1.8;
  return Math.max(0.6, Math.min(10, size));
};

const parseMentions = (text: string) =>
  Array.from(text.matchAll(/@([A-Za-z0-9_]+)/g)).map(match => match[1].toLowerCase());

// Même règle Unicode que le backend (server/services/analytics.js).
const parseHashtags = (text: string) =>
  Array.from(text.matchAll(/#([\p{L}\p{N}_]+)/gu)).map(match => match[1].toLowerCase());

const topItems = (map: Map<string, number>, limit: number = 15) =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }));

const buildMentionStats = (posts: Post[]): GraphData => {
  const mentionCounts = new Map<string, number>();
  const relationCounts = new Map<string, number>();

  posts.forEach(post => {
    parseMentions(post.text).forEach(mention => {
      const formattedMention = `@${mention}`;
      mentionCounts.set(formattedMention, (mentionCounts.get(formattedMention) || 0) + 1);
      const edgeKey = `${post.author_handle.toLowerCase()} → ${formattedMention}`;
      relationCounts.set(edgeKey, (relationCounts.get(edgeKey) || 0) + 1);
    });
  });

  return {
    summary: topItems(mentionCounts),
    relations: topItems(relationCounts),
  };
};

const buildHashtagStats = (posts: Post[]): GraphData => {
  const hashtagCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();

  posts.forEach(post => {
    const hashtags = Array.from(new Set(parseHashtags(post.text))).map(tag => `#${tag}`);

    hashtags.forEach(tag => {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    });

    for (let i = 0; i < hashtags.length; i += 1) {
      for (let j = i + 1; j < hashtags.length; j += 1) {
        const pair = [hashtags[i], hashtags[j]].sort().join(' · ');
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  });

  return {
    summary: topItems(hashtagCounts),
    relations: topItems(pairCounts),
  };
};

const buildHashtagGraph = (posts: Post[]): { nodes: GraphNode[]; links: GraphEdge[] } => {
  const hashtagCounts = new Map<string, number>();
  const pairCounts = new Map<string, number>();

  posts.forEach(post => {
    const hashtags = Array.from(new Set(parseHashtags(post.text))).map(tag => `#${tag}`);
    hashtags.forEach(tag => {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    });

    for (let i = 0; i < hashtags.length; i += 1) {
      for (let j = i + 1; j < hashtags.length; j += 1) {
        const pair = [hashtags[i], hashtags[j]].sort().join(' · ');
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  });

  const nodes = Array.from(hashtagCounts.entries()).map(([name, value]) => ({
    id: name,
    label: name,
    value,
    color: colorForId(name),
  }));

  const links = Array.from(pairCounts.entries()).map(([name, value]) => {
    const [left, right] = name.split(' · ');
    return { source: left, target: right, value };
  });

  return { nodes, links };
};

const buildMentionGraph = (posts: Post[]): { nodes: GraphNode[]; links: GraphEdge[] } => {
  const mentionCounts = new Map<string, number>();
  const relationCounts = new Map<string, number>();

  posts.forEach(post => {
    const author = `@${post.author_handle.toLowerCase()}`;
    parseMentions(post.text).forEach(mention => {
      const formattedMention = `@${mention}`;
      mentionCounts.set(formattedMention, (mentionCounts.get(formattedMention) || 0) + 1);
      const edgeKey = `${author} → ${formattedMention}`;
      relationCounts.set(edgeKey, (relationCounts.get(edgeKey) || 0) + 1);
    });
  });

  const sortedRelations = Array.from(relationCounts.entries()).sort((a, b) => b[1] - a[1]);
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphEdge[] = [];

  sortedRelations.forEach(([relationName, value]) => {
    const [author, mention] = relationName.split(' → ');
    if (!author || !mention) return;

    if (!nodesMap.has(author)) {
      nodesMap.set(author, {
        id: author,
        label: author,
        value: Math.max(4, value),
        color: '#5f8ae2',
        type: 'author',
      });
    }

    if (!nodesMap.has(mention)) {
      nodesMap.set(mention, {
        id: mention,
        label: mention,
        value: Math.max(5, mentionCounts.get(mention) || 1),
        color: colorForId(mention),
        type: 'mention',
      });
    }

    links.push({
      source: author,
      target: mention,
      value,
    });
  });

  return { nodes: Array.from(nodesMap.values()), links };
};

const layoutKey = (layout: LayoutId, spacing: number, focus: string | null) => `${layout}|${spacing}|${layoutUsesFocus(layout) ? focus : ''}`;

const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 };
const cardTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 };
const pillButton = (active: boolean, color = '#1d9e75'): React.CSSProperties => ({
  padding: '0.75rem 1rem',
  borderRadius: 999,
  border: active ? `1px solid ${color}` : '1px solid var(--border)',
  background: active ? `${color}1f` : 'transparent',
  color: active ? color : 'var(--text-primary)',
  cursor: 'pointer',
  fontWeight: 600,
});
const smallButton: React.CSSProperties = { padding: '5px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
const inputStyle: React.CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)' };

const GraphsTab: React.FC<GraphsTabProps> = ({ posts, graphData, filters = {}, onGraphChange }) => {
  const [activeGraph, setActiveGraph] = useState<GraphType>('hashtags');
  const [layout, setLayout] = useState<LayoutId>('forceatlas2');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [colorByCommunity, setColorByCommunity] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [nodeLimit, setNodeLimit] = useState<number>(300);
  const [minNodeValue, setMinNodeValue] = useState<number>(1);
  const [spacing, setSpacing] = useState<number>(1);
  const [graphVersion, setGraphVersion] = useState(0);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [neighborQuery, setNeighborQuery] = useState('');
  const [isolate, setIsolate] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [exportState, setExportState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: '', error: false });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const appliedLayoutRef = useRef('');
  const cancelAnimationRef = useRef<(() => void) | null>(null);
  const layoutRef = useRef(layout);
  const spacingRef = useRef(spacing);
  const focusRef = useRef(focusNode);
  layoutRef.current = layout;
  spacingRef.current = spacing;
  focusRef.current = focusNode;

  const mentionStats = useMemo(() => buildMentionStats(posts), [posts]);
  const hashtagStats = useMemo(() => buildHashtagStats(posts), [posts]);
  const hashtagGraph = useMemo(() => buildHashtagGraph(posts), [posts]);
  const mentionGraph = useMemo(() => buildMentionGraph(posts), [posts]);

  const currentGraph = useMemo(() => {
    const external = activeGraph === 'mentions' ? graphData?.mentions : graphData?.hashtags;
    if (!external) return activeGraph === 'mentions' ? mentionGraph : hashtagGraph;
    return {
      nodes: external.nodes.map((node) => ({ ...node, color: colorForId(node.id), type: activeGraph === 'mentions' ? 'mention' as const : undefined })),
      links: external.links,
    };
  }, [activeGraph, graphData, hashtagGraph, mentionGraph]);
  const filteredGraph = useMemo(() => {
    const nodes = currentGraph.nodes
      .filter(n => n.value >= minNodeValue)
      .sort((a, b) => b.value - a.value)
      .slice(0, nodeLimit);

    const nodeIds = new Set(nodes.map(n => n.id));
    const links = currentGraph.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target) && l.value >= minNodeValue);

    return { nodes, links };
  }, [currentGraph, nodeLimit, minNodeValue]);

  const selectedTitle = activeGraph === 'mentions' ? 'Relations de mentions' : 'Graph global des hashtags';

  useEffect(() => {
    onGraphChange?.(selectedTitle);
  }, [selectedTitle, onGraphChange]);

  // Changer de type de graphe repart d'une sélection vide (les identifiants ne sont pas comparables).
  useEffect(() => {
    setFocusNode(null);
    setSelected(new Set());
    setIsolate(false);
    setExportState({ busy: false, message: '', error: false });
  }, [activeGraph]);

  // Voisinage du nœud sélectionné jusqu'au niveau choisi, sur le graphe affiché.
  const neighborhood = useMemo<NeighborItem[]>(() => {
    const graph = graphRef.current;
    if (!graph || !focusNode || !graph.hasNode(focusNode)) return [];
    const items: NeighborItem[] = [];
    bfsDistances(graph, focusNode, depth).forEach(({ distance }, id) => {
      const attributes = graph.getNodeAttributes(id);
      const edge = distance === 1 ? graph.edge(focusNode, id) : undefined;
      items.push({ id, label: attributes.label || id, distance, value: Number(attributes.value) || 0, degree: graph.degree(id), weight: edge ? Number(graph.getEdgeAttribute(edge, 'weight')) || 0 : null });
    });
    return items.sort((left, right) => left.distance - right.distance || (right.weight || 0) - (left.weight || 0) || right.value - left.value);
    // graphVersion signale la reconstruction du graphe (graphRef ne déclenche pas de rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNode, depth, graphVersion]);
  const neighborhoodIds = useMemo(() => new Set(neighborhood.map((item) => item.id)), [neighborhood]);

  const visualRef = useRef({ focus: focusNode, selected, neighborhood: neighborhoodIds, showEdges, isolate, colorByCommunity });
  visualRef.current = { focus: focusNode, selected, neighborhood: neighborhoodIds, showEdges, isolate, colorByCommunity };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const container = containerRef.current;

    // Build graphology graph
    const graph = new (Graph as any)({ type: 'undirected', allowSelfLoops: false });
    filteredGraph.nodes.forEach(n => {
      // Sigma expects a supported `type` for rendering (use 'circle');
      // keep original semantic type in `role` for app logic.
      const baseSize = Math.max(3, Math.min(18, 2 + Math.sqrt(n.value) * 1.4));
      graph.mergeNode(n.id, {
        label: n.label,
        value: n.value,
        size: baseSize,
        baseSize,
        color: n.color,
        baseColor: n.color,
        type: 'circle',
        role: n.type || 'hashtag',
      });
    });
    filteredGraph.links.forEach(l => {
      if (l.source === l.target || !graph.hasNode(l.source) || !graph.hasNode(l.target)) return;
      const existing = graph.edge(l.source, l.target);
      if (existing) graph.updateEdgeAttribute(existing, 'weight', (weight: number) => (weight || 0) + l.value);
      else graph.addEdge(l.source, l.target, { weight: l.value });
    });
    graph.forEachEdge((edge: string, attributes: any) => graph.setEdgeAttribute(edge, 'size', edgeSizeForWeight(attributes.weight)));

    const communities = detectCommunities(graph);
    graph.forEachNode((node: string) => graph.setNodeAttribute(node, 'community', communities[node] ?? 0));

    const focus = focusRef.current && graph.hasNode(focusRef.current) ? focusRef.current : null;
    let positions: Record<string, { x: number; y: number }> = {};
    try {
      positions = computeLayout(graph, layoutRef.current, { spacing: spacingRef.current, focus });
    } catch (err) {
      console.warn('Layout failed', err);
    }
    graph.forEachNode((node: string) => {
      const position = positions[node];
      graph.setNodeAttribute(node, 'x', Number.isFinite(position?.x) ? position.x : Math.random() * 100);
      graph.setNodeAttribute(node, 'y', Number.isFinite(position?.y) ? position.y : Math.random() * 100);
    });
    appliedLayoutRef.current = layoutKey(layoutRef.current, spacingRef.current, focus);
    graphRef.current = graph;

    setSelected((previous) => {
      const kept = new Set(Array.from(previous).filter((id) => graph.hasNode(id)));
      return kept.size === previous.size ? previous : kept;
    });
    if (focusRef.current && !graph.hasNode(focusRef.current)) setFocusNode(null);
    setGraphVersion((version) => version + 1);

    // Sigma requires browser WebGL globals and must not be loaded by jsdom tests.
    if (typeof WebGL2RenderingContext === 'undefined') {
      return () => { graphRef.current = null; };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SigmaLib: any = (require('sigma').default as any) || (window as any).sigma;
    const labelColor = getComputedStyle(container).getPropertyValue('--text-primary').trim() || '#0f172a';
    const largeGraph = graph.size > 3000;

    // La mise en évidence passe par les reducers de Sigma : les attributs du graphe ne sont jamais modifiés.
    const nodeReducer = (node: string, data: any) => {
      const state = visualRef.current;
      const result: any = { ...data };
      if (state.colorByCommunity) result.color = CHART_COLORS[(Number(data.community) || 0) % CHART_COLORS.length];
      const isSelected = state.selected.has(node);
      if (state.isolate && state.selected.size && !isSelected) return { ...result, hidden: true };
      const hasContext = Boolean(state.focus) || state.selected.size > 0;
      if (isSelected) {
        result.color = SELECTED_COLOR;
        result.forceLabel = true;
        result.zIndex = 2;
      }
      if (node === state.focus) {
        result.highlighted = true;
        result.forceLabel = true;
        result.size = (data.size || 4) * 1.4;
        result.zIndex = 3;
      } else if (hasContext && !isSelected && !state.neighborhood.has(node)) {
        result.color = FADED_NODE_COLOR;
        result.label = '';
        result.zIndex = 0;
      } else if (hasContext && !isSelected) {
        result.zIndex = 1;
      }
      return result;
    };
    const edgeReducer = (edge: string, data: any) => {
      const state = visualRef.current;
      if (!state.showEdges) return { ...data, hidden: true };
      const [source, target] = graph.extremities(edge);
      const bothSelected = state.selected.has(source) && state.selected.has(target);
      if (state.isolate && state.selected.size && !bothSelected) return { ...data, hidden: true };
      if (bothSelected) return { ...data, color: SELECTED_EDGE_COLOR, size: (data.size || 1) * 1.5, zIndex: 2 };
      if (state.focus && (source === state.focus || target === state.focus)) return { ...data, color: FOCUS_EDGE_COLOR, zIndex: 1 };
      if (state.focus || state.selected.size) return largeGraph ? { ...data, hidden: true } : { ...data, color: FADED_EDGE_COLOR, zIndex: 0 };
      return data;
    };

    // create sigma renderer
    let renderer: any = null;
    try {
      renderer = new SigmaLib(graph, container, {
        renderLabels: true,
        zIndex: true,
        defaultEdgeColor: EDGE_COLOR,
        labelColor: { color: labelColor },
        labelRenderedSizeThreshold: 6,
        labelDensity: 0.8,
        nodeReducer,
        edgeReducer,
      });
    } catch (err) {
      console.warn('Sigma init failed', err);
    }
    sigmaRef.current = renderer;

    if (renderer) {
      // Clic : explorer le voisinage du nœud et l'ajouter à la sélection. Maj/Ctrl + clic : (dé)sélectionner seulement.
      renderer.on('clickNode', ({ node, event }: any) => {
        const original = event?.original;
        if (original && (original.shiftKey || original.ctrlKey || original.metaKey)) {
          setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(node)) next.delete(node); else next.add(node);
            return next;
          });
          return;
        }
        setFocusNode(node);
        setSelected((previous) => (previous.has(node) ? previous : new Set(previous).add(node)));
      });
      renderer.on('clickStage', () => setFocusNode(null));
      renderer.on('enterNode', () => { container.style.cursor = 'pointer'; });
      renderer.on('leaveNode', () => { container.style.cursor = ''; });
    }

    return () => {
      cancelAnimationRef.current?.();
      try { if (renderer && typeof renderer.kill === 'function') renderer.kill(); } catch (e) {}
      try { if (graph && typeof graph.clear === 'function') graph.clear(); } catch (e) {}
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [filteredGraph]);

  // Changement de spatialisation : nouvelles positions calculées sur le graphe existant puis animées.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return undefined;
    const focus = layoutUsesFocus(layout) && focusNode && graph.hasNode(focusNode) ? focusNode : null;
    const key = layoutKey(layout, spacing, focus);
    if (key === appliedLayoutRef.current) return undefined;
    setLayoutBusy(true);
    const timer = window.setTimeout(() => {
      appliedLayoutRef.current = key;
      let positions: Record<string, { x: number; y: number }>;
      try {
        positions = computeLayout(graph, layout, { spacing, focus });
      } catch (err) {
        console.warn('Layout failed', err);
        setLayoutBusy(false);
        return;
      }
      if (graphRef.current !== graph) return;
      const renderer = sigmaRef.current;
      if (!renderer) {
        graph.forEachNode((node: string) => graph.mergeNodeAttributes(node, positions[node]));
        setLayoutBusy(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { animateNodes } = require('sigma/utils');
      cancelAnimationRef.current?.();
      cancelAnimationRef.current = animateNodes(graph, positions, { duration: 500 }, () => {
        setLayoutBusy(false);
        renderer.getCamera().animatedReset({ duration: 300 });
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      setLayoutBusy(false);
    };
  }, [layout, spacing, focusNode, graphVersion]);

  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [focusNode, selected, neighborhoodIds, showEdges, isolate, colorByCommunity]);

  const centerOn = (node: string) => {
    const renderer = sigmaRef.current;
    const display = renderer?.getNodeDisplayData(node);
    if (!display) return;
    const camera = renderer.getCamera();
    camera.animate({ x: display.x, y: display.y, ratio: Math.min(camera.ratio, 0.6) }, { duration: 400 });
  };

  const focusFromList = (node: string) => {
    setFocusNode(node);
    setSelected((previous) => (previous.has(node) ? previous : new Set(previous).add(node)));
    if (!layoutUsesFocus(layout)) centerOn(node);
  };

  const resetView = () => {
    setFocusNode(null);
    setIsolate(false);
    try {
      sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
    } catch (err) {
      console.warn('resetView error', err);
    }
  };

  const query = neighborQuery.trim().toLowerCase();
  const visibleNeighbors = query ? neighborhood.filter((item) => item.label.toLowerCase().includes(query)) : neighborhood;
  const focusInfo = neighborhood.find((item) => item.id === focusNode) || null;
  const focusRole = focusNode && graphRef.current?.hasNode(focusNode) ? graphRef.current.getNodeAttribute(focusNode, 'role') : null;
  const directCount = neighborhood.filter((item) => item.distance === 1).length;

  const toggleNode = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelected((previous) => new Set([...Array.from(previous), ...visibleNeighbors.map((item) => item.id)]));
  const deselectAll = () => setSelected((previous) => {
    const next = new Set(previous);
    visibleNeighbors.forEach((item) => next.delete(item.id));
    return next;
  });
  const directOnly = () => setSelected((previous) => {
    const next = new Set(previous);
    neighborhood.forEach((item) => { if (item.distance <= 1) next.add(item.id); else next.delete(item.id); });
    return next;
  });

  const selectedEdgeCount = useMemo(() => {
    const graph = graphRef.current;
    if (!graph || selected.size < 2) return 0;
    let count = 0;
    graph.forEachEdge((_edge: string, _attributes: any, source: string, target: string) => {
      if (selected.has(source) && selected.has(target)) count += 1;
    });
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, graphVersion]);
  const selectedList = Array.from(selected);
  const labelOf = (id: string) => (graphRef.current?.hasNode(id) ? graphRef.current.getNodeAttribute(id, 'label') : id) || id;

  const exportSubgraph = async (format: 'json' | 'csv' | 'gexf') => {
    const graph = graphRef.current;
    if (!graph || !selected.size) return;
    const { nodes, edges } = buildSubgraph(graph, selected);
    const generatedAt = new Date().toISOString();
    const meta: SubgraphMeta = {
      generated_at: generatedAt,
      graph_type: activeGraph,
      layout,
      filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === 'string' && value)) as Record<string, string>,
      node_count: nodes.length,
      edge_count: edges.length,
    };
    const base = `sous-graphe_${activeGraph}_${fileSlug(labelOf(focusNode || nodes[0].id))}_${generatedAt.slice(0, 10)}`;
    if (format === 'gexf') {
      downloadFile(subgraphToGexf(nodes, edges, meta), `${base}.gexf`, 'application/xml;charset=utf-8');
      setExportState({ busy: false, message: `GEXF exporté : ${nodes.length} nœuds, ${edges.length} arêtes.`, error: false });
      return;
    }
    setExportState({ busy: true, message: 'Récupération des posts liés au sous-graphe…', error: false });
    try {
      const response = await api.getSubgraphPosts(activeGraph, nodes.map((node) => node.id), { ...filters, includeRaw, limit: SUBGRAPH_POST_LIMIT });
      const fullMeta = { ...meta, post_count: response.posts.length, posts_matched: response.matched, posts_truncated: response.truncated };
      if (format === 'json') {
        downloadFile(JSON.stringify({ meta: fullMeta, nodes, edges, posts: response.posts }, null, 2), `${base}.json`, 'application/json;charset=utf-8');
      } else {
        downloadFile(nodesToCsv(nodes), `${base}_noeuds.csv`, 'text/csv;charset=utf-8');
        // Petits délais : certains navigateurs bloquent plusieurs téléchargements simultanés.
        window.setTimeout(() => downloadFile(edgesToCsv(edges), `${base}_aretes.csv`, 'text/csv;charset=utf-8'), 300);
        window.setTimeout(() => downloadFile(postsToCsv(response.posts), `${base}_posts.csv`, 'text/csv;charset=utf-8'), 600);
      }
      setExportState({
        busy: false,
        message: `${nodes.length} nœuds, ${edges.length} arêtes et ${fmtNum(response.posts.length)} posts exportés${response.truncated ? ` (limite atteinte : ${fmtNum(response.matched)} posts correspondants)` : ''}.`,
        error: false,
      });
    } catch (err: any) {
      setExportState({ busy: false, message: `Export impossible : ${err.message || err}`, error: true });
    }
  };

  const layoutInfo = LAYOUTS.find((item) => item.id === layout);
  const isLarge = filteredGraph.nodes.length > LARGE_GRAPH_NODES;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setActiveGraph('hashtags')} style={pillButton(activeGraph === 'hashtags')}>Hashtags</button>
        <button type="button" onClick={() => setActiveGraph('mentions')} style={pillButton(activeGraph === 'mentions', '#2a78d6')}>Mentions</button>
        <button type="button" onClick={() => setShowEdges(!showEdges)} style={{ ...pillButton(showEdges), color: showEdges ? '#1d9e75' : 'var(--text-secondary)', background: showEdges ? 'rgba(29,158,117,0.12)' : 'rgba(99,99,99,0.08)', border: '1px solid var(--border)' }}>
          {showEdges ? 'Masquer les arêtes' : 'Afficher les arêtes'}
        </button>
        <button type="button" onClick={resetView} style={pillButton(false)}>Reset view</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 6, flexWrap: 'wrap' }}>
          <label htmlFor="graph-node-limit" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nodes:</label>
          <input id="graph-node-limit" type="number" min={50} max={2000} value={nodeLimit} onChange={e => setNodeLimit(Math.min(2000, Number(e.target.value) || 50))} style={{ ...inputStyle, width: 90 }} />
          <label htmlFor="graph-min-value" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Min value:</label>
          <input id="graph-min-value" type="number" min={1} max={100} value={minNodeValue} onChange={e => setMinNodeValue(Number(e.target.value) || 1)} style={{ ...inputStyle, width: 70 }} />
        </div>
      </div>

      <div style={{ ...cardStyle, padding: '10px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="graph-layout" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Spatialisation du graphe :</label>
        <select id="graph-layout" value={layout} onChange={(event) => setLayout(event.target.value as LayoutId)} style={{ ...inputStyle, minWidth: 260 }}>
          {LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <label htmlFor="graph-spacing" style={{ fontSize: 12, color: layoutInfo?.usesSpacing ? 'var(--text-muted)' : 'var(--text-disabled, #9aa3ad)' }}>Espacement :</label>
        <input id="graph-spacing" type="range" min={0.5} max={3} step={0.1} value={spacing} disabled={!layoutInfo?.usesSpacing} onChange={e => setSpacing(Number(e.target.value))} style={{ width: 120 }} />
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={colorByCommunity} onChange={(event) => setColorByCommunity(event.target.checked)} /> Couleurs par communauté (Louvain)
        </label>
        {layoutBusy && <span style={{ fontSize: 12, color: '#2a78d6', fontWeight: 600 }}>Calcul de la disposition…</span>}
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {layoutInfo?.description}
          {isLarge && ['forceatlas2', 'force', 'circular'].includes(layout) && (
            <span style={{ color: '#b57800' }}> · Graphe dense ({fmtNum(filteredGraph.nodes.length)} nœuds) : essayez « Communautés (Louvain) » ou « ForceAtlas2 + anti-chevauchement ».</span>
          )}
        </div>
      </div>

      <div className="graphs-layout">
        <div style={{ minHeight: 720, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)', position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 720 }} />
          {selected.size > 0 && (
            <div style={{ position: 'absolute', left: 12, bottom: 12, fontSize: 12, padding: '6px 10px', borderRadius: 999, background: 'var(--card-bg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', color: 'var(--text-secondary)' }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: SELECTED_COLOR, marginRight: 6 }} />
              {selected.size} nœud(s) sélectionné(s){isolate ? ' · sélection isolée' : ''}
            </div>
          )}
        </div>

        <div className="graphs-side-panel">
          <div style={{ ...cardStyle, minHeight: 140 }}>
            <div style={cardTitleStyle}>Détails du nœud</div>
            {focusNode && focusInfo ? (
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                <div><strong>{focusInfo.label}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>Type : {focusRole || 'hashtag'}</div>
                <div>Fréquence : {fmtNum(focusInfo.value)}</div>
                <div>Degré : {focusInfo.degree}</div>
                <div>Voisins directs : {directCount}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" style={smallButton} onClick={() => centerOn(focusNode)}>Centrer la vue</button>
                  <button type="button" style={smallButton} onClick={() => setFocusNode(null)}>Fermer</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Cliquez sur un nœud pour afficher ses informations et son voisinage. Maj + clic ajoute ou retire un nœud de la sélection sans changer de nœud principal.
              </div>
            )}
          </div>

          {focusNode && focusInfo && (
            <div style={cardStyle}>
              <div style={{ ...cardTitleStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>Voisinage</span>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
                  Niveau
                  {[1, 2, 3].map((level) => (
                    <button key={level} type="button" aria-pressed={depth === level} onClick={() => setDepth(level)} style={{ ...smallButton, padding: '2px 8px', background: depth === level ? 'var(--accent)' : 'var(--card-bg)', color: depth === level ? '#fff' : 'var(--text-primary)' }}>{level}</button>
                  ))}
                </span>
              </div>
              <input type="search" value={neighborQuery} onChange={(event) => setNeighborQuery(event.target.value)} placeholder="Rechercher un nœud dans la liste…" aria-label="Rechercher un voisin" style={{ ...inputStyle, width: '100%', fontSize: 12, marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <button type="button" style={smallButton} onClick={selectAll}>Tout sélectionner</button>
                <button type="button" style={smallButton} onClick={deselectAll}>Tout désélectionner</button>
                <button type="button" style={smallButton} onClick={directOnly}>Voisins directs uniquement</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {fmtNum(neighborhood.length - 1)} voisin(s) jusqu’au niveau {depth}{query ? ` · ${visibleNeighbors.length} affiché(s)` : ''} · {neighborhood.filter((item) => selected.has(item.id)).length} sélectionné(s)
              </div>
              <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {visibleNeighbors.slice(0, MAX_NEIGHBOR_ROWS).map((item) => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, background: item.id === focusNode ? 'var(--accent-dim)' : undefined }}>
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleNode(item.id)} aria-label={`Sélectionner ${item.label}`} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: item.id === focusNode ? 700 : 500 }} title={item.label}>
                      {item.label}{item.id === focusNode ? ' (principal)' : ''}
                    </span>
                    {item.distance > 0 && <span title="Distance au nœud principal" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'rgba(128,128,128,0.14)', color: 'var(--text-secondary)' }}>N{item.distance}</span>}
                    <span title={item.weight !== null ? 'Co-occurrences avec le nœud principal' : 'Fréquence du nœud'} style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 34, textAlign: 'right' }}>{item.weight !== null ? `×${fmtNum(item.weight)}` : fmtNum(item.value)}</span>
                    {item.id !== focusNode && <button type="button" title="Explorer le voisinage de ce nœud (la sélection est conservée)" onClick={() => focusFromList(item.id)} style={{ ...smallButton, padding: '1px 7px' }}>↗</button>}
                  </div>
                ))}
                {visibleNeighbors.length > MAX_NEIGHBOR_ROWS && (
                  <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)' }}>{visibleNeighbors.length - MAX_NEIGHBOR_ROWS} autres nœuds : affinez la recherche.</div>
                )}
              </div>
            </div>
          )}

          <div style={cardStyle}>
            <div style={cardTitleStyle}>Sous-graphe sélectionné</div>
            {selected.size === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Aucun nœud sélectionné. Cliquez sur un nœud puis cochez les voisins à conserver.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
                <div>{selected.size} nœud(s) · {selectedEdgeCount} arête(s) entre eux</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 110, overflow: 'auto' }}>
                  {selectedList.slice(0, 60).map((id) => (
                    <button key={id} type="button" onClick={() => toggleNode(id)} title="Retirer de la sélection" style={{ border: 0, cursor: 'pointer', fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgba(227,73,72,0.12)', color: SELECTED_COLOR }}>
                      {labelOf(id)} ×
                    </button>
                  ))}
                  {selectedList.length > 60 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{selectedList.length - 60}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <input type="checkbox" checked={isolate} onChange={(event) => setIsolate(event.target.checked)} /> Isoler la sélection
                  </label>
                  <button type="button" style={smallButton} onClick={() => setSelected(new Set())}>Vider la sélection</button>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Exporter le sous-graphe</div>
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={includeRaw} onChange={(event) => setIncludeRaw(event.target.checked)} /> Inclure les données brutes des posts (raw_json)
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" disabled={exportState.busy} style={{ ...smallButton, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }} onClick={() => exportSubgraph('json')}>JSON complet</button>
                    <button type="button" disabled={exportState.busy} style={smallButton} onClick={() => exportSubgraph('csv')}>CSV (nœuds, arêtes, posts)</button>
                    <button type="button" disabled={exportState.busy} style={smallButton} onClick={() => exportSubgraph('gexf')}>GEXF (Gephi)</button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    JSON et CSV incluent les posts contenant au moins un nœud sélectionné (champs <code>subgraph_nodes</code> / <code>subgraph_edges</code>), avec les filtres actifs. GEXF : graphe seul.
                  </div>
                  {exportState.message && <div style={{ fontSize: 12, color: exportState.error ? '#e34948' : '#1d9e75' }}>{exportState.message}</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Instructions and Résumé moved to bottom */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 12 }}>
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Instructions</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            - Zoom avec la molette, déplacement par clic-glisser
            <br />- Choisissez une spatialisation adaptée : « Communautés » ou « anti-chevauchement » pour les graphes denses
            <br />- Cliquez sur un nœud pour afficher son voisinage (niveaux 1 à 3) dans le panneau de droite
            <br />- Cochez les voisins à conserver ; ↗ explore depuis un voisin sans perdre la sélection
            <br />- Maj + clic sur un nœud l’ajoute ou le retire de la sélection
            <br />- Exportez le sous-graphe (nœuds sélectionnés + arêtes entre eux + posts liés)
            <br />- Reset view pour revenir à l’ensemble
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardTitleStyle}>Résumé</div>
          <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div>{fmtNum(filteredGraph.nodes.length)} nœuds affichés sur {fmtNum(currentGraph.nodes.length)} chargés</div>
            <div>{fmtNum(filteredGraph.links.length)} relations affichées sur {fmtNum(currentGraph.links.length)}</div>
            <div>Épaisseur des arêtes : occurrences, échelle logarithmique</div>
            <div>{activeGraph === 'mentions' ? 'Vue mentions / auteurs' : 'Vue hashtags'} · {layoutInfo?.label}</div>
            {focusNode && <div style={{ color: '#2a78d6' }}>Exploration de voisinage active</div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Statistiques
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ background: 'rgba(42,120,214,0.12)', color: '#2a78d6', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12 }}>
            {fmtNum(graphData?.mentions.links.length ?? mentionStats.relations.length)} relations de mentions
          </span>
          <span style={{ background: 'rgba(29,158,117,0.12)', color: '#1d9e75', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12 }}>
            {fmtNum(graphData?.hashtags.links.length ?? hashtagStats.relations.length)} relations de hashtags
          </span>
        </div>
      </div>
    </div>
  );
};

export default GraphsTab;
