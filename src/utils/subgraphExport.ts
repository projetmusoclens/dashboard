import { GraphTime, SubgraphPost, TimeSeries } from '../types';
import { toCsv } from './download';
import { activeRuns, bucketStart } from './graphTime';

export interface SubgraphNode {
  id: string;
  label: string;
  type: string;
  frequency: number;
  degree_in_graph: number;
  degree_in_subgraph: number;
  community: number | null;
  x: number;
  y: number;
  color: string;
}

export interface SubgraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
}

export interface SubgraphMeta {
  generated_at: string;
  graph_type: 'hashtags' | 'mentions';
  layout: string;
  filters: Record<string, string>;
  node_count: number;
  edge_count: number;
  post_count?: number;
  posts_matched?: number;
  posts_truncated?: boolean;
  // Fenêtre de temps du graphe dynamique au moment de l'export.
  time_window?: { start: string; end: string; mode: string };
}

// Clé d'arête identique à celle du backend (subgraph_edges des posts).
export const subgraphEdgeId = (source: string, target: string) => [source, target].sort().join('::');

// Sous-graphe induit : les nœuds sélectionnés et toutes les arêtes existant entre eux.
export function buildSubgraph(graph: any, selectedIds: Iterable<string>): { nodes: SubgraphNode[]; edges: SubgraphEdge[] } {
  const selected = new Set(Array.from(selectedIds).filter((id) => graph.hasNode(id)));
  const edges: SubgraphEdge[] = [];
  const internalDegree = new Map<string, number>();
  graph.forEachEdge((_edge: string, attributes: any, source: string, target: string) => {
    if (!selected.has(source) || !selected.has(target)) return;
    edges.push({ id: subgraphEdgeId(source, target), source, target, weight: Number(attributes.weight) || 1 });
    internalDegree.set(source, (internalDegree.get(source) || 0) + 1);
    if (target !== source) internalDegree.set(target, (internalDegree.get(target) || 0) + 1);
  });
  const nodes = Array.from(selected).map((id) => {
    const attributes = graph.getNodeAttributes(id);
    return {
      id,
      label: attributes.label || id,
      type: attributes.role || 'hashtag',
      frequency: Number(attributes.value) || 0,
      degree_in_graph: graph.degree(id),
      degree_in_subgraph: internalDegree.get(id) || 0,
      community: attributes.community ?? null,
      x: Number(attributes.x) || 0,
      y: Number(attributes.y) || 0,
      color: attributes.baseColor || attributes.color || '#888888',
    };
  });
  return { nodes, edges };
}

export function nodesToCsv(nodes: SubgraphNode[]): string {
  return toCsv(
    ['node_id', 'label', 'type', 'frequency', 'degree_in_graph', 'degree_in_subgraph', 'community'],
    nodes.map((node) => [node.id, node.label, node.type, node.frequency, node.degree_in_graph, node.degree_in_subgraph, node.community]),
  );
}

export function edgesToCsv(edges: SubgraphEdge[]): string {
  return toCsv(['edge_id', 'source', 'target', 'weight'], edges.map((edge) => [edge.id, edge.source, edge.target, edge.weight]));
}

export function postsToCsv(posts: SubgraphPost[]): string {
  return toCsv(
    ['post_id', 'platform', 'collection', 'author_handle', 'author_id', 'timestamp', 'lang', 'is_reply', 'reply_to_id', 'is_retweet', 'is_quote', 'likes', 'reposts', 'replies', 'quotes', 'views', 'subgraph_nodes', 'subgraph_edges', 'text'],
    posts.map((post) => [
      post.post_id, post.platform, post.collection_name, post.author_handle, post.author_id, post.timestamp, post.lang,
      post.is_reply, post.reply_to_id, post.is_retweet, post.is_quote,
      post.engagement?.likes, post.engagement?.reposts, post.engagement?.replies, post.engagement?.quotes, post.engagement?.views,
      post.subgraph_nodes, post.subgraph_edges, post.text,
    ]),
  );
}

const xml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hexToRgb(color: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (match) {
    const value = parseInt(match[1], 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }
  const hsl = /^hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)$/i.exec(color.trim());
  if (!hsl) return { r: 136, g: 136, b: 136 };
  const [h, s, l] = [Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const k = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (k < 1 / 6) return p + (q - p) * 6 * k;
    if (k < 1 / 2) return q;
    if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
    return p;
  };
  return { r: Math.round(channel(h + 1 / 3) * 255), g: Math.round(channel(h) * 255), b: Math.round(channel(h - 1 / 3) * 255) };
}

// Données temporelles d'un export dynamique : séries par nœud et par arête (clé subgraphEdgeId).
export interface DynamicData {
  time: GraphTime;
  nodeSeries: Map<string, TimeSeries>;
  edgeSeries: Map<string, TimeSeries>;
}

