import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { TabId } from '../types';

interface GuidedTourProps {
  open: boolean;
  onNavigate: (tab: TabId) => void;
  onClose: () => void;
}

const STEPS: { tab: TabId; title: string; description: string }[] = [
  {
    tab: 'overview',
    title: 'Vue globale',
    description: 'Commencez par les indicateurs et les tendances pour situer le volume, les langues et les plateformes des publications.',
  },
  {
    tab: 'posts',
    title: 'Explorer les publications',
    description: 'Recherchez dans le texte ou les auteurs, triez par engagement et consultez les médias. Sélectionner un post ouvre son thread.',
  },
  {
    tab: 'threads',
    title: 'Suivre les conversations',
    description: 'Cette vue rassemble un post parent et ses réponses. Depuis l’explorateur, sélectionnez une publication pour afficher sa conversation.',
  },
  {
    tab: 'graphs',
    title: 'Lire les graphes',
    description: 'Passez des hashtags aux mentions. La taille des nœuds représente leur fréquence et l’épaisseur des liens le nombre de relations observées.',
  },
  {
    tab: 'overview',
    title: 'Filtrer les données',
    description: 'Les filtres de collecte, plateforme, langue et dates en haut de page s’appliquent à l’ensemble des vues. Revenez à « Vue globale » pour les modifier.',
  },
];

const GuidedTour: React.FC<GuidedTourProps> = ({ open, onNavigate, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  useEffect(() => {
    if (open) onNavigate(step.tab);
  }, [open, onNavigate, step.tab]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const finish = () => {
    setStepIndex(0);
    onClose();
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) finish();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 18, background: 'rgba(10, 18, 26, 0.58)' }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ width: 'min(100%, 460px)', background: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 10, padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,0.28)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Prise en main · {stepIndex + 1}/{STEPS.length}</div>
            <h2 id="tour-title" style={{ fontSize: 20, margin: 0 }}>{step.title}</h2>
          </div>
          <button type="button" aria-label="Fermer le tour" onClick={finish} style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}>
            <X size={17} />
          </button>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.65, margin: '16px 0 22px' }}>{step.description}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button type="button" onClick={finish} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', padding: '9px 0', cursor: 'pointer' }}>Quitter</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStepIndex((index) => Math.max(0, index - 1))} disabled={stepIndex === 0} aria-label="Étape précédente" style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', background: 'var(--card-bg)', cursor: stepIndex === 0 ? 'not-allowed' : 'pointer', opacity: stepIndex === 0 ? 0.45 : 1 }}>
              <ArrowLeft size={17} />
            </button>
            <button type="button" onClick={() => stepIndex === STEPS.length - 1 ? finish() : setStepIndex((index) => index + 1)} aria-label={stepIndex === STEPS.length - 1 ? 'Terminer le tour' : 'Étape suivante'} style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, border: 0, borderRadius: 6, color: '#fff', background: 'var(--accent)', cursor: 'pointer' }}>
              {stepIndex === STEPS.length - 1 ? <X size={17} /> : <ArrowRight size={17} />}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default GuidedTour;