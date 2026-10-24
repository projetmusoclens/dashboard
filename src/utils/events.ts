import { Collection } from '../types';

// Événements de collecte (collection_context.event) : regroupement des collectes et libellés lisibles.
// « fra_eng_pf » → « France – Angleterre · petite finale » ; un identifiant inconnu est affiché tel quel.

const COUNTRIES: Record<string, string> = {
  arg: 'Argentine', bel: 'Belgique', bra: 'Brésil', can: 'Canada', eng: 'Angleterre', esp: 'Espagne', fra: 'France',
  ger: 'Allemagne', mar: 'Maroc', mex: 'Mexique', ned: 'Pays-Bas', nor: 'Norvège', par: 'Paraguay', por: 'Portugal',
  sui: 'Suisse', usa: 'États-Unis',
  france: 'France', paraguay: 'Paraguay',
};

const STAGES: Record<string, string> = {
  hf: 'huitième de finale', qf: 'quart de finale', df: 'demi-finale', sf: 'demi-finale', pf: 'petite finale', finale: 'finale', final: 'finale',
};

const SPECIAL: Record<string, string> = { firehose: 'Flux Bluesky (firehose)' };

export const NO_EVENT = '';

export function eventLabel(event: string | undefined): string {
  if (!event) return 'Sans événement';
  if (SPECIAL[event]) return SPECIAL[event];
  const parts = event.toLowerCase().split('_').filter(Boolean);
  const stage = STAGES[parts[parts.length - 1]] ? parts.pop() : undefined;
  if (!parts.length || !parts.every((part) => COUNTRIES[part])) return event;
  return `${parts.map((part) => COUNTRIES[part]).join(' – ')}${stage ? ` · ${STAGES[stage]}` : ''}`;
}

export interface EventGroup {
  event: string;
  label: string;
  count: number;
  firstAt: string | null;
  collections: Collection[];
}

// Collectes regroupées par événement : ordre chronologique (premier post), « Sans événement » en dernier.
// Dans un événement, la collecte la plus volumineuse d'abord.
export function groupByEvent(collections: Collection[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  collections.forEach((collection) => {
    const event = collection.event || NO_EVENT;
    const group = groups.get(event) || { event, label: eventLabel(event), count: 0, firstAt: null, collections: [] };
    group.count += collection.count;
    group.collections.push(collection);
    if (collection.first_at && (!group.firstAt || collection.first_at < group.firstAt)) group.firstAt = collection.first_at;
    groups.set(event, group);
  });
  groups.forEach((group) => group.collections.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)));
  return Array.from(groups.values()).sort((left, right) => {
    if (!left.event !== !right.event) return left.event ? -1 : 1;
    return String(left.firstAt || '9999').localeCompare(String(right.firstAt || '9999')) || left.label.localeCompare(right.label);
  });
}

// Libellé d'une sélection : les événements entièrement cochés sont nommés, le reste compté en collectes.
export function describeSelection(collections: Collection[], selected: string[]): string {
  if (!selected.length) return collections.some((collection) => collection.event) ? 'tous les événements' : 'toutes les collectes';
  const chosen = new Set(selected);
  const parts: string[] = [];
  let loose = 0;
  groupByEvent(collections).forEach((group) => {
    const picked = group.collections.filter((collection) => chosen.has(collection.id));
    if (!picked.length) return;
    if (group.event && picked.length === group.collections.length) parts.push(group.label);
    else if (picked.length === 1) parts.push(picked[0].name);
    else loose += picked.length;
  });
  if (loose) parts.push(`${loose} collectes`);
  return parts.length <= 2 ? parts.join(' + ') : `${parts.slice(0, 2).join(' + ')} + ${parts.length - 2} autre(s)`;
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
export const eventDate = (firstAt: string | null) => {
  const time = firstAt ? Date.parse(firstAt) : NaN;
  return Number.isFinite(time) ? dayFormat.format(time) : '';
};
