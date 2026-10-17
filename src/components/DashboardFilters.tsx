import React from 'react';
import { langLabel } from '../utils/languages';

interface DashboardFiltersProps {
  collections: { id: string; name: string; count: number }[];
  languages: Record<string, number>;
  selectedCollection: string;
  platform: string;
  language: string;
  startDate: string;
  endDate: string;
  onCollectionChange: (value: string) => void;
  onPlatformChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)' };
const selectStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', borderRadius: 8 };

const DashboardFilters: React.FC<DashboardFiltersProps> = ({
  collections,
  languages,
  selectedCollection,
  platform,
  language,
  startDate,
  endDate,
  onCollectionChange,
  onPlatformChange,
  onLanguageChange,
  onStartDateChange,
  onEndDateChange,
}) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
    {collections.length > 0 && (
      <>
        <label htmlFor="collection-filter" style={labelStyle}>Collecte :</label>
        <select id="collection-filter" value={selectedCollection} onChange={(event) => onCollectionChange(event.target.value)} style={selectStyle}>
          <option value="">Toutes les collectes</option>
          {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name} ({collection.count})</option>)}
        </select>
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