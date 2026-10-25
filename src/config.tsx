import React from 'react';
import { BarChart2, GitBranch, MessageSquare, Share2, Users } from 'lucide-react';
import { TabId } from './types';

export const APP_TITLE = 'Dashboard World Cup 2026';
export const APP_SUBTITLE = 'Publications X et Bluesky';

export const TABS: { id: TabId; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { id: 'overview', label: 'Vue globale', icon: <BarChart2 size={15} /> },
  { id: 'posts', label: 'Explorer', icon: <MessageSquare size={15} /> },
  { id: 'threads', label: 'Threads', icon: <GitBranch size={15} /> },
  { id: 'graphs', label: 'Graphes', icon: <Share2 size={15} /> },
  { id: 'users', label: 'Utilisateurs', icon: <Users size={15} />, adminOnly: true },
];

// Graphes : nœuds affichés par défaut et plafond (aligné sur GRAPH_MAX_NODES côté serveur).
export const GRAPH_DEFAULT_NODES = 300;
export const GRAPH_MAX_NODES = 20000;
// Au-delà, l'affichage et les dispositions ralentissent nettement : l'onglet Graphes prévient.
export const GRAPH_WARN_NODES = 5000;
