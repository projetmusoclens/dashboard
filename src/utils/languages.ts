import { LANG_LABELS } from '../data/dashboardData';

// Codes sans langue identifiable : valeurs absentes et codes spéciaux de X (qme = médias seuls, etc.).
const SPECIAL_CODES: Record<string, string> = {
  '': 'Non renseignée',
  unknown: 'Non renseignée',
  null: 'Non renseignée',
  und: 'Indéterminée',
  zxx: 'Sans contenu linguistique',
  art: 'Langue artificielle',
  qme: 'Médias uniquement',
  qht: 'Hashtags uniquement',
  qam: 'Mentions uniquement',
  qct: 'Cashtags uniquement',
  qst: 'Texte très court',
};

// Anciens codes encore renvoyés par certaines API.
const CODE_ALIASES: Record<string, string> = { in: 'id', iw: 'he', ji: 'yi', jp: 'ja' };

let displayNames: { of: (code: string) => string | undefined } | null = null;
try {
  displayNames = new (Intl as any).DisplayNames(['fr'], { type: 'language' });
} catch {
  displayNames = null;
}

export function baseLangCode(code: string | null | undefined): string {
  const lower = String(code ?? '').trim().toLowerCase();
  const base = lower.split(/[-_]/)[0];
  return CODE_ALIASES[base] || base;
}

function knownLanguageName(base: string): string | null {
  if (LANG_LABELS[base]) return LANG_LABELS[base];
  if (!displayNames || !/^[a-z]{2,3}$/.test(base)) return null;
  try {
    const name = displayNames.of(base);
    if (!name || name.toLowerCase() === base) return null;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return null;
  }
}

export function isUnclearLang(code: string | null | undefined): boolean {
  const base = baseLangCode(code);
  return base in SPECIAL_CODES || /^q[a-z]{2}$/.test(base) || !knownLanguageName(base);
}

export function langLabel(code: string | null | undefined): string {
  const raw = String(code ?? '').trim();
  const base = baseLangCode(raw);
  if (base in SPECIAL_CODES) return raw && raw !== 'unknown' ? `${SPECIAL_CODES[base]} (${raw})` : SPECIAL_CODES[base];
  const name = knownLanguageName(base);
  if (!name) return raw ? `Code non identifié (${raw})` : 'Non renseignée';
  return raw.toLowerCase() !== base ? `${name} (${raw})` : name;
}

export interface LanguageSlice {
  key: string;
  name: string;
  value: number;
  details?: { code: string; label: string; value: number }[];
}

// Regroupe les variantes régionales (en-US → en) et place les codes non identifiés et les
// langues marginales dans « Autres », dont le détail reste disponible au survol.
export function groupLanguages(byLang: Record<string, number>, { minShare = 0.01, maxSlices = 9 } = {}): LanguageSlice[] {
  const total = Object.values(byLang).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (!total) return [];
  const merged = new Map<string, { value: number; codes: { code: string; value: number }[] }>();
  const others: { code: string; label: string; value: number }[] = [];

  Object.entries(byLang).forEach(([code, rawValue]) => {
    const value = Number(rawValue) || 0;
    if (!value) return;
    if (isUnclearLang(code)) {
      others.push({ code, label: langLabel(code), value });
      return;
    }
    const base = baseLangCode(code);
    const item = merged.get(base) || { value: 0, codes: [] };
    item.value += value;
    item.codes.push({ code, value });
    merged.set(base, item);
  });

  const ranked = Array.from(merged.entries()).sort((left, right) => right[1].value - left[1].value);
  const slices: LanguageSlice[] = [];
  ranked.forEach(([base, item]) => {
    if (slices.length < maxSlices && item.value / total >= minShare) {
      slices.push({ key: base, name: knownLanguageName(base) || base, value: item.value });
    } else {
      item.codes.forEach(({ code, value }) => others.push({ code, label: langLabel(code), value }));
    }
  });
  if (others.length) {
    others.sort((left, right) => right.value - left.value);
    slices.push({ key: '__others__', name: 'Autres', value: others.reduce((sum, item) => sum + item.value, 0), details: others });
  }
  return slices;
}
