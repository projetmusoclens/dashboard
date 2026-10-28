import React, { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronUp, Info, PencilLine, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import api from '../services/api';
import { Collection, EventMoment, EventMomentKind, EventSheet, QueryParams, TimelineResponse } from '../types';
import { fmtNum } from '../utils/format';

// Événements de collecte (matchs) : carte « Match » sous la courbe de la Vue globale (courbe resserrée
// sur le match, repères et déroulé), panneau dédié à la fiche, formulaire de modification (administrateurs).

export const MOMENT_KINDS: Record<EventMomentKind, { label: string; icon: string; color: string }> = {
  kickoff: { label: 'Coup d’envoi', icon: '▶', color: '#1d9e75' },
  goal: { label: 'But', icon: '⚽', color: '#e34948' },
  penalty: { label: 'Penalty', icon: '◎', color: '#e34948' },
  yellow_card: { label: 'Carton jaune', icon: '▮', color: '#e5a00d' },
  red_card: { label: 'Carton rouge', icon: '▮', color: '#c62828' },
  substitution: { label: 'Remplacement', icon: '⇄', color: '#2a78d6' },
  var: { label: 'VAR', icon: '▣', color: '#7a4fd0' },
  halftime: { label: 'Mi-temps', icon: '‖', color: '#73726c' },
  second_half: { label: 'Reprise', icon: '▶', color: '#73726c' },
  extra_time: { label: 'Prolongation', icon: '+', color: '#73726c' },
  shootout: { label: 'Tirs au but', icon: '◉', color: '#e34948' },
  end: { label: 'Fin du match', icon: '■', color: '#1d9e75' },
  other: { label: 'Autre', icon: '•', color: '#73726c' },
};

const dateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayTime = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// Champ datetime-local (heure locale) ⇄ ISO (UTC).
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : '');

const kindLabel = (moment: EventMoment) => MOMENT_KINDS[moment.kind]?.label || 'Moment';
// Description sans répétition : « But (23′) · France · Mbappé · 18 juil., 21:23 ».
const momentTitle = (moment: EventMoment) => [
  `${kindLabel(moment)}${moment.minute ? ` (${moment.minute}′)` : ''}`,
  moment.team,
  moment.label !== kindLabel(moment) ? moment.label : '',
  dayTime.format(new Date(moment.time)),
].filter(Boolean).join(' · ');

// Fenêtre de la courbe resserrée : 30 min avant le premier repère (coup d'envoi), jusqu'à 1 h après
// le dernier (ou après 2 h de match si le déroulé n'est pas saisi). null sans aucun repère daté.
const MINUTE = 60000;
export function matchWindow(sheet: EventSheet): { start: number; end: number } | null {
  const times = [sheet.kickoff_at, ...sheet.moments.map((moment) => moment.time)].map((value) => (value ? Date.parse(value) : NaN)).filter(Number.isFinite);
  if (!times.length) return null;
  const kickoff = sheet.kickoff_at ? Date.parse(sheet.kickoff_at) : NaN;
  const last = Math.max(...times, Number.isFinite(kickoff) ? kickoff + 120 * MINUTE : -Infinity);
  return { start: Math.min(...times) - 30 * MINUTE, end: last + 60 * MINUTE };
}

