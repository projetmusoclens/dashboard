import React from 'react';
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, LabelList,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import { DashboardData } from '../types';
import { CHART_COLORS, LANG_LABELS } from '../data/dashboardData';
import KpiCard from './KpiCard';
import { fmtNum } from '../utils/format';

interface OverviewTabProps { data: DashboardData; selectedCollection?: string; timeline?: any[] }

const OverviewTab: React.FC<OverviewTabProps> = ({ data, selectedCollection = '', timeline = [] }) => {
  const filteredPosts = data.posts;

  const byLang = data.by_lang;

  const langData = Object.entries(byLang).map(([k, v]) => ({
    name: LANG_LABELS[k] || k, value: v,
  }));

  const kwData = Object.entries(data.by_keyword)
    .filter(([k]) => !k.startsWith('__'))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: k, value: v }));

  const topAuthorsList = Object.entries(data.top_authors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => ({ name: '@' + k, value: v }));

  const postsVs = data.posts_vs_replies;

  const typeData = [
    { name: 'Posts originaux', value: postsVs.posts },
    { name: 'Replies', value: postsVs.replies },
  ];

  const totalRetweets = data.engagement_sum.reposts || 0;
  const totalQuotes = data.engagement_sum.quotes || 0;
  const totalEmojis = data.collection_stats.reduce((sum, item) => sum + item.emojis, 0);
  const postsWithLinks = data.collection_stats.reduce((sum, item) => sum + item.links, 0);
  const linkShare = data.total_posts > 0 ? (postsWithLinks / data.total_posts) * 100 : 0;

  const collectionStats = data.collection_stats;

  const avg = (value: number | null | undefined) => value === null || value === undefined ? null : Math.round(value);
  const avgLikes = avg(data.engagement_avg.likes);
  const avgReposts = avg(data.engagement_avg.reposts);
  const avgReplies = avg(data.engagement_avg.replies);
  const avgViews = avg(data.engagement_avg.views);
  const ENG_COLORS = ['#1d9e75', '#eda100', '#2a78d6', '#4a3aa7'];
  const engData = [
    { metric: 'Likes moy.', value: avgLikes, color: ENG_COLORS[0] },
    { metric: 'Reposts moy.', value: avgReposts, color: ENG_COLORS[1] },
    { metric: 'Replies moy.', value: avgReplies, color: ENG_COLORS[2] },
    { metric: 'Vues moy.', value: avgViews, color: ENG_COLORS[3] },
  ];

  const stopWords = new Set(['the', 'and', 'for', 'this', 'that', 'you', 'are', 'with', 'from', 'dans', 'des', 'les', 'pour', 'une', 'sur', 'avec']);
  const collectedWords = Object.entries(data.by_keyword)
    .filter(([word]) => word.length > 2 && !word.startsWith('__') && !word.startsWith('#') && !word.startsWith('@') && !stopWords.has(word.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);

  const collectedHashtags = Object.entries(data.hashtags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag.replace(/^#/, ''));

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

  return (
    <div>
      {/* Timeline chart */}
      {/* Summary: total and platform breakdown for current filters */}
      {(() => {
        const platformsFromStats: Record<string, number> = (data as any).by_platform || {};
        const computedPlatforms = filteredPosts.reduce((acc: Record<string, number>, p) => {
          const k = (p.platform || 'unknown').toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc;
        }, {});
        const platforms = Object.keys(platformsFromStats).length ? platformsFromStats : computedPlatforms;
        const twitterCount = platforms.twitter || platforms.Twitter || 0;
        const blueskyCount = platforms.bluesky || platforms.Bluesky || 0;
        const unknownCount = Object.values(platforms).reduce((s: number, v: any) => s + (Number(v) || 0), 0) - (twitterCount || 0) - (blueskyCount || 0);
        return (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Total (sélection): {fmtNum(data.total_posts || filteredPosts.length)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Twitter: {fmtNum(twitterCount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Bluesky: {fmtNum(blueskyCount)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Unknown: {fmtNum(unknownCount)}</div>
          </div>
        );
      })()}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Timeline</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={timeline} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total" stroke="#1d9e75" dot={false} />
            <Line type="monotone" dataKey="twitter" stroke="#2a78d6" dot={false} />
            <Line type="monotone" dataKey="bluesky" stroke="#eda100" dot={false} />
            <Line type="monotone" dataKey="unknown" stroke="#888888" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: '1.5rem' }}>
        <KpiCard label="Total posts" value={fmtNum(data.total_posts)} sub="total" accent />
        {/* Platform breakdown */}
        {(() => {
          const platforms = data.by_platform || {};
          const twitter = platforms.twitter || platforms.Twitter || 0;
          const bluesky = platforms.bluesky || platforms.Bluesky || 0;
          const unknown = Object.values(platforms).reduce((s:any,v:any)=>s+(v||0),0) - (twitter||0) - (bluesky||0);
          return (
            <>
              <KpiCard label="Twitter posts" value={fmtNum(twitter)} sub="Twitter" />
              <KpiCard label="Bluesky posts" value={fmtNum(bluesky)} sub="Bluesky" />
              <KpiCard label="Unknown platform" value={fmtNum(unknown)} sub="non catégorisé" />
            </>
          );
        })()}
        <KpiCard label="Vues totales" value={fmtNum(data.engagement_sum.views)} sub="cumul engagement" />
        <KpiCard label="Posts originaux" value={fmtNum(data.posts_vs_replies.posts)} sub="selon reply_to_id" />
        <KpiCard label="Replies collectées" value={fmtNum(data.posts_vs_replies.replies)} sub="selon reply_to_id" />
        <KpiCard label="Nbre de Retweet" value={fmtNum(totalRetweets)} sub="somme des reposts affichés" />
        <KpiCard label="Nbre citation" value={fmtNum(totalQuotes)} sub="citations affichées" />
        <KpiCard label="Nbre de emojis" value={fmtNum(totalEmojis)} sub="émoticônes détectées" />
        <KpiCard label="Nbre de lien" value={fmtNum(postsWithLinks)} sub="posts avec URL" />
        <KpiCard label="Proportion des tweets avec liens" value={`${linkShare.toFixed(1)}%`} sub="parmi les posts collectés" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
            Répartition par langue
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={langData} cx="50%" cy="50%" outerRadius={80} dataKey="value" labelLine={false} label={renderCustomLabel}>
                {langData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => [fmtNum(Number(v)) + " posts", ""]} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 8 }}>
            {langData.map((d, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                {d.name} <span style={{ color: 'var(--text-muted)' }}>{fmtNum(d.value)}</span>
              </span>
            ))}
          </div>
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
            Posts vs Replies
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={typeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" labelLine={false} label={renderCustomLabel}>
                <Cell fill="#1d9e75" />
                <Cell fill="#eda100" />
              </Pie>
              <Tooltip formatter={(v) => [fmtNum(Number(v)), ""]} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 8 }}>
            {typeData.map((d, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: i === 0 ? '#1d9e75' : '#eda100' }} />
                {d.name} <strong style={{ color: 'var(--text-primary)' }}>{fmtNum(d.value)}</strong>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
          Statistiques par collecte
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Collecte</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Posts</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Retweets</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Citations</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Emojis</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>Liens</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>% Liens</th>
              </tr>
            </thead>
            <tbody>
              {collectionStats.map((item) => (
                <tr key={item.collection_name} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-primary)', minWidth: 145 }}>{item.collection_name}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{fmtNum(item.count)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{fmtNum(item.reposts)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{fmtNum(item.quotes)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{fmtNum(item.emojis)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{fmtNum(item.links)}</td>
                  <td style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>{item.link_rate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
          Top keywords collectés
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Hashtags détectés
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {collectedHashtags.length > 0 ? collectedHashtags.map(tag => (
                <span key={tag} style={{ background: 'rgba(29,158,117,0.12)', color: '#1d9e75', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12 }}>
                  #{tag}
                </span>
              )) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aucun hashtag détecté</span>}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Mots collectés
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {collectedWords.length > 0 ? collectedWords.map(word => (
                <span key={word} style={{ background: 'rgba(42,120,214,0.12)', color: '#2a78d6', padding: '0.35rem 0.65rem', borderRadius: 999, fontSize: 12 }}>
                  {word}
                </span>
              )) : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aucun mot détecté</span>}
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={kwData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-30} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={40} />
            <Tooltip formatter={(v) => [fmtNum(Number(v)) + " posts", "Occurrences"]} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {kwData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
            Top 10 auteurs les plus actifs
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topAuthorsList.sort((a, b) => b.value - a.value)} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} width={160} />
              <Tooltip formatter={(v) => [fmtNum(Number(v)) + ' posts', '']} />
              <Bar dataKey="value" fill="#2a78d6" radius={[0, 6, 6, 0]}>
                <LabelList dataKey="value" position="right" formatter={(v: any) => fmtNum(Number(v))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem' }}>
            Engagement moyen par métrique
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={engData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="metric" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={45} />
              <Tooltip formatter={(v) => [fmtNum(Number(v)), "Moyenne"]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
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
