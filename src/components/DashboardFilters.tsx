import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { langLabel } from '../utils/languages';

interface DashboardFiltersProps {
  collections: { id: string; name: string; count: number }[];
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

type CollectionOption = DashboardFiltersProps['collections'][number];

// Liste déroulante à cases à cocher : aucune case cochée = toutes les collectes.
const CollectionPicker: React.FC<{ collections: CollectionOption[]; selected: string[]; onChange: (value: string[]) => void }> = ({ collections, selected, onChange }) => {
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
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  const needle = search.trim().toLowerCase();
  const visible = needle ? collections.filter((item) => item.name.toLowerCase().includes(needle)) : collections;
  const names = collections.filter((item) => selected.includes(item.id)).map((item) => item.name);
  const label = !names.length ? 'Toutes les collectes' : names.length === 1 ? names[0] : `${names.length} collectes`;
  return (
    <div className="collection-picker" ref={rootRef}>
      <button type="button" id="collection-filter" className="collection-picker-button" aria-haspopup="true" aria-expanded={open} title={names.join(', ') || undefined} onClick={() => setOpen((value) => !value)}>
        <span>{label}</span> <ChevronDown size={14} />
      </button>
      {open && (
        <div className="collection-picker-menu" role="group" aria-label="Collectes">
          <div className="collection-picker-actions">
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>Toutes les collectes</button>
            <button type="button" onClick={() => setOpen(false)}>Fermer</button>
          </div>
          {collections.length > 10 && (
            <input className="collection-picker-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrer les collectes…" aria-label="Filtrer les collectes" autoFocus />
          )}
          {!visible.length && <div className="collection-picker-empty">Aucune collecte ne correspond.</div>}
          {visible.map((collection) => (
            <label key={collection.id} className="collection-picker-row">
              <input type="checkbox" checked={selected.includes(collection.id)} onChange={() => toggle(collection.id)} />
              <span className="collection-picker-name">{collection.name}</span>
              <span className="collection-picker-count">{collection.count.toLocaleString('fr-FR')}</span>
            </label>
          ))}
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
        <label htmlFor="collection-filter" style={labelStyle}>Collectes :</label>
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