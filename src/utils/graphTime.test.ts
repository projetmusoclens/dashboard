import { activeRuns, windowBounds, windowFor, windowSizeOptions, windowSum } from './graphTime';
import { subgraphToGexf } from './subgraphExport';
import { GraphTime } from '../types';

const time: GraphTime = { start: '2026-07-12T00:00:00.000Z', bucket_minutes: 180, buckets: 8, volume: [1, 0, 2, 0, 0, 3, 0, 1], excluded: 0 };

test('sums a sparse series over a window', () => {
  const series: [number, number][] = [[0, 2], [3, 1], [4, 5], [7, 1]];
  expect(windowSum(series, 0, 7)).toBe(9);
  expect(windowSum(series, 1, 4)).toBe(6);
  expect(windowSum(series, 5, 6)).toBe(0);
  expect(windowSum(undefined, 0, 7)).toBe(0);
});

test('builds cumulative and sliding windows with ISO bounds', () => {
  expect(windowFor('cumulative', 5, 2)).toEqual({ from: 0, to: 5 });
  expect(windowFor('sliding', 5, 2)).toEqual({ from: 4, to: 5 });
  expect(windowFor('sliding', 0, 4)).toEqual({ from: 0, to: 0 });
  expect(windowBounds(time, { from: 1, to: 2 })).toEqual({ startTime: '2026-07-12T03:00:00.000Z', endTime: '2026-07-12T09:00:00.000Z' });
  expect(windowSizeOptions(180)).toEqual([1, 2, 4, 8, 24, 56]);
  expect(activeRuns([[0, 1], [1, 2], [4, 1]])).toEqual([[0, 1], [4, 4]]);
});

test('exports a dynamic GEXF with spells and dated values', () => {
  const nodes = [{ id: '#a', label: '#a', type: 'hashtag', frequency: 3, degree_in_graph: 1, degree_in_subgraph: 1, community: 0, x: 0, y: 0, color: '#123456' }];
  const edges = [{ id: '#a::#b', source: '#a', target: '#b', weight: 2 }];
  const meta = { generated_at: '2026-07-12T00:00:00.000Z', graph_type: 'hashtags' as const, layout: 'forceatlas2', filters: {}, node_count: 1, edge_count: 1 };
  const gexf = subgraphToGexf(nodes, edges, meta, { time, nodeSeries: new Map([['#a', [[0, 1], [1, 2]]]]), edgeSeries: new Map([['#a::#b', [[1, 2]]]]) });
  expect(gexf).toContain('<graph mode="dynamic" defaultedgetype="undirected" timeformat="dateTime" timerepresentation="interval">');
  expect(gexf).toContain('<attvalue for="activity" value="2" start="2026-07-12T03:00:00Z" end="2026-07-12T05:59:59Z"/>');
  expect(gexf).toContain('<spell start="2026-07-12T00:00:00Z" end="2026-07-12T05:59:59Z"/>');
  expect(gexf).toContain('<attvalue for="weight" value="2" start="2026-07-12T03:00:00Z" end="2026-07-12T05:59:59Z"/>');
  expect(subgraphToGexf(nodes, edges, meta)).toContain('<graph mode="static"');
});
