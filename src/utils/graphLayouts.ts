// Spatialisations proposées dans l'onglet Graphes. Les algorithmes de force et de communautés viennent
// de l'écosystème graphology déjà utilisé par Sigma ; les dispositions géométriques (cercle, anneaux,
// radial, niveaux) sont de simples placements calculés ici.
// @ts-ignore
import forceAtlas2 from 'graphology-layout-forceatlas2';
// @ts-ignore
import forceLayout from 'graphology-layout-force';
// @ts-ignore
import noverlap from 'graphology-layout-noverlap';
// @ts-ignore
import circlepack from 'graphology-layout/circlepack';
// @ts-ignore
import louvain from 'graphology-communities-louvain';

// Réglages exposés dans « Paramètres avancés » ; chaque disposition n'utilise que les siens.
export interface LayoutParams {
  spacing: number;            // ForceAtlas2 : scalingRatio = 10 × spacing ; force : répulsion ; anneaux et niveaux : écart
  gravity: number;            // ForceAtlas2 : attraction vers le centre
  strongGravity: boolean;     // ForceAtlas2 : gravité forte (graphes déconnectés plus compacts)
  linLog: boolean;            // ForceAtlas2 : mode LinLog, communautés plus séparées
  edgeWeightInfluence: number; // ForceAtlas2 : 0 = poids ignorés, 1 = proportionnel
  barnesHut: 'auto' | 'on' | 'off'; // ForceAtlas2 : approximation rapide pour les grands graphes (auto : > 500 nœuds)
  durationSec: number;        // durée du calcul en tâche de fond (ForceAtlas2, force)
  noverlapMargin: number;     // Noverlap : marge entre nœuds
  resolution: number;         // Louvain : > 1 = plus de communautés, < 1 = moins
}

export const DEFAULT_LAYOUT_PARAMS: LayoutParams = {
  spacing: 1,
  gravity: 0.05,
  strongGravity: true,
  linLog: false,
  edgeWeightInfluence: 1,
  barnesHut: 'auto',
  durationSec: 4,
  noverlapMargin: 2,
  resolution: 1,
};

export type LayoutId = 'forceatlas2' | 'forceatlas2-noverlap' | 'force' | 'communities' | 'circular' | 'concentric' | 'radial' | 'hierarchical';
export type Positions = Record<string, { x: number; y: number }>;

export type LayoutParamKey = keyof LayoutParams;

const FA2_PARAMS: LayoutParamKey[] = ['spacing', 'gravity', 'strongGravity', 'linLog', 'edgeWeightInfluence', 'barnesHut', 'durationSec'];

// Paramètres pertinents pour chaque disposition.
export const LAYOUT_PARAM_KEYS: Record<LayoutId, LayoutParamKey[]> = {
  forceatlas2: FA2_PARAMS,
  'forceatlas2-noverlap': [...FA2_PARAMS, 'noverlapMargin'],
  force: ['spacing', 'durationSec'],
  communities: ['resolution'],
  circular: ['resolution'],
  concentric: ['spacing'],
  radial: ['spacing'],
  hierarchical: ['spacing'],
};

export const LAYOUTS: { id: LayoutId; label: string; description: string; usesSpacing: boolean }[] = [
  { id: 'forceatlas2', label: 'Force-directed (ForceAtlas2)', description: 'Disposition par défaut : les nœuds liés se rapprochent. Adaptée aux petits et moyens graphes.', usesSpacing: true },
  { id: 'forceatlas2-noverlap', label: 'ForceAtlas2 + anti-chevauchement', description: 'ForceAtlas2 suivi de Noverlap, qui écarte les nœuds superposés : plus lisible quand le graphe est dense.', usesSpacing: true },
  { id: 'force', label: 'Force-directed simple (ressorts)', description: 'Modèle ressorts / répulsion classique, proche de Fruchterman-Reingold. Coûteux au-delà de ~1 500 nœuds.', usesSpacing: true },
  { id: 'communities', label: 'Communautés (Louvain)', description: 'Détecte les communautés (Louvain) et regroupe chacune dans un cercle : la plus lisible pour les grands graphes.', usesSpacing: false },
  { id: 'circular', label: 'Circulaire', description: 'Nœuds sur un cercle, groupés par communauté puis par degré.', usesSpacing: false },
  { id: 'concentric', label: 'Concentrique (par degré)', description: 'Anneaux : les nœuds les plus connectés au centre.', usesSpacing: true },
  { id: 'radial', label: 'Radial (autour du nœud sélectionné)', description: 'Anneaux selon la distance au nœud sélectionné (ou au plus connecté) : idéal pour lire un voisinage.', usesSpacing: true },
  { id: 'hierarchical', label: 'Hiérarchique (niveaux)', description: 'Niveaux successifs depuis le nœud sélectionné (ou le plus connecté de chaque composante).', usesSpacing: true },
];