// Carte « Match » repliée ou non : préférence de ce navigateur, conservée d'une visite à l'autre.
const COLLAPSED_KEY = 'heimdall-match-card-collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
const writeCollapsed = (value: boolean) => { try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0'); } catch { /* sans stockage, le choix vaut pour la visite */ } };

const momentShort = (moment: EventMoment) => `${MOMENT_KINDS[moment.kind]?.icon || '•'}${moment.minute ? ` ${moment.minute}′` : ''}`;

// « Déroulé du match » : courbe resserrée sur le match, ses moments clés et leur liste.
// Repliable par tous (préférence du navigateur) ; « Modifier » n'apparaît que pour les administrateurs.
export const MatchCard: React.FC<{
  sheets: EventSheet[];
  collections: Collection[];
  filters: QueryParams;
  canEdit: boolean;
  onEdit: (sheet: EventSheet) => void;
  onReset: (sheet: EventSheet) => void;
}> = ({ sheets, collections, filters, canEdit, onEdit, onReset }) => {
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => { writeCollapsed(!collapsed); setCollapsed(!collapsed); };
  const sheet = sheets.find((item) => item.event === activeEvent) || sheets[0];
  const span = sheet ? matchWindow(sheet) : null;
  const filtersKey = JSON.stringify(filters);

  // Collectes du match (parmi celles cochées, s'il y en a) et fenêtre du match.
  const params = useMemo<QueryParams | null>(() => {
    if (!sheet) return null;
    const base = JSON.parse(filtersKey) as QueryParams;
    const chosen = new Set((base.collectionId || '').split(',').filter(Boolean));
    const ids = collections.filter((collection) => collection.event === sheet.event && (!chosen.size || chosen.has(collection.id))).map((collection) => collection.id);
    return {
      ...base,
      collectionId: ids.join(','),
      ...(span ? { startTime: new Date(span.start).toISOString(), endTime: new Date(span.end).toISOString() } : {}),
    };
  }, [sheet, collections, filtersKey, span?.start, span?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carte repliée : la courbe n'est pas chargée.
  useEffect(() => {
    if (collapsed) return undefined;
    if (!params?.collectionId) { setTimeline(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    api.getTimeline(params)
      .then((result) => { if (!cancelled) setTimeline(result); })
      .catch(() => { if (!cancelled) setTimeline(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, collapsed]);

  if (!sheet) return null;
  const points = timeline?.points || [];
  const domain: [number, number] | ['dataMin', 'dataMax'] = span ? [span.start, span.end] : ['dataMin', 'dataMax'];
  const moments = sheet.moments.map((moment, index) => ({ ...moment, index, ts: Date.parse(moment.time) }));

  return (
    <div className={`match-card ${collapsed ? 'collapsed' : ''}`}>
      <div className="match-section-title">
        <h3>Déroulé du match</h3>
        <span>Volume de posts pendant le match et moments clés</span>
      </div>
      {sheets.length > 1 && !collapsed && (
        <div className="match-tabs" role="tablist" aria-label="Matchs de la sélection">
          {sheets.map((item) => (
            <button key={item.event} type="button" role="tab" aria-selected={item.event === sheet.event} className={item.event === sheet.event ? 'active' : ''} onClick={() => { setActiveEvent(item.event); setHovered(null); }}>
              {item.title || item.event}
            </button>
          ))}
        </div>
      )}
      <div className="match-head">
        <div>
          <h3 className="match-title">{sheet.title || sheet.event}{sheet.score && <span className="match-score">{sheet.score}</span>}</h3>
          <div className="match-meta">{[sheet.stage, sheet.kickoff_at ? dateTime.format(new Date(sheet.kickoff_at)) : '', sheet.venue].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="match-actions">
          <button type="button" className="explorer-btn" onClick={() => setPanelOpen(true)}><Info size={12} /> Fiche du match</button>
          {canEdit && <button type="button" className="explorer-btn" onClick={() => onEdit(sheet)}><PencilLine size={12} /> Modifier</button>}
          <button type="button" className="explorer-btn" aria-expanded={!collapsed} onClick={toggleCollapsed}>
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />} {collapsed ? 'Afficher le déroulé' : 'Masquer le déroulé'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
        {!span && <div className="match-hint">Pas encore de coup d’envoi ni de déroulé : la courbe couvre toute la collecte de cet événement.{canEdit ? ' « Modifier » pour les saisir.' : ''}</div>}
        {loading && !points.length ? (
          <div className="match-empty">Chargement de la courbe…</div>
        ) : points.length === 0 ? (
          <div className="match-empty">Aucun post daté pour ce match avec ces filtres.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={points} margin={{ top: 22, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="ts" type="number" scale="time" domain={domain} allowDataOverflow tickFormatter={(value) => timeOnly.format(new Date(Number(value)))} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} minTickGap={40} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={fmtNum} width={44} allowDecimals={false} />
              <Tooltip
                labelFormatter={(value) => dayTime.format(new Date(Number(value)))}
                formatter={(value) => [`${fmtNum(Number(value))} posts`, `par tranche de ${timeline?.bucket_minutes || 1} min`]}
                contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              />
              {moments.map((moment) => (
                <ReferenceLine
                  key={moment.index}
                  x={moment.ts}
                  stroke={MOMENT_KINDS[moment.kind]?.color || '#73726c'}
                  strokeWidth={hovered === moment.index ? 2.5 : 1}
                  strokeDasharray={hovered === moment.index ? undefined : '4 3'}
                  ifOverflow="hidden"
                  label={{ value: momentShort(moment), position: 'top', fontSize: 11, fill: MOMENT_KINDS[moment.kind]?.color || '#73726c' }}
                />
              ))}
              <Line type="monotone" dataKey="total" name="Posts" stroke="#1d9e75" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {sheet.moments.length > 0 && (
          <ol className="match-moments" aria-label="Déroulé du match">
            {moments.map((moment) => {
              const meta = MOMENT_KINDS[moment.kind] || MOMENT_KINDS.other;
              return (
                <li key={moment.index} className={hovered === moment.index ? 'active' : ''} onMouseEnter={() => setHovered(moment.index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(moment.index)} onBlur={() => setHovered(null)} tabIndex={0}>
                  <span className="match-moment-time">{timeOnly.format(new Date(moment.time))}</span>
                  <span className="match-moment-icon" style={{ color: meta.color }}>{meta.icon}</span>
                  <span>{momentTitle(moment).split(' · ').slice(0, -1).join(' · ')}</span>
                </li>
              );
            })}
          </ol>
        )}
        </>
      )}

      {panelOpen && <EventSheetPanel sheet={sheet} canEdit={canEdit} onEdit={() => onEdit(sheet)} onReset={() => onReset(sheet)} onClose={() => setPanelOpen(false)} />}
    </div>
  );
};

// Panneau dédié à la fiche : informations, déroulé et méthodologie de la collecte.
export const EventSheetPanel: React.FC<{ sheet: EventSheet; canEdit: boolean; onEdit: () => void; onReset: () => void; onClose: () => void }> = ({ sheet, canEdit, onEdit, onReset, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="match-panel-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="match-panel" role="dialog" aria-modal="true" aria-labelledby="match-panel-title">
        <div className="match-panel-head">
          <div>
            <h2 id="match-panel-title">{sheet.title || sheet.event}</h2>
            <div className="match-meta">{[sheet.stage, sheet.score].filter(Boolean).join(' · ')}</div>
          </div>
          <button type="button" className="explorer-btn" onClick={onClose} aria-label="Fermer la fiche"><X size={14} /></button>
        </div>
        <div className="match-panel-body">
          <dl className="event-sheet-facts">
            {sheet.teams.length > 0 && <><dt>Équipes</dt><dd>{sheet.teams.join(' – ')}</dd></>}
            {sheet.stage && <><dt>Tour</dt><dd>{sheet.stage}</dd></>}
            {sheet.venue && <><dt>Lieu</dt><dd>{sheet.venue}</dd></>}
            {sheet.kickoff_at && <><dt>Coup d’envoi</dt><dd>{dateTime.format(new Date(sheet.kickoff_at))} (heure locale)</dd></>}
            {sheet.score && <><dt>Score</dt><dd>{sheet.score}</dd></>}
          </dl>
          {sheet.summary && <p className="event-sheet-summary">{sheet.summary}</p>}
          <h4>Déroulé</h4>
          {sheet.moments.length ? (
            <ol className="event-sheet-moments">
              {sheet.moments.map((moment, index) => {
                const meta = MOMENT_KINDS[moment.kind] || MOMENT_KINDS.other;
                return (
                  <li key={`${moment.time}-${index}`}>
                    <span className="event-sheet-time">{timeOnly.format(new Date(moment.time))}</span>
                    <span className="event-sheet-icon" style={{ color: meta.color }}>{meta.icon}</span>
                    <span>{momentTitle(moment).split(' · ').slice(0, -1).join(' · ')}</span>
                  </li>
                );
              })}
            </ol>
          ) : <p className="event-sheet-empty">Aucun moment saisi.</p>}
          {(sheet.collections || sheet.keywords || sheet.notes) && (
            <>
              <h4>Méthodologie de la collecte</h4>
              <dl className="event-sheet-facts">
                {sheet.collections && <><dt>Collectes</dt><dd>{sheet.collections}</dd></>}
                {sheet.keywords && <><dt>Mots-clés</dt><dd>{sheet.keywords}</dd></>}
                {sheet.notes && <><dt>Remarques</dt><dd>{sheet.notes}</dd></>}
              </dl>
            </>
          )}
          <div className="event-sheet-source">
            {sheet.customized && sheet.updated_at ? `Modifiée le ${dateTime.format(new Date(sheet.updated_at))}${sheet.updated_by ? ` par ${sheet.updated_by}` : ''}` : sheet.source}
          </div>
        </div>
        {canEdit && (
          <div className="match-panel-foot">
            {sheet.customized && <button type="button" className="explorer-btn" onClick={onReset}><RotateCcw size={12} /> Revenir à la fiche pré-remplie</button>}
            <button type="button" className="explorer-btn primary" onClick={onEdit}><PencilLine size={12} /> Modifier la fiche</button>
          </div>
        )}
      </aside>
    </div>
  );
};

const emptyMoment = (time: string): EventMoment => ({ time, kind: 'goal', minute: '', team: '', label: '' });

// Heure approchée d'après la minute de jeu : coup d'envoi + minute (+ 15 min de pause après la 45e).
function timeFromMinute(kickoff: string | null, minute: string) {
  const match = /^(\d+)(?:\s*\+\s*(\d+))?/.exec(minute.trim());
  if (!kickoff || !match) return '';
  const played = Number(match[1]) + Number(match[2] || 0);
  const pause = Number(match[1]) > 45 ? 15 : 0;
  return new Date(Date.parse(kickoff) + (played + pause) * 60000).toISOString();
}

// Formulaire de modification d'une fiche (administrateurs).
export const EventSheetEditor: React.FC<{ sheet: EventSheet; saving: boolean; error: string | null; onSave: (sheet: EventSheet) => void; onClose: () => void }> = ({ sheet, saving, error, onSave, onClose }) => {
  const [draft, setDraft] = useState<EventSheet>(() => ({ ...sheet, teams: [sheet.teams[0] || '', sheet.teams[1] || ''], moments: sheet.moments.map((moment) => ({ ...moment })) }));
  const set = <K extends keyof EventSheet>(key: K, value: EventSheet[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setMoment = (index: number, patch: Partial<EventMoment>) => setDraft((current) => ({
    ...current,
    moments: current.moments.map((moment, position) => {
      if (position !== index) return moment;
      const next = { ...moment, ...patch };
      // Minute saisie : l'heure est déduite du coup d'envoi tant qu'elle n'a pas été choisie à la main.
      const automatic = !moment.time || moment.time === timeFromMinute(current.kickoff_at, moment.minute);
      if (patch.minute !== undefined && automatic) next.time = timeFromMinute(current.kickoff_at, patch.minute);
      return next;
    }),
  }));
  const addMoment = () => setDraft((current) => ({ ...current, moments: [...current.moments, emptyMoment('')] }));
  const removeMoment = (index: number) => setDraft((current) => ({ ...current, moments: current.moments.filter((_, position) => position !== index) }));
  const teams = draft.teams.filter(Boolean);

  return (
    <div className="explorer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="explorer-modal event-editor" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
        <div className="explorer-modal-head">
          <h2 id="event-editor-title">Fiche : {sheet.title || sheet.event}</h2>
          <button type="button" className="explorer-btn" onClick={onClose} aria-label="Fermer"><X size={14} /></button>
        </div>
        <form className="explorer-modal-body event-editor-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, teams: draft.teams.filter(Boolean), moments: draft.moments.filter((moment) => moment.time) }); }}>
          <div className="event-editor-grid">
            <label>Titre<input value={draft.title} onChange={(event) => set('title', event.target.value)} /></label>
            <label>Tour<input value={draft.stage} onChange={(event) => set('stage', event.target.value)} placeholder="Quart de finale, finale…" /></label>
            <label>Équipe 1<input value={draft.teams[0] || ''} onChange={(event) => set('teams', [event.target.value, draft.teams[1] || ''])} /></label>
            <label>Équipe 2<input value={draft.teams[1] || ''} onChange={(event) => set('teams', [draft.teams[0] || '', event.target.value])} /></label>
            <label>Coup d’envoi (heure locale)<input type="datetime-local" value={toLocalInput(draft.kickoff_at)} onChange={(event) => set('kickoff_at', fromLocalInput(event.target.value) || null)} /></label>
            <label>Score<input value={draft.score} onChange={(event) => set('score', event.target.value)} placeholder="2-1 (a.p.)" /></label>
            <label className="wide">Lieu<input value={draft.venue} onChange={(event) => set('venue', event.target.value)} /></label>
            <label className="wide">Résumé<textarea rows={3} value={draft.summary} onChange={(event) => set('summary', event.target.value)} /></label>
          </div>

          <h3>Déroulé du match</h3>
          <p className="event-editor-help">Une ligne par moment. En saisissant la minute de jeu sur une ligne sans heure, l’heure est calculée à partir du coup d’envoi (avec 15 min de pause après la 45e) : ajustez-la si besoin.</p>
          <div className="event-editor-moments">
            {draft.moments.map((moment, index) => (
              <div key={index} className="event-editor-moment">
                <select aria-label="Type" value={moment.kind} onChange={(event) => setMoment(index, { kind: event.target.value as EventMomentKind })}>
                  {Object.entries(MOMENT_KINDS).map(([kind, meta]) => <option key={kind} value={kind}>{meta.icon} {meta.label}</option>)}
                </select>
                <input aria-label="Minute" className="minute" value={moment.minute} onChange={(event) => setMoment(index, { minute: event.target.value })} placeholder="min." />
                <input aria-label="Heure" type="datetime-local" value={toLocalInput(moment.time)} onChange={(event) => setMoment(index, { time: fromLocalInput(event.target.value) })} />
                <select aria-label="Équipe" value={moment.team} onChange={(event) => setMoment(index, { team: event.target.value })}>
                  <option value="">—</option>
                  {teams.map((team) => <option key={team} value={team}>{team}</option>)}
                </select>
                <input aria-label="Description" className="label" value={moment.label} onChange={(event) => setMoment(index, { label: event.target.value })} placeholder="Description (buteur, joueur…)" />
                <button type="button" className="explorer-btn danger" onClick={() => removeMoment(index)} aria-label="Supprimer ce moment"><Trash2 size={12} /></button>
              </div>
            ))}
            <button type="button" className="explorer-btn" onClick={addMoment}><Plus size={12} /> Ajouter un moment</button>
          </div>

          <h3>Méthodologie de la collecte</h3>
          <div className="event-editor-grid">
            <label className="wide">Collectes<textarea rows={2} value={draft.collections} onChange={(event) => set('collections', event.target.value)} /></label>
            <label className="wide">Mots-clés<textarea rows={3} value={draft.keywords} onChange={(event) => set('keywords', event.target.value)} /></label>
            <label className="wide">Remarques<textarea rows={3} value={draft.notes} onChange={(event) => set('notes', event.target.value)} /></label>
          </div>

          {error && <div className="explorer-error">{error}</div>}
          <div className="event-editor-footer">
            <button type="button" className="explorer-btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="explorer-btn primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer la fiche'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
