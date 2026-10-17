// @ts-ignore
import Graph from 'graphology';
import { bfsDistances, computeLayout, detectCommunities, LAYOUTS } from './graphLayouts';
import { buildSubgraph, edgesToCsv, subgraphToGexf } from './subgraphExport';

function sampleGraph() {
  const graph = new (Graph as any)({ type: 'undirected' });
  ['#a', '#b', '#c', '#d', '#e', '#f', '#lonely'].forEach((id, index) => graph.addNode(id, { label: id, value: 10 - index, size: 4, role: 'hashtag', color: 'hsl(120,60%,42%)' }));
  [['#a', '#b', 5], ['#a', '#c', 2], ['#b', '#c', 1], ['#c', '#d', 3], ['#d', '#e', 1], ['#e', '#f', 4]].forEach(([s, t, w]) => graph.addEdge(s, t, { weight: w }));
  const communities = detectCommunities(graph);
  graph.forEachNode((node: string) => graph.setNodeAttribute(node, 'community', communities[node]));
  return graph;
}

test('every layout returns a finite position for every node', () => {
  const graph = sampleGraph();
  LAYOUTS.forEach(({ id }) => {
    const positions = computeLayout(graph, id, { spacing: 1, focus: '#c' });
    graph.forEachNode((node: string) => {
      expect(Number.isFinite(positions[node]?.x)).toBe(true);
      expect(Number.isFinite(positions[node]?.y)).toBe(true);
    });
  });
});

test('layouts are deterministic and radial centers the focus', () => {
  const graph = sampleGraph();
  expect(computeLayout(graph, 'forceatlas2')).toEqual(computeLayout(graph, 'forceatlas2'));
  expect(computeLayout(graph, 'radial', { focus: '#d' })['#d']).toEqual({ x: 0, y: 0 });
});

test('bfs distances respect the requested depth', () => {
  const graph = sampleGraph();
  const distances = bfsDistances(graph, '#a', 2);
  expect(Array.from(distances.keys()).sort()).toEqual(['#a', '#b', '#c', '#d']);
  expect(distances.get('#d')).toEqual({ distance: 2, parent: '#c' });
});

test('exports the induced subgraph only', () => {
  const graph = sampleGraph();
  graph.forEachNode((node: string) => graph.mergeNodeAttributes(node, { x: 1, y: 2 }));
  const { nodes, edges } = buildSubgraph(graph, ['#a', '#c', '#e', '#missing']);
  expect(nodes.map((node) => node.id).sort()).toEqual(['#a', '#c', '#e']);
  expect(edges).toEqual([{ id: '#a::#c', source: '#a', target: '#c', weight: 2 }]);
  expect(nodes.find((node) => node.id === '#a')).toMatchObject({ degree_in_graph: 2, degree_in_subgraph: 1, frequency: 10 });
  expect(edgesToCsv(edges).split('\r\n')).toEqual(['"edge_id","source","target","weight"', '"#a::#c","#a","#c","2"']);
  const gexf = subgraphToGexf(nodes, edges, { generated_at: '2026-10-17T00:00:00Z', graph_type: 'hashtags', layout: 'forceatlas2', filters: { collectionId: 'a&b' }, node_count: 3, edge_count: 1 });
  const doc = new DOMParser().parseFromString(gexf, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  expect(doc.getElementsByTagName('node')).toHaveLength(3);
  expect(doc.getElementsByTagName('edge')[0].getAttribute('weight')).toBe('2');
});
