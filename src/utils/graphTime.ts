import { GraphTime, TimeSeries } from '../types';

// Graphe dynamique : chaque nœud et arête porte une série creuse [tranche, posts].
// Une fenêtre est un intervalle de tranches [from, to], bornes incluses.

export type TimeMode = 'cumulative' | 'sliding';
export interface TimeWindow { from: number; to: number }

// Somme d'une série sur la fenêtre (recherche dichotomique du début, puis lecture jusqu'à la fin).
export function windowSum(series: TimeSeries | undefined, from: number, to: number): number {
  if (!series?.length) return 0;
  let low = 0;
  let high = series.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (series[middle][0] < from) low = middle + 1; else high = middle;
  }
  let total = 0;
  for (let index = low; index < series.length && series[index][0] <= to; index += 1) total += series[index][1];
  return total;
}

export const bucketMs = (time: GraphTime) => time.bucket_minutes * 60000;
export const bucketStart = (time: GraphTime, index: number) => Date.parse(time.start || '') + index * bucketMs(time);

export function windowFor(mode: TimeMode, position: number, size: number): TimeWindow {
  return mode === 'cumulative' ? { from: 0, to: position } : { from: Math.max(0, position - size + 1), to: position };
}

// Bornes ISO d'une fenêtre : début de la première tranche, fin (exclue) de la dernière.
export function windowBounds(time: GraphTime, window: TimeWindow) {
  return { startTime: new Date(bucketStart(time, window.from)).toISOString(), endTime: new Date(bucketStart(time, window.to + 1)).toISOString() };
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

export function formatWindow(time: GraphTime, window: TimeWindow) {
  const format = time.bucket_minutes >= 1440 ? dayFormat : dateFormat;
  const end = bucketStart(time, window.to + 1) - (time.bucket_minutes >= 1440 ? 1 : 0);
  return `${format.format(bucketStart(time, window.from))} → ${format.format(end)}`;
}

export function formatDuration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} j`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

// Tailles de fenêtre glissante proposées, en nombre de tranches.
export function windowSizeOptions(bucketMinutes: number) {
  const durations = [bucketMinutes, 60, 180, 360, 720, 1440, 4320, 10080];
  return Array.from(new Set(durations.filter((minutes) => minutes >= bucketMinutes && minutes % bucketMinutes === 0).map((minutes) => minutes / bucketMinutes)))
    .sort((left, right) => left - right);
}

// Tranches actives consécutives regroupées : [[début, fin], …] (indices inclus).
export function activeRuns(series: TimeSeries | undefined): [number, number][] {
  const runs: [number, number][] = [];
  (series || []).forEach(([bucket]) => {
    const last = runs[runs.length - 1];
    if (last && bucket === last[1] + 1) last[1] = bucket; else runs.push([bucket, bucket]);
  });
  return runs;
}
