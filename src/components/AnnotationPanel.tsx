import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, PencilLine, Share2, Users } from 'lucide-react';
import api from '../services/api';
import { PostAnnotations, StoredAnnotation, UserProfile } from '../types';
import {
  Annotation, annotationKey, defaultAnnotation, INTERACTION_LABELS, RELEVANCE_LABELS, STATUS_LABELS, TONE_LABELS,
} from '../utils/annotations';
import { useAuth } from './AuthGate';

// Panneau d'annotation d'un post, partagé par l'Explorer et Threads :
// formulaire (nouvelle annotation ou modification), mes annotations du post et celles qui me sont partagées.

const THEME_SUGGESTIONS = ['Sport et événement', 'Communication en ligne', 'Supporters', 'Médias', 'Politique', 'Économie numérique', 'Arbitrage', 'Billetterie', 'Sécurité'];

export const formatDate = (raw: string | null) => {
  if (!raw) return '—';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export const fromServer = (item: StoredAnnotation): Annotation => ({
  status: item.status, relevance: item.relevance, theme: item.theme, tone: item.tone,
  interaction: item.interaction, keywords: item.keywords, note: item.note, updatedAt: item.updated_at,
});

const FIELD_KEYS = ['status', 'relevance', 'theme', 'tone', 'interaction', 'keywords', 'note'] as const;
const fieldsOf = (annotation: Annotation) => Object.fromEntries(FIELD_KEYS.map((key) => [key, annotation[key]])) as Pick<StoredAnnotation, typeof FIELD_KEYS[number]>;
// Un formulaire resté à ses valeurs par défaut n'est pas un brouillon.
const isEmptyDraft = (annotation: Annotation) => FIELD_KEYS.every((key) => annotation[key] === defaultAnnotation()[key]);

// Annotation en lecture seule (carte) : la mienne dans la liste du post, ou celle d'une autre personne.
export const AnnotationSummary: React.FC<{ item: StoredAnnotation; title: React.ReactNode; action?: React.ReactNode; highlighted?: boolean }> = ({ item, title, action, highlighted }) => {
  const details = [
    item.theme && `Thème : ${item.theme}`,
    item.tone && `Tonalité : ${TONE_LABELS[item.tone] || item.tone}`,
    item.interaction && `Interaction : ${INTERACTION_LABELS[item.interaction] || item.interaction}`,
    item.keywords && `Mots-clés : ${item.keywords}`,
  ].filter(Boolean);
  return (
    <div className={`explorer-annotation-card ${highlighted ? 'editing' : ''}`}>
      <div className="explorer-annotation-card-head">
        <span className="explorer-annotation-card-title">{title}</span>
        <span className="explorer-annotation-card-date" title={item.updated_at && item.updated_at !== item.created_at ? `Modifiée le ${formatDate(item.updated_at)}` : undefined}>
          {formatDate(item.created_at || item.updated_at || null)}{item.updated_at && item.created_at && item.updated_at !== item.created_at ? ' · modifiée' : ''}
        </span>
      </div>
      <div className="explorer-item-footer">
        <span className={`explorer-pill ${item.status === 'analyse' ? 'saved' : item.status === 'a_discuter' ? 'discuss' : ''}`}>{STATUS_LABELS[item.status] || item.status}</span>
        {item.relevance && <span className={`explorer-pill ${item.relevance === 'non' ? 'no' : item.relevance === 'incertain' ? 'discuss' : 'saved'}`}>{RELEVANCE_LABELS[item.relevance]}</span>}
      </div>
      {details.length > 0 && <div className="explorer-annotation-card-details">{details.join(' · ')}</div>}
      {item.note && <div className="explorer-annotation-card-note">{item.note}</div>}
      {item.note_hidden && <div className="explorer-annotation-card-hidden">Commentaire libre non partagé</div>}
      {action}
    </div>
  );
};

const newestFirst = (left: StoredAnnotation, right: StoredAnnotation) => String(right.created_at || right.updated_at || '').localeCompare(String(left.created_at || left.updated_at || ''));

export type MineUpdater = (key: string, update: (list: StoredAnnotation[]) => StoredAnnotation[]) => void;

// Mes annotations, groupées par post (clé annotationKey), de la plus récente à la plus ancienne.
export function useMyAnnotations(notify: (message: string) => void) {
  const [annotations, setAnnotations] = useState<Record<string, StoredAnnotation[]>>({});
  const reload = useCallback(() => api.getAnnotations('mine')
    .then(({ annotations: items }) => {
      const byPost: Record<string, StoredAnnotation[]> = {};
      items.forEach((item) => { (byPost[annotationKey(item.platform, item.post_id)] ||= []).push(item); });
      Object.values(byPost).forEach((list) => list.sort(newestFirst));
      setAnnotations(byPost);
    })
    .catch((error) => notify(`Annotations indisponibles : ${error.message}`)), [notify]);
  useEffect(() => { reload(); }, [reload]);
  const update = useCallback<MineUpdater>((key, change) => setAnnotations((all) => ({ ...all, [key]: change(all[key] || []) })), []);
  return { annotations, reload, update };
}

// Comptes actifs, pour choisir avec qui partager.
export function useDirectory() {
  const [directory, setDirectory] = useState<UserProfile[]>([]);
  useEffect(() => {
    api.getDirectory().then((result) => setDirectory(result.users)).catch(() => setDirectory([]));
  }, []);
  return directory;
}

interface AnnotationPanelProps {
  target: { platform: string; id: string } | null;
  // Mes annotations sur ce post, de la plus récente à la plus ancienne.
  mine: StoredAnnotation[];
  onMineChange: MineUpdater;
  directory: UserProfile[];
  notify: (message: string) => void;
  headerAction?: React.ReactNode;
}

const AnnotationPanel: React.FC<AnnotationPanelProps> = ({ target, mine, onMineChange, directory, notify, headerAction }) => {
  const { user } = useAuth();
  const noun = target?.platform === 'bluesky' ? 'post' : 'tweet';
  // Formulaire : nouvelle annotation, ou modification de l'annotation editingId.
  const [form, setForm] = useState<Annotation>(defaultAnnotation());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formTopRef = useRef<HTMLDivElement | null>(null);
  const draftKeyRef = useRef<string | null>(null);
  // Brouillons non enregistrés, par post : changer de post ne perd pas la saisie.
  const draftsRef = useRef(new Map<string, Annotation>());
  const formRef = useRef(form);
  formRef.current = form;
  const editingRef = useRef(editingId);
  editingRef.current = editingId;

  // Pour le post courant : annotations des autres qui me sont visibles.
  const [postAnnotations, setPostAnnotations] = useState<PostAnnotations | null>(null);
  const [mineOpen, setMineOpen] = useState(true);
  const [sharedOpen, setSharedOpen] = useState(true);

  // Partage d'une de mes annotations (celle dont l'identifiant est postShareOpen) avec des personnes choisies.
  const [postShareOpen, setPostShareOpen] = useState<string | null>(null);
  const [postShareDraft, setPostShareDraft] = useState<Set<string>>(() => new Set());
  const [postShareSaving, setPostShareSaving] = useState(false);
  const [postShareNotesDraft, setPostShareNotesDraft] = useState(true);
  const nameOf = (id: string) => directory.find((item) => item.id === id)?.name || 'compte inconnu';

  const refreshPostAnnotations = useCallback((platform: string, postId: string) => {
    api.getPostAnnotations(platform, postId)
      .then((result) => { if (draftKeyRef.current === annotationKey(platform, postId)) setPostAnnotations(result); })
      .catch(() => { if (draftKeyRef.current === annotationKey(platform, postId)) setPostAnnotations(null); });
  }, []);

  // Changement de post : le brouillon en cours est mis de côté, celui du nouveau post est repris.
  useEffect(() => {
    const previous = draftKeyRef.current;
    if (previous && !editingRef.current && !isEmptyDraft(formRef.current)) draftsRef.current.set(previous, formRef.current);
    else if (previous && !editingRef.current) draftsRef.current.delete(previous);
    setEditingId(null);
    setPostAnnotations(null);
    setPostShareOpen(null);
    if (!target) { draftKeyRef.current = null; setForm(defaultAnnotation()); return undefined; }
    const key = annotationKey(target.platform, target.id);
    draftKeyRef.current = key;
    setForm(draftsRef.current.get(key) || defaultAnnotation());
    const timer = window.setTimeout(() => refreshPostAnnotations(target.platform, target.id), 250);
    return () => window.clearTimeout(timer);
  }, [target?.platform, target?.id, refreshPostAnnotations]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateForm = (patch: Partial<Annotation>) => setForm((value) => ({ ...value, ...patch }));

  const resetForm = () => {
    setForm(defaultAnnotation());
    setEditingId(null);
    if (draftKeyRef.current) draftsRef.current.delete(draftKeyRef.current);
  };

  // « Ajouter l'annotation » (ou enregistrer la modification) : l'annotation rejoint la liste, le formulaire est vidé.
  const submitAnnotation = async () => {
    if (!target || saving) return;
    const { platform, id } = target;
    const key = annotationKey(platform, id);
    if (!editingId && isEmptyDraft(form)) { notify('Remplissez au moins un champ avant d’ajouter l’annotation'); return; }
    setSaving(true);
    try {
      if (editingId) {
        const { annotation } = await api.updateAnnotation(editingId, fieldsOf(form));
        onMineChange(key, (list) => list.map((item) => (item.id === annotation.id ? annotation : item)));
        notify('Annotation modifiée');
      } else {
        const { annotation } = await api.createAnnotation(platform, id, fieldsOf(form));
        onMineChange(key, (list) => [annotation, ...list]);
        notify('Annotation ajoutée');
      }
      resetForm();
    } catch (error: any) {
      notify(`Annotation non enregistrée : ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: StoredAnnotation) => {
    setEditingId(item.id);
    setForm(fromServer(item));
    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const removeAnnotation = (item: StoredAnnotation) => {
    if (!window.confirm('Supprimer cette annotation ?')) return;
    const key = annotationKey(item.platform, item.post_id);
    api.deleteAnnotation(item.id)
      .then(() => {
        onMineChange(key, (list) => list.filter((entry) => entry.id !== item.id));
        if (editingId === item.id) resetForm();
        notify('Annotation supprimée');
      })
      .catch((error) => notify(`Suppression impossible : ${error.message || error}`));
  };

  const openPostShare = (item: StoredAnnotation) => {
    setPostShareDraft(new Set(item.shared_with || []));
    setPostShareNotesDraft(item.share_notes !== false);
    setPostShareOpen(item.id);
  };

  const savePostShare = async (item: StoredAnnotation) => {
    setPostShareSaving(true);
    try {
      const { annotation } = await api.shareAnnotation(item.id, Array.from(postShareDraft), postShareNotesDraft);
      onMineChange(annotationKey(item.platform, item.post_id), (list) => list.map((entry) => (entry.id === annotation.id ? annotation : entry)));
      setPostShareOpen(null);
      notify(postShareDraft.size ? `Annotation partagée avec ${postShareDraft.size} personne(s)${postShareNotesDraft ? '' : ', sans le commentaire libre'}` : 'Partage de cette annotation retiré');
    } catch (error: any) {
      notify(error.message || String(error));
    } finally {
      setPostShareSaving(false);
    }
  };

  return (
    <>
      <div className="explorer-annotation-head">
        <div>
          <h2>{editingId ? 'Modifier mon annotation' : 'Nouvelle annotation'}</h2>
          <div className="explorer-annotation-sub">Enregistrée sur le serveur sous votre compte ({user.username}). Un post peut recevoir plusieurs annotations.</div>
        </div>
        {headerAction && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{headerAction}</div>}
      </div>
      <div ref={formTopRef} />
      <form className={`explorer-form ${editingId ? 'editing' : ''}`} onSubmit={(event) => { event.preventDefault(); submitAnnotation(); }}>
        <fieldset disabled={!target} style={{ border: 0, display: 'grid', gap: 11 }}>
          <div className="explorer-form-row">
            <label className="explorer-field">Statut
              <select value={form.status} onChange={(event) => updateForm({ status: event.target.value as Annotation['status'] })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="explorer-field">Pertinence
              <select value={form.relevance} onChange={(event) => updateForm({ relevance: event.target.value as Annotation['relevance'] })}>
                <option value="">Non renseignée</option>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
                <option value="incertain">Incertaine</option>
              </select>
            </label>
          </div>
          <label className="explorer-field">Thème principal
            <input list="explorer-theme-suggestions" value={form.theme} onChange={(event) => updateForm({ theme: event.target.value })} placeholder="Ex. arbitrage, supporters, billetterie…" />
            <datalist id="explorer-theme-suggestions">{THEME_SUGGESTIONS.map((theme) => <option key={theme} value={theme} />)}</datalist>
          </label>
          <div className="explorer-form-row">
            <label className="explorer-field">Tonalité
              <select value={form.tone} onChange={(event) => updateForm({ tone: event.target.value })}>
                <option value="">Non renseignée</option>
                <option value="positive">Positive</option>
                <option value="negative">Négative</option>
                <option value="neutre">Neutre</option>
                <option value="mixte">Mixte</option>
                <option value="ironique">Ironique / humoristique</option>
                <option value="incertaine">Incertaine</option>
              </select>
            </label>
            <label className="explorer-field">Interaction
              <select value={form.interaction} onChange={(event) => updateForm({ interaction: event.target.value })}>
                <option value="">Non renseignée</option>
                <option value="publication">Publication initiale</option>
                <option value="reponse">Réponse</option>
                <option value="citation">Citation</option>
                <option value="relais">Relais / republication</option>
                <option value="autre">Autre</option>
              </select>
            </label>
          </div>
          <label className="explorer-field">Mots-clés
            <input value={form.keywords} onChange={(event) => updateForm({ keywords: event.target.value })} placeholder="Séparés par des virgules" />
          </label>
          <label className="explorer-field">Commentaire libre
            <textarea value={form.note} onChange={(event) => updateForm({ note: event.target.value })} placeholder="Observation, interprétation ou point à discuter…" />
          </label>
          <div className="explorer-save-row">
            <button type="submit" className="explorer-btn primary" disabled={saving}>
              {saving ? 'Enregistrement…' : editingId ? 'Enregistrer les modifications' : 'Ajouter l’annotation'}
            </button>
            <button type="button" className="explorer-btn" onClick={resetForm}>{editingId ? 'Annuler' : 'Vider le formulaire'}</button>
          </div>
        </fieldset>
      </form>

      {target && (
          <section className="explorer-section">
            <button type="button" className="explorer-section-toggle" aria-expanded={mineOpen} onClick={() => setMineOpen((open) => !open)}>
              {mineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <PencilLine size={13} /> Mes annotations sur ce {noun} ({mine.length})
            </button>
            {mineOpen && (
              <div className="explorer-section-body">
                {!mine.length && <div className="explorer-section-empty">Aucune annotation pour l’instant. Remplissez le formulaire puis « Ajouter l’annotation ».</div>}
                {mine.map((item) => {
                  const recipients = item.shared_with || [];
                  return (
                    <AnnotationSummary
                      key={item.id}
                      item={item}
                      highlighted={item.id === editingId}
                      title={item.id === editingId ? 'En cours de modification' : 'Mon annotation'}
                      action={(
                        <>
                          <div className="explorer-annotation-card-share">
                            <Share2 size={12} /> {recipients.length ? `Partagée avec ${recipients.map(nameOf).join(', ')}${item.share_notes === false ? ' (sans le commentaire libre)' : ''}` : 'Non partagée individuellement'}
                          </div>
                          <div className="explorer-annotation-card-actions">
                            <button type="button" className="explorer-btn" onClick={() => startEdit(item)}>Modifier</button>
                            <button type="button" className="explorer-btn" onClick={() => (postShareOpen === item.id ? setPostShareOpen(null) : openPostShare(item))}>
                              {postShareOpen === item.id ? 'Annuler le partage' : 'Partager'}
                            </button>
                            <button type="button" className="explorer-btn danger" onClick={() => removeAnnotation(item)}>Supprimer</button>
                          </div>
                          {postShareOpen === item.id && (
                            <div className="explorer-post-share-body">
                              <div className="explorer-share-list compact">
                                {directory.filter((person) => person.id !== user.id).map((person) => (
                                  <label key={person.id} className="explorer-share-row">
                                    <input
                                      type="checkbox"
                                      checked={postShareDraft.has(person.id)}
                                      onChange={() => setPostShareDraft((draft) => {
                                        const next = new Set(draft);
                                        if (next.has(person.id)) next.delete(person.id); else next.add(person.id);
                                        return next;
                                      })}
                                    />
                                    <span><strong>{person.name}</strong> <span className="explorer-share-username">{person.username}</span></span>
                                  </label>
                                ))}
                              </div>
                              <label className="explorer-share-notes">
                                <input type="checkbox" checked={postShareNotesDraft} onChange={(event) => setPostShareNotesDraft(event.target.checked)} />
                                Inclure mon commentaire libre
                              </label>
                              <button type="button" className="explorer-btn primary" disabled={postShareSaving} onClick={() => savePostShare(item)}>{postShareSaving ? 'Enregistrement…' : 'Enregistrer le partage'}</button>
                            </div>
                          )}
                        </>
                      )}
                    />
                  );
                })}
              </div>
            )}
          </section>
      )}

      {target && (
        <section className="explorer-section">
          <button type="button" className="explorer-section-toggle" aria-expanded={sharedOpen} onClick={() => setSharedOpen((open) => !open)}>
            {sharedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Users size={13} /> {user.role === 'admin' ? 'Annotations de l’équipe' : 'Partagées avec moi'} ({postAnnotations?.shared.length ?? '…'})
          </button>
          {sharedOpen && (
            <div className="explorer-section-body">
              {!postAnnotations && <div className="explorer-section-empty">Chargement…</div>}
              {postAnnotations && !postAnnotations.shared.length && (
                <div className="explorer-section-empty">
                  {user.role === 'admin' ? 'Personne d’autre n’a annoté ce post.' : 'Aucune annotation de ce post n’est partagée avec vous.'}
                </div>
              )}
              {postAnnotations?.shared.map((item) => (
                <AnnotationSummary key={item.id} item={item} title={item.name || item.username} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default AnnotationPanel;
