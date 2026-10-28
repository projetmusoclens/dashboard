import React, { useEffect, useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, LabelList,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Collection, CollectionStats, DashboardData, EventSheet, QueryParams, TimelineResponse } from '../types';
import api from '../services/api';
import { useAuth } from './AuthGate';
import { EventSheetEditor, MatchCard } from './EventSheets';
import { CHART_COLORS } from '../data/dashboardData';
import KpiCard from './KpiCard';
import { fmtNum } from '../utils/format';
import { groupLanguages, LanguageSlice } from '../utils/languages';
import { eventLabel, groupByEvent } from '../utils/events';

interface OverviewTabProps { data: DashboardData; timeline?: TimelineResponse | null; collections?: Collection[]; filters?: QueryParams }

export const PLATFORM_META: Record<string, { label: string; color: string }> = {
  twitter: { label: 'Twitter', color: '#2a78d6' },
  bluesky: { label: 'Bluesky', color: '#eda100' },
};
const TOTAL_COLOR = '#1d9e75';
const OTHERS_COLOR = '#9aa3ad';

const cardStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' };
const titleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' };
const tooltipBoxStyle: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)', boxShadow: 'var(--shadow)', maxWidth: 280 };

export const platformLabel = (platform: string) => PLATFORM_META[platform]?.label || platform;

function bucketLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} h`;
  if (minutes === 1440) return '1 jour';
  return `${minutes / 1440} jours`;
}

function formatBucket(ts: number, minutes: number, withYear = false) {
  const options: Intl.DateTimeFormatOptions = minutes < 1440
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) };
  return new Intl.DateTimeFormat('fr-FR', options).format(new Date(ts));
}

const LanguageTooltip: React.FC<any> = ({ active, payload, total }) => {
  if (!active || !payload?.length) return null;
  const slice = payload[0].payload as LanguageSlice;
  const share = total ? ((slice.value / total) * 100).toFixed(1) : '0';
  return (
    <div style={tooltipBoxStyle}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{slice.name} · {fmtNum(slice.value)} posts ({share} %)</div>
      {slice.details && (
        <div style={{ display: 'grid', gap: 2, color: 'var(--text-secondary)' }}>
          {slice.details.slice(0, 12).map((item) => (
            <div key={item.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{item.label}</span><span>{fmtNum(item.value)}</span>
            </div>
          ))}
          {slice.details.length > 12 && <div style={{ color: 'var(--text-muted)' }}>+ {slice.details.length - 12} autres codes</div>}
        </div>
      )}
    </div>
  );
};

// Cellules chiffrées d'une ligne du tableau (total d'un événement, ou collecte sans événement).
const StatCells: React.FC<{ item: Omit<CollectionStats, 'collection_name'> }> = ({ item }) => {
  const cell: React.CSSProperties = { textAlign: 'right', padding: '0.75rem 0.5rem' };
  return (
    <>
      <td style={cell}>{fmtNum(item.count)}</td>
      <td style={cell}>{fmtNum(item.reposts)}</td>
      <td style={cell}>{fmtNum(item.quotes)}</td>
      <td style={cell}>{fmtNum(item.emojis)}</td>
      <td style={cell}>{fmtNum(item.links)}</td>
      <td style={cell}>{item.link_rate.toFixed(1)}%</td>
    </>
  );
};

const OverviewTab: React.FC<OverviewTabProps> = ({ data, timeline = null, collections = [], filters = {} }) => {
  const { user } = useAuth();
  // Fiches des événements de collecte (matchs) : lues par tous, modifiées par les administrateurs.
  const [sheets, setSheets] = useState<EventSheet[]>([]);
  const [editing, setEditing] = useState<EventSheet | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  useEffect(() => {
    api.getEventSheets().then((result) => setSheets(result.sheets)).catch(() => setSheets([]));
  }, []);
  const replaceSheet = (event: string, sheet: EventSheet | null) => setSheets((current) => (sheet ? [...current.filter((item) => item.event !== event), sheet] : current.filter((item) => item.event !== event)));
  const saveSheet = async (sheet: EventSheet) => {
    setSheetSaving(true);
    setSheetError(null);
    try {
      const result = await api.saveEventSheet(sheet.event, sheet);
      replaceSheet(sheet.event, result.sheet);
      setEditing(null);
    } catch (error: any) {
      setSheetError(error.message || String(error));
    } finally {
      setSheetSaving(false);
    }
  };
  const resetSheet = async (sheet: EventSheet) => {
    if (!window.confirm(`Revenir à la fiche pré-remplie de « ${sheet.title || sheet.event} » ? Les modifications enregistrées seront perdues.`)) return;
    const result = await api.resetEventSheet(sheet.event).catch(() => null);
    if (result) replaceSheet(sheet.event, result.sheet);
  };

  // Tableau regroupé par événement (collection_context.event) : une ligne par événement, totaux de ses collectes.
  // Une collecte sans événement garde sa propre ligne.
  const eventStats = useMemo(() => {
    const rows = new Map<string, { key: string; event: string; label: string; total: Omit<CollectionStats, 'collection_name'> }>();
    data.collection_stats.forEach((item) => {
      const event = item.event || '';
      const key = event ? `event:${event}` : item.collection_name;
      const row = rows.get(key) || { key, event, label: event ? eventLabel(event) : item.collection_name, total: { count: 0, reposts: 0, quotes: 0, emojis: 0, links: 0, link_rate: 0 } };
      (['count', 'reposts', 'quotes', 'emojis', 'links'] as const).forEach((metric) => { row.total[metric] += item[metric] || 0; });
      row.total.link_rate = row.total.count ? (row.total.links / row.total.count) * 100 : 0;
      rows.set(key, row);
    });
    // Même ordre que le sélecteur : chronologique (début de la collecte), puis par volume.
    const order = new Map(groupByEvent(collections).map((group, index) => [group.event, index]));
    return Array.from(rows.values()).sort((left, right) => (order.get(left.event) ?? 999) - (order.get(right.event) ?? 999) || right.total.count - left.total.count);
  }, [data.collection_stats, collections]);
  const [typeSlide, setTypeSlide] = useState(0);
  // Seuils du regroupement « Autres » : part minimale d'une langue et nombre maximal de parts.
  const [langMinShare, setLangMinShare] = useState(0.01);
  const [langMaxSlices, setLangMaxSlices] = useState(9);

  // Seules les plateformes réellement présentes dans la sélection sont affichées.
  const platformCounts = data.by_platform || {};
  const presentPlatforms = Object.keys(platformCounts).filter((platform) => (platformCounts[platform] || 0) > 0)
    .sort((left, right) => (platformCounts[right] || 0) - (platformCounts[left] || 0));
  const multiPlatform = presentPlatforms.length > 1;

  const timelinePoints = timeline?.points || [];
  // Événements présents dans la sélection, dans l'ordre chronologique du filtre, et leurs fiches.
  const selectionSheets = useMemo(() => {
    const present = new Set(data.collection_stats.map((item) => item.event).filter(Boolean));
    return groupByEvent(collections)
      .filter((group) => present.has(group.event))
      .map((group) => sheets.find((sheet) => sheet.event === group.event))
      .filter((sheet): sheet is EventSheet => Boolean(sheet));
  }, [data.collection_stats, collections, sheets]);

  const timelinePlatforms = (timeline?.platforms || []).filter((platform) => timelinePoints.some((point) => Number(point[platform]) > 0));
  const bucketMinutes = timeline?.bucket_minutes || 60;

  const langData = groupLanguages(data.by_lang, { minShare: langMinShare, maxSlices: langMaxSlices });
  const langTotal = langData.reduce((sum, slice) => sum + slice.value, 0);
  const langColor = (slice: LanguageSlice, index: number) => slice.key === '__others__' ? OTHERS_COLOR : CHART_COLORS[index % CHART_COLORS.length];

  const total = data.total_posts || 0;
  const byType = data.by_type || { original: data.posts_vs_replies.posts, replies: data.posts_vs_replies.replies, retweets: 0, quotes: 0 };
  const typeSlides = [
    { title: 'Posts vs Replies', part: 'Replies', value: byType.replies, rest: 'Posts (hors replies)', note: 'selon reply_to_id' },
    { title: 'Posts vs Retweets', part: 'Retweets', value: byType.retweets, rest: 'Posts (hors retweets)', note: 'retweets X et reposts Bluesky collectés' },
    { title: 'Posts vs Citations', part: 'Citations', value: byType.quotes, rest: 'Posts (hors citations)', note: 'tweets cités et embeds Bluesky de type record' },
  ];
  const slide = typeSlides[typeSlide];
  const typeData = [
    { name: slide.rest, value: Math.max(total - slide.value, 0) },
    { name: slide.part, value: slide.value },
  ];

  const totalRetweets = data.engagement_sum.reposts || 0;
  const totalQuotes = data.engagement_sum.quotes || 0;
  const totalEmojis = data.collection_stats.reduce((sum, item) => sum + item.emojis, 0);
  const postsWithLinks = data.collection_stats.reduce((sum, item) => sum + item.links, 0);
  const linkShare = total > 0 ? (postsWithLinks / total) * 100 : 0;

  const topAuthorsList = Object.entries(data.top_authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => ({ name: '@' + k, value: v }));

  const avg = (value: number | null | undefined) => value === null || value === undefined ? null : Math.round(value);
  const ENG_COLORS = ['#1d9e75', '#eda100', '#2a78d6', '#4a3aa7'];
  const engData = [
    { metric: 'Likes moy.', value: avg(data.engagement_avg.likes), color: ENG_COLORS[0] },
    { metric: 'Reposts moy.', value: avg(data.engagement_avg.reposts), color: ENG_COLORS[1] },
    { metric: 'Replies moy.', value: avg(data.engagement_avg.replies), color: ENG_COLORS[2] },
    { metric: 'Vues moy.', value: avg(data.engagement_avg.views), color: ENG_COLORS[3] },
  ];

  // Mots-clés de paramètres = matched_keywords de la collecte ; hashtags = extraits du texte des posts.
  const parameterKeywords = Object.entries(data.by_keyword)
    .filter(([keyword]) => !keyword.startsWith('__'))
    .sort((a, b) => b[1] - a[1]);
  const topParameterKeywords = parameterKeywords.slice(0, 20);
  const kwData = parameterKeywords.map(([name, value]) => ({ name, value }));
  const hashtagEntries = Object.entries(data.hashtags).sort((a, b) => b[1] - a[1]);
  const topHashtags = hashtagEntries.slice(0, 20);
  const topHashtagSet = new Set(topHashtags.map(([tag]) => tag));
  const hashtagCountFor = (keyword: string) => data.hashtags[`#${keyword.toLowerCase().replace(/\s+/g, '')}`];

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    if (percent < 0.04) return null;
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const arrowButtonStyle: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', cursor: 'pointer' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Total (sélection) : {fmtNum(total)}</div>
        {presentPlatforms.map((platform) => (
          <div key={platform} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{platformLabel(platform)} : {fmtNum(platformCounts[platform])}</div>
        ))}
      </div>

      {/* « Déroulé du match », au-dessus de la courbe générale : courbe resserrée sur le match, moments clés,
          fiche dans un panneau dédié. Repliable par tous, modifiable par les administrateurs. */}
      {selectionSheets.length > 0 && (
        <div style={{ ...cardStyle, padding: '1rem', marginBottom: '1rem' }}>
          <MatchCard
            sheets={selectionSheets}
            collections={collections}
            filters={filters}
            canEdit={user.role === 'admin'}
            onEdit={(sheet) => { setSheetError(null); setEditing(sheet); }}
            onReset={resetSheet}
          />
        </div>
      )}

      <div style={{ ...cardStyle, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ ...titleStyle, marginBottom: 0 }}>Nombre de posts dans le temps</h3>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Pas : {bucketLabel(bucketMinutes)} · date de publication, heure locale
            {timeline?.excluded ? ` · ${fmtNum(timeline.excluded)} post(s) aux dates aberrantes exclus` : ''}
          </span>
        </div>
        {timelinePoints.length === 0 ? (
          <div style={{ height: 200, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Aucune donnée datée pour cette sélection.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={timelinePoints} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) => formatBucket(Number(value), bucketMinutes)}
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                minTickGap={40}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={44} allowDecimals={false} />
              <Tooltip
                labelFormatter={(value) => formatBucket(Number(value), bucketMinutes, true)}
                formatter={(value, name) => [`${fmtNum(Number(value))} posts`, name]}
                contentStyle={tooltipBoxStyle}
              />
              <Legend />
              {timelinePlatforms.length > 1 && <Line type="monotone" dataKey="total" name="Total" stroke={TOTAL_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />}
              {timelinePlatforms.map((platform) => (
                <Line key={platform} type="monotone" dataKey={platform} name={platformLabel(platform)} stroke={PLATFORM_META[platform]?.color || '#73726c'} strokeWidth={timelinePlatforms.length > 1 ? 1.5 : 2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {editing && <EventSheetEditor sheet={editing} saving={sheetSaving} error={sheetError} onSave={saveSheet} onClose={() => setEditing(null)} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: '1.5rem' }}>
        <KpiCard label="Total posts" value={fmtNum(total)} sub={multiPlatform || !presentPlatforms[0] ? 'total' : `100 % ${platformLabel(presentPlatforms[0])}`} accent />
        {multiPlatform && presentPlatforms.map((platform) => (
          <KpiCard key={platform} label={`${platformLabel(platform)} posts`} value={fmtNum(platformCounts[platform])} sub={`${((platformCounts[platform] / (total || 1)) * 100).toFixed(1)} % de la sélection`} />
        ))}
        <KpiCard label="Vues totales" value={fmtNum(data.engagement_sum.views)} sub="cumul engagement" />
        <KpiCard label="Posts originaux" value={fmtNum(byType.original)} sub="ni reply, ni retweet, ni citation" />
        <KpiCard label="Replies collectées" value={fmtNum(byType.replies)} sub="selon reply_to_id" />
        <KpiCard label="Retweets collectés" value={fmtNum(byType.retweets)} sub="retweets / reposts présents dans la collecte" />
        <KpiCard label="Citations collectées" value={fmtNum(byType.quotes)} sub="posts qui citent un autre post" />
        {/* Compteurs fournis par la plateforme : les retweets eux-mêmes ne sont pas collectés. */}
        <KpiCard label="Retweets reçus" value={fmtNum(totalRetweets)} sub="compteur de la plateforme : retweets des posts collectés (non collectés eux-mêmes)" />
        <KpiCard label="Citations reçues" value={fmtNum(totalQuotes)} sub="compteur de la plateforme : citations des posts collectés" />
        <KpiCard label="Nbre de emojis" value={fmtNum(totalEmojis)} sub="émoticônes détectées" />
        <KpiCard label="Nbre de lien" value={fmtNum(postsWithLinks)} sub="posts avec URL" />
        <KpiCard label="Proportion des tweets avec liens" value={`${linkShare.toFixed(1)}%`} sub="parmi les posts collectés" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h3 style={{ ...titleStyle, marginBottom: 0 }}>Répartition par langue</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
              <label htmlFor="lang-min-share">Seuil</label>
              <select id="lang-min-share" value={langMinShare} onChange={(event) => setLangMinShare(Number(event.target.value))} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6 }}>
                {[0, 0.002, 0.005, 0.01, 0.02, 0.05].map((value) => <option key={value} value={value}>{value === 0 ? 'aucun' : `${value * 100} %`}</option>)}
              </select>
              <label htmlFor="lang-max-slices">Langues</label>
              <select id="lang-max-slices" value={langMaxSlices} onChange={(event) => setLangMaxSlices(Number(event.target.value))} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6 }}>
                {[5, 9, 12, 15].map((value) => <option key={value} value={value}>{value} max.</option>)}
              </select>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={langData} cx="50%" cy="50%" outerRadius={80} dataKey="value" labelLine={false} label={renderCustomLabel} isAnimationActive={false}>
                {langData.map((slice, i) => <Cell key={slice.key} fill={langColor(slice, i)} />)}
              </Pie>
              <Tooltip content={<LanguageTooltip total={langTotal} />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 8 }}>
            {langData.map((slice, i) => (
              <span key={slice.key} title={slice.details ? 'Survolez la part « Autres » pour le détail' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: langColor(slice, i), flexShrink: 0 }} />
                {slice.name} <span style={{ color: 'var(--text-muted)' }}>{fmtNum(slice.value)}</span>
              </span>
            ))}
          </div>
          {langData.some((slice) => slice.details) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              « Autres » regroupe les codes non identifiés (qme, und, zxx…), les langues sous le seuil choisi et celles au-delà du nombre maximal ; survolez-la pour le détail.
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <h3 style={{ ...titleStyle, marginBottom: 0 }}>{slide.title}</h3>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{typeSlide + 1} / {typeSlides.length}</span>
          </div>
          {/* Les trois comparaisons sont nommées pour qu'on voie d'emblée qu'il y en a d'autres. */}
          <div role="tablist" aria-label="Comparaisons de types de posts" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" aria-label="Comparaison précédente" style={arrowButtonStyle} onClick={() => setTypeSlide((typeSlide + typeSlides.length - 1) % typeSlides.length)}><ChevronLeft size={15} /></button>
            {typeSlides.map((item, index) => (
              <button
                key={item.title}
                type="button"
                role="tab"
                aria-selected={index === typeSlide}
                onClick={() => setTypeSlide(index)}
                style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${index === typeSlide ? 'var(--accent)' : 'var(--border)'}`, background: index === typeSlide ? 'var(--accent-dim)' : 'transparent', color: index === typeSlide ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                {item.part}
              </button>
            ))}
            <button type="button" aria-label="Comparaison suivante" style={arrowButtonStyle} onClick={() => setTypeSlide((typeSlide + 1) % typeSlides.length)}><ChevronRight size={15} /></button>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={typeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" labelLine={false} label={renderCustomLabel} isAnimationActive={false}>
                <Cell fill="#1d9e75" />
                <Cell fill="#eda100" />
              </Pie>
              <Tooltip formatter={(v, name) => [fmtNum(Number(v)), name]} contentStyle={tooltipBoxStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {typeData.map((d, i) => (
              <span key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: i === 0 ? '#1d9e75' : '#eda100' }} />
                {d.name} <strong style={{ color: 'var(--text-primary)' }}>{fmtNum(d.value)}</strong>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>{slide.note}</div>
        </div>
      </div>

      {/* Comparaison utile dès que la sélection couvre plusieurs événements. */}
      {eventStats.length > 1 && (
        <div style={{ ...cardStyle, marginBottom: '1rem' }}>
          <h3 style={titleStyle}>{eventStats.some((row) => row.event) ? 'Statistiques par événement' : 'Statistiques par collecte'}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>{eventStats.some((row) => row.event) ? 'Événement' : 'Collecte'}</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Posts</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Retweets</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Citations</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Emojis</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Liens</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>% Liens</th>
                </tr>
              </thead>
              <tbody>
                {eventStats.map((row) => (
                  <tr key={row.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-primary)', minWidth: 145 }}>{row.label}</td>
                    <StatCells item={row.total} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: '1rem' }}>
        <h3 style={titleStyle}>Top keywords détectés</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: '1rem' }}>
          Les deux listes n’ont pas la même source. Les <strong style={{ color: '#1d9e75' }}>hashtags</strong> sont extraits du texte des posts.
          Les <strong style={{ color: '#2a78d6' }}>mots-clés de paramètres</strong> sont ceux qui ont servi à collecter les posts (<code>matched_keywords</code>) :
          ils peuvent correspondre à du texte libre (« opening ceremony »), à une mention (@FIFAWorldCup) ou à un hashtag moins fréquent, et n’apparaissent donc pas toujours parmi les hashtags.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Hashtags détectés · top {topHashtags.length} par nombre de posts
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {topHashtags.length > 0 ? topHashtags.map(([tag, count]) => (
                <span key={tag} title={`${fmtNum(count)} posts contenant ce hashtag`} style={{ background: 'rgba(29,158,117,0.12)', color: '#1d9e75', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12 }}>
                  {tag.startsWith('#') ? tag : `#${tag}`} <span style={{ opacity: 0.7 }}>{fmtNum(count)}</span>
                </span>
              )) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aucun hashtag détecté</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Mots clés de paramètres · top {topParameterKeywords.length} sur {parameterKeywords.length} par nombre de posts
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {topParameterKeywords.length > 0 ? topParameterKeywords.map(([keyword, count]) => {
                const asHashtag = hashtagCountFor(keyword);
                const inTop = topHashtagSet.has(`#${keyword.toLowerCase().replace(/\s+/g, '')}`);
                return (
                  <span
                    key={keyword}
                    title={`${fmtNum(count)} posts collectés · ${asHashtag ? `#${keyword} : ${fmtNum(asHashtag)} posts avec ce hashtag` : 'absent des hashtags les plus fréquents'}`}
                    style={{ background: 'rgba(42,120,214,0.12)', color: '#2a78d6', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    {inTop && <span aria-label="aussi dans le top des hashtags" style={{ width: 6, height: 6, borderRadius: 999, background: '#1d9e75' }} />}
                    {keyword} <span style={{ opacity: 0.7 }}>{fmtNum(count)}</span>
                  </span>
                );
              }) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aucun mot-clé de paramètre</span>}
            </div>
            {topParameterKeywords.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: '#1d9e75', marginRight: 5 }} />
                présent aussi dans le top des hashtags · survolez un mot-clé pour le nombre de posts qui l’emploient en hashtag
              </div>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Posts par mot-clé de paramètre</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={kwData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-30} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={40} />
            <Tooltip formatter={(v) => [fmtNum(Number(v)) + " posts", "Occurrences"]} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {kwData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ ...cardStyle, padding: '1rem' }}>
          <h3 style={{ ...titleStyle, marginBottom: '0.75rem' }}>Top 10 auteurs les plus actifs</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topAuthorsList} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} width={160} />
              <Tooltip formatter={(v) => [fmtNum(Number(v)) + ' posts', '']} />
              <Bar dataKey="value" fill="#2a78d6" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                <LabelList dataKey="value" position="right" formatter={(v: any) => fmtNum(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          <h3 style={titleStyle}>Engagement moyen par métrique</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={engData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="metric" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={45} />
              <Tooltip formatter={(v) => [fmtNum(Number(v)), "Moyenne"]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {engData.map((d) => <Cell key={d.metric} fill={d.color} />)}
                <LabelList dataKey="value" position="top" formatter={(v: any) => fmtNum(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