export const LARGE_GRAPH_NODES = 600;

// Générateur pseudo-aléatoire déterministe : un même layout redonne la même image.
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededPositions(graph: any) {
  const copy = graph.copy();
  const random = seededRandom(42);
  copy.forEachNode((node: string) => {
    copy.setNodeAttribute(node, 'x', (random() - 0.5) * 100);
    copy.setNodeAttribute(node, 'y', (random() - 0.5) * 100);
  });
  return copy;
}

const edgeWeight = (_edge: string, attributes: any) => Math.log1p(Number(attributes?.weight) || 1);

// Communautés Louvain ; un graphe sans arête donne une communauté par composante triviale.
export function detectCommunities(graph: any, resolution = 1): Record<string, number> {
  if (!graph.order) return {};
  if (!graph.size) {
    const result: Record<string, number> = {};
    graph.forEachNode((node: string, index: number) => { result[node] = index; });
    return result;
  }
  try {
    return louvain(graph, { getEdgeWeight: 'weight', resolution, rng: seededRandom(7) });
  } catch {
    const result: Record<string, number> = {};
    graph.forEachNode((node: string) => { result[node] = 0; });
    return result;
  }
}

function fa2Settings(graph: any, params: LayoutParams) {
  return {
    ...forceAtlas2.inferSettings(graph),
    scalingRatio: 10 * params.spacing,
    gravity: params.gravity,
    strongGravityMode: params.strongGravity,
    linLogMode: params.linLog,
    edgeWeightInfluence: params.edgeWeightInfluence,
    barnesHutOptimize: params.barnesHut === 'auto' ? graph.order > 500 : params.barnesHut === 'on',
  };
}

const noverlapSettings = (params: LayoutParams) => ({ margin: params.noverlapMargin, ratio: 1.4, expansion: 1.1 });
const springSettings = (params: LayoutParams) => ({ attraction: 0.0005, repulsion: 0.1 * params.spacing, gravity: 0.0001, inertia: 0.6, maxMove: 200 });

function forceAtlasPositions(graph: any, params: LayoutParams): Positions {
  const copy = withSeededPositions(graph);
  const order = copy.order;
  return forceAtlas2(copy, {
    iterations: order < 500 ? 300 : order < 1500 ? 150 : 100,
    getEdgeWeight: edgeWeight,
    settings: fa2Settings(copy, params),
  });
}

function withNoverlap(graph: any, positions: Positions, params: LayoutParams): Positions {
  const copy = graph.copy();
  copy.forEachNode((node: string) => {
    copy.setNodeAttribute(node, 'x', positions[node].x);
    copy.setNodeAttribute(node, 'y', positions[node].y);
  });
  return noverlap(copy, { maxIterations: 150, settings: noverlapSettings(params) });
}

function springPositions(graph: any, params: LayoutParams): Positions {
  const copy = withSeededPositions(graph);
  return forceLayout(copy, { maxIterations: copy.order > 1000 ? 120 : 300, settings: springSettings(params) });
}

function byCommunityThenDegree(graph: any): string[] {
  return graph.nodes().sort((left: string, right: string) => {
    const leftCommunity = Number(graph.getNodeAttribute(left, 'community')) || 0;
    const rightCommunity = Number(graph.getNodeAttribute(right, 'community')) || 0;
    return leftCommunity - rightCommunity || graph.degree(right) - graph.degree(left);
  });
}

