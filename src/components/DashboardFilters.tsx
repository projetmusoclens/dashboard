import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collection } from '../types';
import { describeSelection, eventDate, groupByEvent } from '../utils/events';
import { langLabel } from '../utils/languages';

interface DashboardFiltersProps {
  collections: Collection[];
  languages: Record<string, number>;
  selectedCollections: string[];
  platform: string;
  language: string;
  startDate: string;
  endDate: string;
  onCollectionsChange: (value: string[]) => void;
  onPlatformChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const selectStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', borderRadius: 8 };

// Liste déroulante à cases à cocher : une case par événement (toutes ses collectes à la fois).
// Les collectes sans événement gardent chacune leur case. Aucune case cochée = toutes les collectes.
const CollectionPicker: React.FC<{ collections: Collection[]; selected: string[]; onChange: (value: string[]) => void }> = ({ collections, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  // Options : un événement = toutes ses collectes ; une collecte sans événement = elle seule.
  const options = useMemo(() => groupByEvent(collections).flatMap((group) => (group.event
    ? [{ key: `event:${group.event}`, label: group.label, ids: group.collections.map((collection) => collection.id), count: group.count, date: eventDate(group.firstAt) }]
    : group.collections.map((collection) => ({ key: collection.id, label: collection.name, ids: [collection.id], count: collection.count, date: '' })))), [collections]);
  const chosen = new Set(selected);
  const toggle = (ids: string[]) => {
    const all = ids.every((id) => chosen.has(id));
    onChange(all ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));
  };
  const needle = search.trim().toLowerCase();
  const visible = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const label = describeSelection(collections, selected);
  const hasEvents = collections.some((collection) => collection.event);

  return (
    <div className="collection-picker" ref={rootRef}>
      <button type="button" id="collection-filter" className="collection-picker-button" aria-haspopup="true" aria-expanded={open} title={selected.length ? label : undefined} onClick={() => setOpen((value) => !value)}>
        <span>{selected.length ? label : hasEvents ? 'Tous les événements' : 'Toutes les collectes'}</span> <ChevronDown size={14} />
      </button>
      {open && (
        <div className="collection-picker-menu" role="group" aria-label={hasEvents ? 'Événements' : 'Collectes'}>
          <div className="collection-picker-actions">
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>{hasEvents ? 'Tous les événements' : 'Toutes les collectes'}</button>
            <button type="button" onClick={() => setOpen(false)}>Fermer</button>
          </div>
          {options.length > 10 && (
            <input className="collection-picker-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={hasEvents ? 'Filtrer : pays, match…' : 'Filtrer les collectes…'} aria-label="Filtrer" autoFocus />
          )}
          {!visible.length && <div className="collection-picker-empty">Aucun résultat.</div>}
          {visible.map((option) => {
            const picked = option.ids.filter((id) => chosen.has(id)).length;
            return (
              <label key={option.key} className="collection-picker-row">
                <input type="checkbox" checked={picked === option.ids.length} onChange={() => toggle(option.ids)} />
                <span className="collection-picker-name">{option.label}</span>
                <span className="collection-picker-count">{option.date ? `${option.date} · ` : ''}{option.count.toLocaleString('fr-FR')}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  collections,
  languages,
  selectedCollections,
  platform,
  language,
  startDate,
  endDate,
  onCollectionsChange,
  onPlatformChange,
  onLanguageChange,
  onStartDateChange,
  onEndDateChange,
}) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
    {collections.length > 0 && (
      <>
        <label htmlFor="collection-filter" style={labelStyle}>{collections.some((collection) => collection.event) ? 'Événements :' : 'Collectes :'}</label>
        <CollectionPicker collections={collections} selected={selectedCollections} onChange={onCollectionsChange} />
      </>
    )}

    <label htmlFor="platform-filter" style={labelStyle}>Plateforme :</label>
    <select id="platform-filter" value={platform} onChange={(event) => onPlatformChange(event.target.value)} style={selectStyle}>
      <option value="">Toutes les plateformes</option>
      <option value="twitter">Twitter</option>
      <option value="bluesky">Bluesky</option>
    </select>

    <label htmlFor="language-filter" style={labelStyle}>Langue :</label>
    <select id="language-filter" value={language} onChange={(event) => onLanguageChange(event.target.value)} style={selectStyle}>
      <option value="">Toutes les langues</option>
      {Object.entries(languages)
        .sort((left, right) => right[1] - left[1])
        .map(([code, count]) => <option key={code} value={code}>{langLabel(code)} ({count})</option>)}
    </select>

    <label htmlFor="start-date-filter" style={labelStyle}>Du :</label>
    <input id="start-date-filter" type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} />
    <label htmlFor="end-date-filter" style={labelStyle}>Au :</label>
    <input id="end-date-filter" type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} />
  </div>
);

export default DashboardFilters;