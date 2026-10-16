import React, { useEffect, useMemo, useRef, useState } from 'react';
// Use Sigma.js + graphology + ForceAtlas2
// @ts-ignore
import Graph from 'graphology';
// @ts-ignore
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Post } from '../types';
import { fmtNum } from '../utils/format';

interface GraphsTabProps {
  posts: Post[];
  graphData?: {
    hashtags: { nodes: { id: string; label: string; value: number }[]; links: GraphEdge[] };
    mentions: { nodes: { id: string; label: string; value: number }[]; links: GraphEdge[] };
  };
  onGraphChange?: (subtitle: string) => void;
}

type GraphType = 'mentions' | 'hashtags';

type SeriesItem = { name: string; value: number };
type GraphNode = { id: string; label: string; value: number; color: string; type?: 'author' | 'mention' };
type GraphEdge = { source: string; target: string; value: number };
type GraphData = { summary: SeriesItem[]; relations: SeriesItem[] };

type SelectedNodeInfo = {
  id: string;
  label: string;
  type?: string;
  value: number;
  degree: number;
  neighbors: string[];
};

const colorForId = (id: string) => {
  // deterministic HSL color based on id
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  // authors/mentions get bluish-green palette depending on prefix
  if (id.startsWith('@')) return `hsl(${hue},60%,48%)`;
  if (id.startsWith('#')) return `hsl(${(hue + 80) % 360},60%,42%)`;
  return `hsl(${hue},50%,45%)`;
};

const edgeSizeForWeight = (w: number | undefined) => {
  const v = typeof w === 'number' ? w : Number(w) || 1;
  // use a log scale to avoid huge sizes; clamp to reasonable range
  const size = Math.log(v + 1) * 1.8;
  return Math.max(0.6, Math.min(10, size));
};

const parseMentions = (text: string) =>
  Array.from(text.matchAll(/@([A-Za-z0-9_]+)/g)).map(match => match[1].toLowerCase());