function circularPositions(graph: any): Positions {
  const nodes = byCommunityThenDegree(graph);
  const positions: Positions = {};
  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(nodes.length, 1);
    positions[node] = { x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 };
  });
  return positions;
}

// Place des groupes successifs (anneaux) de nœuds autour du centre.
function ringPositions(rings: string[][], spacing: number): Positions {
  const positions: Positions = {};
  rings.forEach((ring, depth) => {
    const radius = depth * 30 * spacing;
    ring.forEach((node, index) => {
      if (depth === 0 && ring.length === 1) { positions[node] = { x: 0, y: 0 }; return; }
      const angle = (2 * Math.PI * index) / ring.length + depth * 0.37;
      positions[node] = { x: Math.cos(angle) * Math.max(radius, 15), y: Math.sin(angle) * Math.max(radius, 15) };
    });
  });
  return positions;
}

function concentricPositions(graph: any, spacing: number): Positions {
  const nodes = graph.nodes().sort((left: string, right: string) => graph.degree(right) - graph.degree(left));
  const rings: string[][] = [];
  let index = 0;
  for (let depth = 0; index < nodes.length; depth += 1) {
    const capacity = depth === 0 ? 1 : 8 * depth;
    rings.push(nodes.slice(index, index + capacity));
    index += capacity;
  }
  return ringPositions(rings, spacing);
}

export function bfsDistances(graph: any, source: string, maxDepth = Infinity): Map<string, { distance: number; parent: string | null }> {
  const result = new Map<string, { distance: number; parent: string | null }>();
  if (!graph.hasNode(source)) return result;
  result.set(source, { distance: 0, parent: null });
  let frontier = [source];
  for (let depth = 1; frontier.length && depth <= maxDepth; depth += 1) {
    const next: string[] = [];
    frontier.forEach((node) => {
      graph.forEachNeighbor(node, (neighbor: string) => {
        if (result.has(neighbor)) return;
        result.set(neighbor, { distance: depth, parent: node });
        next.push(neighbor);
      });
    });
    frontier = next;
  }
  return result;
}

function mostConnected(graph: any, nodes: string[]): string {
  return nodes.reduce((best, node) => (graph.degree(node) > graph.degree(best) ? node : best), nodes[0]);
}

// Couches BFS ordonnées par position du parent, pour limiter les croisements.
function layeredGroups(graph: any, root: string): string[][] {
  const distances = bfsDistances(graph, root);
  const layers: string[][] = [];
  distances.forEach(({ distance }, node) => { (layers[distance] = layers[distance] || []).push(node); });
  const rank = new Map<string, number>([[root, 0]]);
  layers.forEach((layer, depth) => {
    if (depth === 0) return;
    layer.sort((left, right) => (rank.get(distances.get(left)?.parent || '') || 0) - (rank.get(distances.get(right)?.parent || '') || 0));
    layer.forEach((node, index) => rank.set(node, index));
  });
  return layers;
}

function radialPositions(graph: any, focus: string | null, spacing: number): Positions {
  const nodes: string[] = graph.nodes();
  if (!nodes.length) return {};
  const root = focus && graph.hasNode(focus) ? focus : mostConnected(graph, nodes);
  const rings = layeredGroups(graph, root);
  const reached = new Set(rings.flat());
  const unreached = nodes.filter((node) => !reached.has(node));
  if (unreached.length) rings.push(unreached);
  return ringPositions(rings, spacing);
}

function hierarchicalPositions(graph: any, focus: string | null, spacing: number): Positions {
  const positions: Positions = {};
  const remaining = new Set<string>(graph.nodes());
  let offsetX = 0;
  const placeComponent = (root: string) => {
    const layers = layeredGroups(graph, root);
    const width = Math.max(...layers.map((layer) => layer.length));
    layers.forEach((layer, depth) => {
      layer.forEach((node, index) => {
        positions[node] = { x: offsetX + (index - (layer.length - 1) / 2) * 12 * spacing + (width * 6 * spacing), y: -depth * 40 * spacing };
        remaining.delete(node);
      });
    });
    offsetX += width * 12 * spacing + 30;
  };
  if (focus && graph.hasNode(focus)) placeComponent(focus);
  while (remaining.size) placeComponent(mostConnected(graph, Array.from(remaining)));
  return positions;
}

