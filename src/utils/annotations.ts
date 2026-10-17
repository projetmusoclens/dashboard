// Annotations de l'Explorer, stockées dans le navigateur (localStorage), par plateforme et identifiant de post.
export interface Annotation {
  status: 'a_analyser' | 'analyse' | 'a_discuter';
  relevance: '' | 'oui' | 'non' | 'incertain';
  theme: string;
  tone: string;
  interaction: string;
  keywords: string;
  note: string;
  updatedAt: string;
}

const STORAGE_KEY = 'heimdall-explorer-annotations:v1';

export const STATUS_LABELS: Record<Annotation['status'], string> = {
  a_analyser: 'À analyser',
  analyse: 'Analysé',
  a_discuter: 'À discuter',
};

export const RELEVANCE_LABELS: Record<string, string> = { oui: 'Pertinent', non: 'Non pertinent', incertain: 'Incertain' };

export const defaultAnnotation = (): Annotation => ({ status: 'a_analyser', relevance: '', theme: '', tone: '', interaction: '', keywords: '', note: '', updatedAt: '' });

export const annotationKey = (platform: string, postId: string) => `${platform}:${postId}`;

export function loadAnnotations(): Record<string, Annotation> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAnnotations(annotations: Record<string, Annotation>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
    return true;
  } catch {
    return false;
  }
}
