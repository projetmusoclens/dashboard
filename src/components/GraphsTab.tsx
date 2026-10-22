import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
// Rendu Sigma.js (WebGL) sur un graphe graphology ; dispositions dans utils/graphLayouts.
// @ts-ignore
import Graph from 'graphology';
import { GraphResponse, GraphType, QueryParams } from '../types';
import api from '../services/api';
import { fmtNum } from '../utils/format';
import { CHART_COLORS } from '../data/dashboardData';
import { GRAPH_DEFAULT_NODES, GRAPH_MAX_NODES } from '../config';
import {
  bfsDistances, computeLayout, DEFAULT_LAYOUT_PARAMS, detectCommunities, LARGE_GRAPH_NODES, LAYOUT_PARAM_KEYS, LAYOUTS,
  LayoutId, LayoutParams, layoutUsesFocus, runBackgroundLayout, usesBackgroundLayout,
} from '../utils/graphLayouts';
import { buildSubgraph, edgesToCsv, nodesToCsv, postsToCsv, SubgraphMeta, subgraphToGexf } from '../utils/subgraphExport';
import { downloadFile, fileSlug } from '../utils/download';

interface GraphsTabProps {
  filters?: QueryParams;
}

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

// Couleur stable par identifiant de nœud.
const colorForId = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  if (id.startsWith('@')) return hslToHex(hue, 60, 48);
  if (id.startsWith('#')) return hslToHex((hue + 80) % 360, 60, 42);
  return hslToHex(hue, 50, 45);
};

const edgeSizeForWeight = (w: number | undefined) => {
  const v = typeof w === 'number' ? w : Number(w) || 1;
  // Échelle logarithmique pour éviter des arêtes démesurées.
  const size = Math.log(v + 1) * 1.8;
  return Math.max(0.6, Math.min(10, size));
};

const paramsKey = (layout: LayoutId, params: LayoutParams) => JSON.stringify(LAYOUT_PARAM_KEYS[layout].map((key) => params[key]));
const layoutKey = (layout: LayoutId, params: LayoutParams, focus: string | null) => `${layout}|${paramsKey(layout, params)}|${layoutUsesFocus(layout) ? focus : ''}`;

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
const paramLabelStyle: React.CSSProperties = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-secondary)' };

// Définition des contrôles de « Paramètres avancés ».
const PARAM_CONTROLS: Record<keyof LayoutParams, { label: string; help: string; kind: 'range' | 'checkbox' | 'select'; min?: number; max?: number; step?: number; options?: [string, string][] }> = {
  spacing: { label: 'Espacement', help: 'ForceAtlas2 : facteur d’échelle ; force : répulsion ; anneaux et niveaux : écart.', kind: 'range', min: 0.3, max: 5, step: 0.1 },
  gravity: { label: 'Gravité', help: 'Attraction vers le centre : plus haut, graphe plus compact.', kind: 'range', min: 0, max: 3, step: 0.05 },
  strongGravity: { label: 'Gravité forte', help: 'Ramène les composantes isolées vers le centre.', kind: 'checkbox' },
  linLog: { label: 'Mode LinLog', help: 'Sépare davantage les communautés.', kind: 'checkbox' },
  edgeWeightInfluence: { label: 'Influence des poids', help: '0 : poids ignorés ; 1 : les liens fréquents rapprochent davantage.', kind: 'range', min: 0, max: 2, step: 0.1 },
  barnesHut: { label: 'Approximation Barnes-Hut', help: 'Accélère les grands graphes au prix d’un peu de précision.', kind: 'select', options: [['auto', 'Auto (> 500 nœuds)'], ['on', 'Activée'], ['off', 'Désactivée']] },
  durationSec: { label: 'Durée du calcul (s)', help: 'Temps laissé à l’algorithme ; plus long = plus stable.', kind: 'range', min: 1, max: 20, step: 1 },
  noverlapMargin: { label: 'Marge anti-chevauchement', help: 'Distance minimale entre nœuds après ForceAtlas2.', kind: 'range', min: 0, max: 10, step: 0.5 },
  resolution: { label: 'Résolution Louvain', help: 'Plus haut = plus de communautés, plus petites.', kind: 'range', min: 0.2, max: 3, step: 0.1 },
};