// Dates GEXF (dateTime, sans millisecondes) : début d'une tranche, et fin une seconde avant la suivante
// pour que deux tranches consécutives ne se chevauchent pas dans Gephi.
const gexfTime = (time: number) => new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z');
const gexfStart = (time: GraphTime, index: number) => gexfTime(bucketStart(time, index));
const gexfEnd = (time: GraphTime, index: number) => gexfTime(bucketStart(time, index + 1) - 1000);

// Présence (spells) et valeur par tranche (attvalue datées) : lus par la frise de Gephi.
function dynamicParts(series: TimeSeries | undefined, time: GraphTime, attribute: string, indent: string) {
  const values = (series || []).map(([bucket, count]) => `${indent}  <attvalue for="${attribute}" value="${count}" start="${gexfStart(time, bucket)}" end="${gexfEnd(time, bucket)}"/>`);
  const spells = activeRuns(series).map(([from, to]) => `${indent}  <spell start="${gexfStart(time, from)}" end="${gexfEnd(time, to)}"/>`);
  return { values, spells: spells.length ? [`${indent}<spells>`, ...spells, `${indent}</spells>`] : [] };
}

// GEXF 1.3 (Gephi) : nœuds, arêtes pondérées, attributs et positions du layout courant.
// Avec `dynamic`, graphe dynamique : chaque nœud et arête n'existe que sur ses tranches actives,
// avec le nombre de posts par tranche (attribut « activity » des nœuds, poids des arêtes).
export function subgraphToGexf(nodes: SubgraphNode[], edges: SubgraphEdge[], meta: SubgraphMeta, dynamic?: DynamicData): string {
  const nodeLines = nodes.map((node) => {
    const { r, g, b } = hexToRgb(node.color);
    const parts = dynamic ? dynamicParts(dynamic.nodeSeries.get(node.id), dynamic.time, 'activity', '        ') : null;
    return [
      `      <node id="${xml(node.id)}" label="${xml(node.label)}">`,
      '        <attvalues>',
      `          <attvalue for="type" value="${xml(node.type)}"/>`,
      `          <attvalue for="frequency" value="${node.frequency}"/>`,
      `          <attvalue for="degree_in_graph" value="${node.degree_in_graph}"/>`,
      `          <attvalue for="community" value="${node.community ?? ''}"/>`,
      ...(parts?.values || []),
      '        </attvalues>',
      ...(parts?.spells || []),
      `        <viz:position x="${node.x.toFixed(3)}" y="${node.y.toFixed(3)}" z="0"/>`,
      `        <viz:color r="${r}" g="${g}" b="${b}"/>`,
      `        <viz:size value="${Math.max(1, Math.sqrt(node.frequency))}"/>`,
      '      </node>',
    ].join('\n');
  });
  const edgeLines = edges.map((edge, index) => {
    const open = `      <edge id="${index}" source="${xml(edge.source)}" target="${xml(edge.target)}" weight="${edge.weight}"`;
    if (!dynamic) return `${open}/>`;
    const parts = dynamicParts(dynamic.edgeSeries.get(edge.id), dynamic.time, 'weight', '        ');
    return [`${open}>`, '        <attvalues>', ...parts.values, '        </attvalues>', ...parts.spells, '      </edge>'].join('\n');
  });
  const window = meta.time_window ? ` · fenêtre ${meta.time_window.start} → ${meta.time_window.end}` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" version="1.3">',
    `  <meta lastmodifieddate="${meta.generated_at.slice(0, 10)}">`,
    '    <creator>Heimdall dashboard</creator>',
    `    <description>${xml(`Sous-graphe ${meta.graph_type} · layout ${meta.layout} · filtres ${JSON.stringify(meta.filters)}${window}`)}</description>`,
    '  </meta>',
    dynamic
      ? '  <graph mode="dynamic" defaultedgetype="undirected" timeformat="dateTime" timerepresentation="interval">'
      : '  <graph mode="static" defaultedgetype="undirected">',
    '    <attributes class="node">',
    '      <attribute id="type" title="type" type="string"/>',
    '      <attribute id="frequency" title="frequency" type="integer"/>',
    '      <attribute id="degree_in_graph" title="degree_in_graph" type="integer"/>',
    '      <attribute id="community" title="community" type="string"/>',
    '    </attributes>',
    ...(dynamic ? [
      '    <attributes class="node" mode="dynamic">',
      '      <attribute id="activity" title="posts_per_bucket" type="integer"/>',
      '    </attributes>',
    ] : []),
    '    <nodes>',
    ...nodeLines,
    '    </nodes>',
    '    <edges>',
    ...edgeLines,
    '    </edges>',
    '  </graph>',
    '</gexf>',
  ].join('\n');
}
