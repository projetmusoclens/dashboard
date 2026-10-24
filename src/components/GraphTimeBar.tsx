import React, { useRef } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { GraphTime, TimeSeries } from '../types';
import { fmtNum } from '../utils/format';
import { formatDuration, formatWindow, TimeMode, TimeWindow } from '../utils/graphTime';

// Frise du graphe dynamique, posée en haut du graphe (elle reste visible en plein écran) :
// volume de posts par tranche, fenêtre affichée, curseur et lecture.

interface GraphTimeBarProps {
  time: GraphTime;
  window: TimeWindow;
  position: number;
  onPosition: (position: number) => void;
  mode: TimeMode;
  onMode: (mode: TimeMode) => void;
  windowSize: number;
  windowSizes: number[];
  onWindowSize: (size: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  hideInactive: boolean;
  onHideInactive: (hide: boolean) => void;
  stats: { nodes: number; edges: number; posts: number };
}

const SPEEDS = [0.5, 1, 2, 4];

const GraphTimeBar: React.FC<GraphTimeBarProps> = ({
  time, window, position, onPosition, mode, onMode, windowSize, windowSizes, onWindowSize,
  playing, onTogglePlay, onRestart, speed, onSpeed, hideInactive, onHideInactive, stats,
}) => {
  const chartRef = useRef<SVGSVGElement | null>(null);
  const max = Math.max(1, ...time.volume);
  const width = Math.max(1, time.buckets);

  // Clic ou glissement sur la courbe : la fenêtre se termine à la tranche visée.
  const seek = (clientX: number) => {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    onPosition(Math.min(time.buckets - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * time.buckets))));
  };

  return (
    <div className="graph-timebar" onMouseDown={(event) => event.stopPropagation()}>
      <div className="graph-timebar-controls">
        <button type="button" className="graph-timebar-btn" onClick={onRestart} title="Revenir au début" aria-label="Revenir au début"><SkipBack size={14} /></button>
        <button type="button" className="graph-timebar-btn primary" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Lecture'} title={playing ? 'Pause' : 'Lecture'}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <select aria-label="Vitesse de lecture" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
          {SPEEDS.map((value) => <option key={value} value={value}>×{value}</option>)}
        </select>
        <select aria-label="Mode" value={mode} onChange={(event) => onMode(event.target.value as TimeMode)}>
          <option value="cumulative">Cumulé depuis le début</option>
          <option value="sliding">Fenêtre glissante</option>
        </select>
        {mode === 'sliding' && (
          <select aria-label="Largeur de la fenêtre" value={windowSize} onChange={(event) => onWindowSize(Number(event.target.value))}>
            {windowSizes.map((size) => <option key={size} value={size}>Fenêtre : {formatDuration(size * time.bucket_minutes)}</option>)}
          </select>
        )}
        <label className="graph-timebar-check">
          <input type="checkbox" checked={hideInactive} onChange={(event) => onHideInactive(event.target.checked)} /> Masquer les inactifs
        </label>
        <span className="graph-timebar-label">
          <strong>{formatWindow(time, window)}</strong>
          {' · '}{fmtNum(stats.posts)} posts · {fmtNum(stats.nodes)} nœuds · {fmtNum(stats.edges)} liens actifs
          {' · '}tranches de {formatDuration(time.bucket_minutes)}
        </span>
      </div>
      <svg
        ref={chartRef}
        className="graph-timebar-chart"
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        role="slider"
        aria-label="Position dans le temps"
        aria-valuemin={0}
        aria-valuemax={time.buckets - 1}
        aria-valuenow={position}
        tabIndex={0}
        onMouseDown={(event) => {
          seek(event.clientX);
          const move = (moveEvent: MouseEvent) => seek(moveEvent.clientX);
          const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); onPosition(Math.max(0, position - 1)); }
          if (event.key === 'ArrowRight') { event.preventDefault(); onPosition(Math.min(time.buckets - 1, position + 1)); }
        }}
      >
        <rect className="graph-timebar-window" x={window.from} y={0} width={window.to - window.from + 1} height={100} />
        {time.volume.map((count, index) => (
          count > 0 && (
            <rect
              key={index}
              className={index >= window.from && index <= window.to ? 'graph-timebar-bar active' : 'graph-timebar-bar'}
              x={index + 0.1}
              y={100 - (count / max) * 96}
              width={0.8}
              height={(count / max) * 96}
            />
          )
        ))}
        <line className="graph-timebar-cursor" x1={position + 1} x2={position + 1} y1={0} y2={100} />
      </svg>
    </div>
  );
};

// Activité d'un nœud dans le temps, avec la fenêtre courante (panneau « Détails du nœud »).
export const NodeSparkline: React.FC<{ series: TimeSeries | undefined; buckets: number; window: TimeWindow }> = ({ series, buckets, window }) => {
  const max = Math.max(1, ...(series || []).map(([, count]) => count));
  return (
    <svg className="graph-sparkline" viewBox={`0 0 ${Math.max(1, buckets)} 30`} preserveAspectRatio="none" aria-hidden="true">
      <rect className="graph-timebar-window" x={window.from} y={0} width={window.to - window.from + 1} height={30} />
      {(series || []).map(([bucket, count]) => (
        <rect key={bucket} className="graph-sparkline-bar" x={bucket + 0.1} y={30 - (count / max) * 28} width={0.8} height={(count / max) * 28} />
      ))}
    </svg>
  );
};

export default GraphTimeBar;
