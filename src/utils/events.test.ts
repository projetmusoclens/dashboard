import { describeSelection, eventLabel, groupByEvent } from './events';

const collections = [
  { id: 'twitter_fraeng_pf', name: 'twitter_fraeng_pf', count: 5217, event: 'fra_eng_pf', first_at: '2026-07-18T16:59:00Z' },
  { id: 'twitter_fraeng_bf_w1', name: 'twitter_fraeng_bf_w1', count: 2128, event: 'fra_eng_pf', first_at: '2026-07-18T21:10:00Z' },
  { id: 'twitter_frapar_live', name: 'twitter_frapar_live', count: 9788, event: 'france_paraguay', first_at: '2026-07-04T07:06:00Z' },
  { id: 'bluesky_live', name: 'bluesky_live', count: 10000, event: 'firehose', first_at: '2009-04-29T15:33:00Z' },
  { id: 'old', name: 'old', count: 3, event: '' },
];

test('labels events from their identifier', () => {
  expect(eventLabel('fra_eng_pf')).toBe('France – Angleterre · petite finale');
  expect(eventLabel('esp_arg_finale')).toBe('Espagne – Argentine · finale');
  expect(eventLabel('arg_sui_qf')).toBe('Argentine – Suisse · quart de finale');
  expect(eventLabel('france_paraguay')).toBe('France – Paraguay');
  expect(eventLabel('firehose')).toBe('Flux Bluesky (firehose)');
  expect(eventLabel('mystery_event')).toBe('mystery_event');
  expect(eventLabel('')).toBe('Sans événement');
});

test('groups collections by event, chronologically, without-event last', () => {
  const groups = groupByEvent(collections);
  expect(groups.map((group) => group.event)).toEqual(['firehose', 'france_paraguay', 'fra_eng_pf', '']);
  expect(groups[2].count).toBe(7345);
  expect(groups[2].collections.map((item) => item.id)).toEqual(['twitter_fraeng_pf', 'twitter_fraeng_bf_w1']);
});

test('names fully selected events and counts loose collections', () => {
  expect(describeSelection(collections, [])).toBe('tous les événements');
  expect(describeSelection([collections[4]], [])).toBe('toutes les collectes');
  expect(describeSelection(collections, ['twitter_fraeng_pf', 'twitter_fraeng_bf_w1'])).toBe('France – Angleterre · petite finale');
  expect(describeSelection(collections, ['twitter_fraeng_bf_w1'])).toBe('twitter_fraeng_bf_w1');
  expect(describeSelection(collections, ['twitter_fraeng_pf', 'twitter_fraeng_bf_w1', 'twitter_frapar_live'])).toBe('France – Paraguay + France – Angleterre · petite finale');
});