// Calcul synchrone (tests, navigateurs sans web worker, dispositions géométriques).
export function computeLayout(graph: any, layout: LayoutId, { params = DEFAULT_LAYOUT_PARAMS, focus = null }: { params?: LayoutParams; focus?: string | null } = {}): Positions {
  if (!graph.order) return {};
  const { spacing } = params;
  switch (layout) {
    case 'forceatlas2-noverlap': return withNoverlap(graph, forceAtlasPositions(graph, params), params);
    case 'force': return springPositions(graph, params);
    case 'communities': return circlepack(graph, { hierarchyAttributes: ['community'], rng: seededRandom(3), scale: 100 });
    case 'circular': return circularPositions(graph);
    case 'concentric': return concentricPositions(graph, spacing);
    case 'radial': return radialPositions(graph, focus, spacing);
    case 'hierarchical': return hierarchicalPositions(graph, focus, spacing);
    default: return forceAtlasPositions(graph, params);
  }
}

export const usesBackgroundLayout = (layout: LayoutId) => layout === 'forceatlas2' || layout === 'forceatlas2-noverlap' || layout === 'force';

// Exécute une disposition de force en continu sur le graphe affiché, sans figer la page :
// ForceAtlas2 et Noverlap dans un web worker, la force simple image par image. Le graphe se met en
// place sous les yeux de l'utilisateur. Renvoie une fonction d'arrêt.
// Les modules « worker » de graphology exportent leur classe directement (CommonJS), sans `default`.
const workerClass = (module: any) => module?.default || module;

export function runBackgroundLayout(graph: any, layout: LayoutId, params: LayoutParams, onDone: () => void): () => void {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const timers: number[] = [];
  const supervisors: any[] = [];
  let finished = false;
  const stopAll = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    supervisors.forEach((supervisor) => { try { supervisor.kill(); } catch { /* déjà arrêté */ } });
    supervisors.length = 0;
  };
  const done = () => {
    if (finished) return;
    finished = true;
    stopAll();
    onDone();
  };

  // Départ identique à chaque calcul : mêmes réglages, même résultat d'ensemble.
  const random = seededRandom(42);
  graph.updateEachNodeAttributes((_node: string, attributes: any) => ({ ...attributes, x: (random() - 0.5) * 100, y: (random() - 0.5) * 100 }));
  const duration = Math.max(1, params.durationSec) * 1000;

  if (layout === 'force') {
    const ForceSupervisor = workerClass(require('graphology-layout-force/worker'));
    const supervisor = new ForceSupervisor(graph, { settings: springSettings(params), onConverged: done });
    supervisors.push(supervisor);
    supervisor.start();
    timers.push(window.setTimeout(done, duration));
    return () => { finished = true; stopAll(); };
  }

  const FA2Layout = workerClass(require('graphology-layout-forceatlas2/worker'));
  const fa2 = new FA2Layout(graph, { settings: fa2Settings(graph, params), getEdgeWeight: edgeWeight });
  supervisors.push(fa2);
  fa2.start();
  timers.push(window.setTimeout(() => {
    fa2.stop();
    if (layout !== 'forceatlas2-noverlap') { done(); return; }
    const NoverlapLayout = workerClass(require('graphology-layout-noverlap/worker'));
    const spread = new NoverlapLayout(graph, { settings: noverlapSettings(params), onConverged: done });
    supervisors.push(spread);
    spread.start();
    timers.push(window.setTimeout(done, 4000));
  }, duration));
  return () => { finished = true; stopAll(); };
  /* eslint-enable @typescript-eslint/no-var-requires */
}

// Le layout dépend du nœud sélectionné seulement pour les dispositions centrées sur lui.
export const layoutUsesFocus = (layout: LayoutId) => layout === 'radial' || layout === 'hierarchical';
