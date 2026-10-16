import React from 'react';

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, accent }) => (
  <div style={{
    background: accent ? 'linear-gradient(135deg, rgba(29,158,117,0.12), rgba(255,255,255,0.72))' : 'var(--card-bg)',
    border: `1px solid ${accent ? '#1d9e75' : 'var(--border)'}`,
    borderRadius: 14,
    padding: '1rem 1.15rem',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    boxShadow: 'var(--shadow)',
    minHeight: 112,
  }}>
    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
      {label}
    </span>
    <span style={{ fontSize: 24, fontWeight: 800, color: accent ? '#1d9e75' : 'var(--text-primary)', lineHeight: 1.1, marginTop: 4 }}>
      {value}
    </span>
    {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</span>}
  </div>
);

export default KpiCard;