const parseHashtags = (text: string) =>
  Array.from(text.matchAll(/#([A-Za-z0-9_]+)/g)).map(match => match[1].toLowerCase());

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

// Graph elements creation removed (sigma uses `filteredGraph` directly)

// Cytoscape layout options removed; Sigma/graphology ForceAtlas2 is used instead

const GraphsTab: React.FC<GraphsTabProps> = ({ posts, graphData, onGraphChange }) => {
  const [activeGraph, setActiveGraph] = useState<GraphType>('hashtags');
  // sigma renderer instance (kept in refs)
  const [selectedNodeInfo, setSelectedNodeInfo] = useState<SelectedNodeInfo | null>(null);
  const [showEdges, setShowEdges] = useState(true);
  const [showNeighborsOnly, setShowNeighborsOnly] = useState(false);
  const [nodeLimit, setNodeLimit] = useState<number>(300);
  const [minNodeValue, setMinNodeValue] = useState<number>(1);
  const [spacing, setSpacing] = useState<number>(1.6);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<any>(null);
  const graphRef = useRef<any>(null);

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

  // sigma uses `filteredGraph` directly

  const selectedTitle = activeGraph === 'mentions' ? 'Relations de mentions' : 'Graph global des hashtags';

  useEffect(() => {
    onGraphChange?.(selectedTitle);
  }, [selectedTitle, onGraphChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    // cleanup previous sigma
    try {
      if (sigmaRef.current) {
        if (typeof sigmaRef.current.kill === 'function') sigmaRef.current.kill();
        if (typeof sigmaRef.current.clear === 'function') sigmaRef.current.clear();
        sigmaRef.current = null;
      }
      if (graphRef.current) {
        try { graphRef.current.clear(); } catch (e) {}
        graphRef.current = null;
      }
    } catch (e) {
      // ignore
    }

    // Build graphology graph
    const G: any = (Graph as any) || (window as any).graphology;
    if (typeof WebGL2RenderingContext === 'undefined') return;
    // Sigma requires browser WebGL globals and must not be loaded by jsdom tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SigmaLib: any = (require('sigma').default as any) || (window as any).sigma;
    const fa2: any = (forceAtlas2 as any) || (window as any).forceAtlas2;

    const graph = new G();
    filteredGraph.nodes.forEach(n => {
      try {
        // Sigma expects a supported `type` for rendering (use 'circle');
        // keep original semantic type in `role` for app logic.
        const baseSize = Math.max(3, Math.min(18, 2 + Math.sqrt(n.value) * 1.4));
        graph.addNode(n.id, {
          label: n.label,
          value: n.value,
          size: baseSize,
          baseSize,
          color: n.color,
          baseColor: n.color,
          type: 'circle',
          role: n.type || 'hashtag',
        });
      } catch (err) {}
    });
    filteredGraph.links.forEach((l, idx) => {
      try {
        if (!graph.hasNode(l.source) || !graph.hasNode(l.target)) return;
        graph.addEdge(l.source, l.target, { weight: l.value, size: edgeSizeForWeight(l.value) });
      } catch (err) {}
    });

    // run ForceAtlas2 to compute positions (synchronous assign) if available
    try {
      if (fa2 && typeof fa2.assign === 'function') {
        fa2.assign(graph, { iterations: 200, settings: { gravity: 1 } });
      } else if (fa2 && typeof fa2.layout === 'function') {
        // alternate API
        try { fa2.layout(graph, { iterations: 200 }); } catch (e) {}
      }
    } catch (err) {
      // ignore layout errors
    }

    // ensure nodes have valid numeric positions (fallback/coerce)
    try {
      graph.forEachNode((node: any, attrs: any) => {
        const rawX = attrs && Object.prototype.hasOwnProperty.call(attrs, 'x') ? attrs.x : undefined;
        const rawY = attrs && Object.prototype.hasOwnProperty.call(attrs, 'y') ? attrs.y : undefined;

        const nX = Number(rawX);
        const nY = Number(rawY);

        const validX = Number.isFinite(nX) ? nX : (Math.random() - 0.5) * 2000 * (spacing || 1);
        const validY = Number.isFinite(nY) ? nY : (Math.random() - 0.5) * 2000 * (spacing || 1);

        graph.setNodeAttribute(node, 'x', validX);
        graph.setNodeAttribute(node, 'y', validY);
      });
    } catch (err) {
      // ignore
    }

    // create sigma renderer
    let renderer: any = null;
    try {
      renderer = new SigmaLib(graph, containerRef.current, {
        renderLabels: true,
        settings: {
          minEdgeSize: 0.5,
          maxEdgeSize: 8,
          defaultNodeColor: '#888',
          labelRenderedSizeThreshold: 4,
          labelDensity: 1.2,
        },
      });
      // force a refresh to render initial positions
      if (renderer && typeof renderer.refresh === 'function') renderer.refresh();
      // center camera if possible
      try {
        const cam = renderer.getCamera ? renderer.getCamera() : null;
        if (cam && cam.animate) cam.animate({ x: 0, y: 0, ratio: 1 }, { duration: 300 });
      } catch (e) {}
    } catch (err) {
      console.warn('Sigma init failed', err);
    }

    sigmaRef.current = renderer;
    graphRef.current = graph;

    // node click handling
    try {
      if (renderer && typeof renderer.on === 'function') {
        renderer.on('clickNode', (e: any) => {
          const nodeId = e.node; // sigma event provides node id
          const label = graph.getNodeAttribute(nodeId, 'label');
          const neighbors = graph.neighbors(nodeId) || [];

          // show only incident edges and connected nodes
          try {
            const neighborSet = new Set(neighbors);
            neighborSet.add(nodeId);

            graph.forEachEdge((edge: any, attrs: any, source: any, target: any) => {
              const incident = source === nodeId || target === nodeId;
              const baseSize = edgeSizeForWeight(attrs && attrs.weight ? attrs.weight : attrs && attrs.size ? attrs.size : undefined);
              if (incident) {
                graph.setEdgeAttribute(edge, 'color', '#e02424');
                graph.setEdgeAttribute(edge, 'size', Math.max(1, Math.min(20, baseSize * 1.6)));
                graph.setEdgeAttribute(edge, 'highlighted', true);
              } else {
                graph.setEdgeAttribute(edge, 'color', 'rgba(128,128,128,0.18)');
                graph.setEdgeAttribute(edge, 'size', Math.max(0.4, baseSize * 0.6));
                graph.setEdgeAttribute(edge, 'highlighted', false);
              }
            });

            graph.forEachNode((n: any) => {
              const keep = neighborSet.has(n);
              if (keep) {
                // selected node and its neighbors become red
                graph.setNodeAttribute(n, 'color', '#e02424');
                // slightly enlarge neighbors
                const s = graph.getNodeAttribute(n, 'size') || 4;
                graph.setNodeAttribute(n, 'size', Math.max(2, Math.min(20, s * 1.15)));
              } else {
                // set non-neighbors to gray
                graph.setNodeAttribute(n, 'color', '#9aa0a6');
              }
            });
          } catch (err) {
            // ignore
          }
          if (renderer && typeof renderer.refresh === 'function') renderer.refresh();

          setSelectedNodeInfo({ id: nodeId, label, type: graph.getNodeAttribute(nodeId, 'role'), value: graph.getNodeAttribute(nodeId, 'value') || 0, degree: graph.degree(nodeId), neighbors });
        });

        renderer.on('clickStage', () => {
          // restore styles
          try {
            graph.forEachEdge((edge: any, attrs: any) => {
              graph.setEdgeAttribute(edge, 'color', '#8b99b8');
              graph.setEdgeAttribute(edge, 'highlighted', false);
              const base = edgeSizeForWeight(attrs && attrs.weight ? attrs.weight : attrs && attrs.size ? attrs.size : undefined);
              graph.setEdgeAttribute(edge, 'size', Math.max(0.4, Math.min(10, base)));
            });
            graph.forEachNode((n: any) => {
              graph.setNodeAttribute(n, 'color', graph.getNodeAttribute(n, 'baseColor'));
              graph.setNodeAttribute(n, 'size', graph.getNodeAttribute(n, 'baseSize') || 4);
            });
          } catch (err) {}
          if (renderer && typeof renderer.refresh === 'function') renderer.refresh();
          setSelectedNodeInfo(null);
        });
      }
    } catch (err) {
      // ignore
    }

    // set edge visibility based on showEdges
    try {
      if (graph && typeof graph.forEachEdge === 'function') {
        graph.forEachEdge((edge: any, attr: any, source: any, target: any) => {
          graph.setEdgeAttribute(edge, 'hidden', !showEdges);
        });
      }
    } catch (err) {}

    // expose instance

    return () => {
      try { if (renderer && typeof renderer.kill === 'function') renderer.kill(); } catch (e) {}
      try { if (renderer && typeof renderer.clear === 'function') renderer.clear(); } catch (e) {}
      try { if (graph && typeof graph.clear === 'function') graph.clear(); } catch (e) {}
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [filteredGraph, spacing, showEdges]);

  useEffect(() => {
    // update edge visibility for sigma
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    try {
      graph.forEachEdge((edge: any, attrs: any) => {
        graph.setEdgeAttribute(edge, 'hidden', !showEdges);
      });
      if (typeof renderer.refresh === 'function') renderer.refresh();
    } catch (err) {
      // ignore
    }
  }, [showEdges]);

  // activeGraph changes are handled by remounting the sigma instance via filteredGraph effect

  const resetView = () => {
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (!renderer || !graph) return;
    try {
      setShowNeighborsOnly(false);
      setSelectedNodeInfo(null);
      // reset camera if possible
      if (renderer.getCamera && typeof renderer.getCamera === 'function') {
        try {
          const camera = renderer.getCamera();
          if (camera && camera.animate) camera.animate({ x: 0, y: 0, ratio: 1 }, { duration: 600 });
        } catch (err) {
          // ignore
        }
      }
    } catch (err) {
      console.warn('resetView error', err);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setActiveGraph('hashtags')}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 999,
            border: activeGraph === 'hashtags' ? '1px solid #1d9e75' : '1px solid var(--border)',
            background: activeGraph === 'hashtags' ? 'rgba(29,158,117,0.12)' : 'transparent',
            color: activeGraph === 'hashtags' ? '#1d9e75' : 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Hashtags
        </button>
        <button
          type="button"
          onClick={() => setActiveGraph('mentions')}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 999,
            border: activeGraph === 'mentions' ? '1px solid #2a78d6' : '1px solid var(--border)',
            background: activeGraph === 'mentions' ? 'rgba(42,120,214,0.12)' : 'transparent',
            color: activeGraph === 'mentions' ? '#2a78d6' : 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Mentions
        </button>
        <button
          type="button"
          onClick={() => setShowEdges(!showEdges)}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: showEdges ? 'rgba(29,158,117,0.12)' : 'rgba(99,99,99,0.08)',
            color: showEdges ? '#1d9e75' : 'var(--text-secondary)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {showEdges ? 'Masquer les arêtes' : 'Afficher les arêtes'}
        </button>
        <button
          type="button"
          onClick={resetView}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Reset view
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nodes:</label>
          <input
            type="number"
            min={50}
            max={2000}
            value={nodeLimit}
            onChange={e => setNodeLimit(Number(e.target.value) || 50)}
            style={{ width: 90, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Min value:</label>
          <input
            type="number"
            min={1}
            max={100}
            value={minNodeValue}
            onChange={e => setMinNodeValue(Number(e.target.value) || 1)}
            style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)' }}
          />
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Spacing:</label>
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.1}
            value={spacing}
            onChange={e => setSpacing(Number(e.target.value))}
            style={{ width: 120 }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr', gap: 14 }}>
        <div style={{ minHeight: 720, border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 720 }} />
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, minHeight: 220 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
              Détails du nœud
            </div>
            {selectedNodeInfo ? (
              <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                <div><strong>{selectedNodeInfo.label}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>Type : {selectedNodeInfo.type || 'hashtag'}</div>
                <div>Fréquence : {fmtNum(selectedNodeInfo.value)}</div>
                <div>Degré : {selectedNodeInfo.degree}</div>
                <div>Voisins : {selectedNodeInfo.neighbors.length}</div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Double-cliquez sur le nœud pour isoler sa proximité et réduire la charge visuelle.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Cliquez sur un nœud pour afficher ses informations et voir ses relations.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Instructions and Résumé moved to bottom */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14, marginTop: 12 }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Instructions
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            - Zoom avec la molette
            <br />- Déplacez le graphe avec clic-glisser
            <br />- Cliquez sur un nœud pour voir ses voisins
            <br />- Double-cliquez sur un nœud pour isoler sa proximité
            <br />- Reset view pour revenir à l’ensemble
          </div>
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Résumé
          </div>
          <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
            <div>{fmtNum(currentGraph.nodes.length)} nœuds</div>
            <div>{fmtNum(currentGraph.links.length)} relations</div>
            <div>Épaisseur des arêtes : occurrences, échelle logarithmique</div>
            <div>{activeGraph === 'mentions' ? 'Vue mentions / auteurs' : 'Vue hashtags'}</div>
            {showNeighborsOnly && <div style={{ color: '#2a78d6' }}>Exploration de voisinage active</div>}
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