const GraphsTab: React.FC<GraphsTabProps> = ({ filters = {} }) => {
  const [activeGraph, setActiveGraph] = useState<GraphType>('hashtags');
  const [layout, setLayout] = useState<LayoutId>('forceatlas2');
  const [params, setParams] = useState<LayoutParams>(DEFAULT_LAYOUT_PARAMS);
  const [appliedParams, setAppliedParams] = useState<LayoutParams>(DEFAULT_LAYOUT_PARAMS);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [colorByCommunity, setColorByCommunity] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [nodeLimitInput, setNodeLimitInput] = useState<number>(GRAPH_DEFAULT_NODES);
  const [nodeLimit, setNodeLimit] = useState<number>(GRAPH_DEFAULT_NODES);
  const [minEdgeInput, setMinEdgeInput] = useState<number>(1);
  const [minEdgeWeight, setMinEdgeWeight] = useState<number>(1);
  const [minNodeValue, setMinNodeValue] = useState<number>(1);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [depth, setDepth] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [neighborQuery, setNeighborQuery] = useState('');
  const [isolate, setIsolate] = useState(false);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [exportState, setExportState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: '', error: false });
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Plein écran du graphe seul (sans réglages ni panneau latéral) : API du navigateur,
  // ou plein fenêtre en CSS quand elle n'est pas disponible.
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const sigmaRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const appliedLayoutRef = useRef('');
  const stopLayoutRef = useRef<(() => void) | null>(null);
  const cacheRef = useRef(new Map<string, GraphResponse>());

  // Les champs numériques et les curseurs ne relancent le chargement ou le calcul qu'une fois la saisie terminée.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNodeLimit(Math.min(GRAPH_MAX_NODES, Math.max(10, nodeLimitInput || GRAPH_DEFAULT_NODES)));
      setMinEdgeWeight(Math.max(1, minEdgeInput || 1));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [nodeLimitInput, minEdgeInput]);
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedParams(params), 400);
    return () => window.clearTimeout(timer);
  }, [params]);

  // Chargement du graphe à l'ouverture de l'onglet : seulement le type affiché et le nombre de nœuds demandé.
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    const key = `${activeGraph}|${filtersKey}|${nodeLimit}|${minEdgeWeight}`;
    const hit = cacheRef.current.get(key);
    if (hit) { setGraphData(hit); setLoadError(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.getGraph(activeGraph, { ...(JSON.parse(filtersKey) as QueryParams), maxNodes: nodeLimit, minEdgeWeight })
      .then((result) => {
        if (cancelled) return;
        cacheRef.current.set(key, result);
        while (cacheRef.current.size > 8) cacheRef.current.delete(cacheRef.current.keys().next().value as string);
        setGraphData(result);
      })
      .catch((error) => { if (!cancelled) setLoadError(error.message || String(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeGraph, filtersKey, nodeLimit, minEdgeWeight]);

  // Nœuds affichés : ceux du graphe chargé (les plus fréquents) au-dessus de la valeur minimale.
  const filteredGraph = useMemo(() => {
    const nodes = (graphData?.nodes || [])
      .filter((node) => node.value >= minNodeValue)
      .map((node) => ({ ...node, color: colorForId(node.id) }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links = (graphData?.links || []).filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
    return { nodes, links };
  }, [graphData, minNodeValue]);

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

  // Construction du graphe et du rendu Sigma ; la disposition est appliquée ensuite par l'effet suivant.
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const container = containerRef.current;

    const graph = new (Graph as any)({ type: 'undirected', allowSelfLoops: false });
    filteredGraph.nodes.forEach((n) => {
      // `type` est le type de rendu Sigma ; le rôle sémantique est gardé dans `role`.
      const baseSize = Math.max(3, Math.min(18, 2 + Math.sqrt(n.value) * 1.4));
      graph.mergeNode(n.id, { label: n.label || n.id, value: n.value, size: baseSize, color: n.color, baseColor: n.color, type: 'circle', role: activeGraph === 'mentions' ? 'compte' : 'hashtag' });
    });
    filteredGraph.links.forEach((l) => {
      if (l.source === l.target || !graph.hasNode(l.source) || !graph.hasNode(l.target)) return;
      const existing = graph.edge(l.source, l.target);
      if (existing) graph.updateEdgeAttribute(existing, 'weight', (weight: number) => (weight || 0) + l.value);
      else graph.addEdge(l.source, l.target, { weight: l.value });
    });
    graph.forEachEdge((edge: string, attributes: any) => graph.setEdgeAttribute(edge, 'size', edgeSizeForWeight(attributes.weight)));
    const communities = detectCommunities(graph, appliedParams.resolution);
    graph.forEachNode((node: string, attributes: any) => graph.mergeNodeAttributes(node, { community: communities[node] ?? 0, x: attributes.x ?? Math.random(), y: attributes.y ?? Math.random() }));
    appliedLayoutRef.current = '';
    graphRef.current = graph;

    setSelected((previous) => {
      const kept = new Set(Array.from(previous).filter((id) => graph.hasNode(id)));
      return kept.size === previous.size ? previous : kept;
    });
    setFocusNode((previous) => (previous && graph.hasNode(previous) ? previous : null));
    setGraphVersion((version) => version + 1);

    // Sigma requires browser WebGL globals and must not be loaded by jsdom tests.
    if (typeof WebGL2RenderingContext === 'undefined') {
      return () => { graphRef.current = null; };
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SigmaLib: any = require('sigma').default;
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
      stopLayoutRef.current?.();
      try { if (renderer && typeof renderer.kill === 'function') renderer.kill(); } catch (e) {}
      try { if (graph && typeof graph.clear === 'function') graph.clear(); } catch (e) {}
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // La résolution Louvain est appliquée par un effet dédié, sans reconstruire le rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredGraph, activeGraph]);

  // Résolution Louvain modifiée : nouvelles communautés (couleurs, dispositions par communauté).
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const communities = detectCommunities(graph, appliedParams.resolution);
    graph.forEachNode((node: string) => graph.setNodeAttribute(node, 'community', communities[node] ?? 0));
    sigmaRef.current?.refresh();
  }, [appliedParams.resolution, graphVersion]);

  // Disposition : appliquée après chaque construction, et à chaque changement de disposition ou de paramètre.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !graph.order) return undefined;
    const focus = layoutUsesFocus(layout) && focusNode && graph.hasNode(focusNode) ? focusNode : null;
    const key = layoutKey(layout, appliedParams, focus);
    if (key === appliedLayoutRef.current) return undefined;
    appliedLayoutRef.current = key;
    stopLayoutRef.current?.();
    setLayoutBusy(true);
    const renderer = sigmaRef.current;
    const finish = () => {
      setLayoutBusy(false);
      sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
    };

    // Calcul en continu, en tâche de fond, quand le navigateur le permet.
    if (renderer && usesBackgroundLayout(layout) && typeof Worker !== 'undefined') {
      try {
        stopLayoutRef.current = runBackgroundLayout(graph, layout, appliedParams, finish);
        return undefined;
      } catch (err) {
        // Worker indisponible (navigateur, politique de sécurité) : calcul classique ci-dessous.
        console.warn('Background layout unavailable, falling back to synchronous layout', err);
      }
    }
    const timer = window.setTimeout(() => {
      let positions: Record<string, { x: number; y: number }>;
      try {
        positions = computeLayout(graph, layout, { params: appliedParams, focus });
      } catch (err) {
        console.warn('Layout failed', err);
        setLayoutBusy(false);
        return;
      }
      if (graphRef.current !== graph) return;
      if (!renderer) {
        graph.forEachNode((node: string) => graph.mergeNodeAttributes(node, positions[node]));
        setLayoutBusy(false);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { animateNodes } = require('sigma/utils');
      stopLayoutRef.current = animateNodes(graph, positions, { duration: 500 }, finish);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [layout, appliedParams, focusNode, graphVersion]);

  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [focusNode, selected, neighborhoodIds, showEdges, isolate, colorByCommunity]);

  useEffect(() => () => stopLayoutRef.current?.(), []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === canvasWrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!pseudoFullscreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPseudoFullscreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pseudoFullscreen]);

  // Le graphe change de taille : Sigma doit recalculer sa zone de dessin.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const renderer = sigmaRef.current;
      if (!renderer) return;
      renderer.resize?.();
      renderer.refresh?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fullscreen, pseudoFullscreen]);

  const isFullscreen = fullscreen || pseudoFullscreen;
  const toggleFullscreen = () => {
    if (pseudoFullscreen) { setPseudoFullscreen(false); return; }
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const target = canvasWrapRef.current;
    if (target && document.fullscreenEnabled && target.requestFullscreen) target.requestFullscreen().catch(() => setPseudoFullscreen(true));
    else setPseudoFullscreen(true);
  };

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

  const exportMeta = (nodeCount: number, edgeCount: number): SubgraphMeta => ({
    generated_at: new Date().toISOString(),
    graph_type: activeGraph,
    layout,
    filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => typeof value === 'string' && value)) as Record<string, string>,
    node_count: nodeCount,
    edge_count: edgeCount,
  });

  // Graphe affiché en entier, au format GEXF (Gephi).
  const exportDisplayedGraph = () => {
    const graph = graphRef.current;
    if (!graph?.order) return;
    const { nodes, edges } = buildSubgraph(graph, graph.nodes());
    const meta = exportMeta(nodes.length, edges.length);
    downloadFile(subgraphToGexf(nodes, edges, meta), `graphe_${activeGraph}_${meta.generated_at.slice(0, 10)}.gexf`, 'application/xml;charset=utf-8');
  };

  const exportSubgraph = async (format: 'json' | 'csv' | 'gexf') => {
    const graph = graphRef.current;
    if (!graph || !selected.size) return;
    const { nodes, edges } = buildSubgraph(graph, selected);
    const meta = exportMeta(nodes.length, edges.length);
    const base = `sous-graphe_${activeGraph}_${fileSlug(labelOf(focusNode || nodes[0].id))}_${meta.generated_at.slice(0, 10)}`;
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
  const paramKeys = LAYOUT_PARAM_KEYS[layout];
  const setParam = <K extends keyof LayoutParams>(key: K, value: LayoutParams[K]) => setParams((current) => ({ ...current, [key]: value }));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={() => setActiveGraph('hashtags')} style={pillButton(activeGraph === 'hashtags')}>Hashtags</button>
        <button type="button" onClick={() => setActiveGraph('mentions')} style={pillButton(activeGraph === 'mentions', '#2a78d6')}>Mentions</button>
        <button type="button" onClick={() => setShowEdges(!showEdges)} style={{ ...pillButton(showEdges), color: showEdges ? '#1d9e75' : 'var(--text-secondary)', background: showEdges ? 'rgba(29,158,117,0.12)' : 'rgba(99,99,99,0.08)', border: '1px solid var(--border)' }}>
          {showEdges ? 'Masquer les arêtes' : 'Afficher les arêtes'}
        </button>
        <button type="button" onClick={resetView} style={pillButton(false)}>Reset view</button>
        <button type="button" onClick={toggleFullscreen} style={{ ...pillButton(isFullscreen, '#2a78d6'), display: 'inline-flex', alignItems: 'center', gap: 6 }} title={isFullscreen ? 'Quitter le plein écran (Échap)' : 'Afficher le graphe en plein écran'}>
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />} {isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 6, flexWrap: 'wrap' }}>
          <label htmlFor="graph-node-limit" style={{ fontSize: 12, color: 'var(--text-muted)' }} title="Les nœuds les plus fréquents sont gardés">Nœuds :</label>
          <input id="graph-node-limit" type="number" min={10} max={GRAPH_MAX_NODES} step={50} value={nodeLimitInput} onChange={(e) => setNodeLimitInput(Number(e.target.value))} style={{ ...inputStyle, width: 90 }} />
          <label htmlFor="graph-min-value" style={{ fontSize: 12, color: 'var(--text-muted)' }} title="Fréquence minimale d’un nœud">Fréq. min. :</label>
          <input id="graph-min-value" type="number" min={1} value={minNodeValue} onChange={(e) => setMinNodeValue(Math.max(1, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 70 }} />
          <label htmlFor="graph-min-edge" style={{ fontSize: 12, color: 'var(--text-muted)' }} title="Nombre minimal de posts pour garder une arête">Poids min. des arêtes :</label>
          <input id="graph-min-edge" type="number" min={1} value={minEdgeInput} onChange={(e) => setMinEdgeInput(Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
        </div>
      </div>

      <div style={{ ...cardStyle, padding: '10px 14px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="graph-layout" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Spatialisation du graphe :</label>
        <select id="graph-layout" value={layout} onChange={(event) => setLayout(event.target.value as LayoutId)} style={{ ...inputStyle, minWidth: 260 }}>
          {LAYOUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <button type="button" style={smallButton} aria-expanded={paramsOpen} onClick={() => setParamsOpen((open) => !open)}>{paramsOpen ? '▾' : '▸'} Paramètres avancés</button>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={colorByCommunity} onChange={(event) => setColorByCommunity(event.target.checked)} /> Couleurs par communauté (Louvain)
        </label>
        {layoutBusy && <span style={{ fontSize: 12, color: '#2a78d6', fontWeight: 600 }}>Calcul de la disposition…</span>}
        {loading && <span style={{ fontSize: 12, color: '#2a78d6', fontWeight: 600 }}>Chargement du graphe…</span>}
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {layoutInfo?.description}
          {isLarge && ['forceatlas2', 'force', 'circular'].includes(layout) && (
            <span style={{ color: '#b57800' }}> · Graphe dense ({fmtNum(filteredGraph.nodes.length)} nœuds) : essayez « Communautés (Louvain) » ou « ForceAtlas2 + anti-chevauchement ».</span>
          )}
        </div>
        {paramsOpen && (
          <div style={{ flexBasis: '100%', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            {paramKeys.map((key) => {
              const control = PARAM_CONTROLS[key];
              const value = params[key];
              return (
                <label key={key} style={paramLabelStyle} title={control.help}>
                  <span style={{ fontWeight: 700 }}>
                    {control.label}{control.kind === 'range' ? ` : ${value}` : ''}
                  </span>
                  {control.kind === 'range' && (
                    <input type="range" min={control.min} max={control.max} step={control.step} value={Number(value)} onChange={(event) => setParam(key, Number(event.target.value) as never)} />
                  )}
                  {control.kind === 'checkbox' && (
                    <input type="checkbox" checked={Boolean(value)} onChange={(event) => setParam(key, event.target.checked as never)} style={{ justifySelf: 'start' }} />
                  )}
                  {control.kind === 'select' && (
                    <select value={String(value)} onChange={(event) => setParam(key, event.target.value as never)} style={{ ...inputStyle, fontSize: 12 }}>
                      {control.options?.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
                    </select>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{control.help}</span>
                </label>
              );
            })}
            {paramKeys.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cette disposition n’a pas de paramètre.</span>}
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button type="button" style={smallButton} onClick={() => setParams(DEFAULT_LAYOUT_PARAMS)}>Valeurs par défaut</button>
            </div>
          </div>
        )}
      </div>

      {loadError && <div style={{ ...cardStyle, color: '#e34948', fontSize: 13 }}>Graphe indisponible : {loadError}</div>}

      <div className="graphs-layout">
        <div ref={canvasWrapRef} className={`graph-canvas-wrap ${pseudoFullscreen ? 'graph-canvas-wrap--fullscreen' : ''}`} style={{ minHeight: 720, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--card-bg)', position: 'relative' }}>
          <div ref={containerRef} className="graph-canvas" style={{ width: '100%', height: '100%', minHeight: 720 }} />
          <button type="button" className="graph-fullscreen-button" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Quitter le plein écran' : 'Afficher le graphe en plein écran'} title={isFullscreen ? 'Quitter le plein écran (Échap)' : 'Plein écran'}>
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {isFullscreen && <span>Quitter le plein écran</span>}
          </button>
          {isFullscreen && layoutBusy && <div className="graph-fullscreen-status">Calcul de la disposition…</div>}
          {!loading && graphData && filteredGraph.nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Aucun nœud pour ces filtres.</div>
          )}
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
                {focusInfo.label !== focusNode && <div style={{ color: 'var(--text-muted)', fontSize: 11, overflowWrap: 'anywhere' }}>{focusNode}</div>}
                <div style={{ color: 'var(--text-muted)' }}>Type : {activeGraph === 'mentions' ? 'compte' : 'hashtag'}</div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 12 }}>
        <div style={cardStyle}>
          <div style={cardTitleStyle}>Lire le graphe</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {activeGraph === 'hashtags'
              ? <>Un nœud est un hashtag ; sa taille dépend du nombre de posts qui le contiennent. Une arête relie deux hashtags présents dans un même post ; son épaisseur dépend du nombre de ces posts.</>
              : <>Un nœud est un compte, auteur ou mentionné. Une arête relie un auteur à un compte qu’il a mentionné ; son épaisseur dépend du nombre de ces posts (le sens de la mention n’est pas conservé). Les comptes Bluesky sont identifiés par leur DID et affichés avec leur pseudo.</>}
            <br />Seuls les <strong>nœuds les plus fréquents</strong> sont chargés (champ « Nœuds »), puis filtrés par fréquence minimale ; les arêtes de poids inférieur au minimum sont écartées.
            <br />Molette : zoom · clic-glisser : déplacement · clic sur un nœud : voisinage · Maj + clic : sélection.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={cardTitleStyle}>Résumé</div>
          <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div>{fmtNum(filteredGraph.nodes.length)} nœuds affichés sur {fmtNum(graphData?.total_nodes ?? filteredGraph.nodes.length)} au total pour ces filtres</div>
            <div>{fmtNum(filteredGraph.links.length)} relations affichées sur {fmtNum(graphData?.total_links ?? filteredGraph.links.length)} au total</div>
            <div>{activeGraph === 'mentions' ? 'Vue mentions / comptes' : 'Vue hashtags'} · {layoutInfo?.label}</div>
            {focusNode && <div style={{ color: '#2a78d6' }}>Exploration de voisinage active</div>}
            <div>
              <button type="button" style={smallButton} disabled={!filteredGraph.nodes.length} onClick={exportDisplayedGraph}>Exporter le graphe affiché (GEXF)</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GraphsTab;
