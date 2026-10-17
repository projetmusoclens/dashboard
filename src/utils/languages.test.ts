import { groupLanguages, isUnclearLang, langLabel } from './languages';

test('labels known, regional and special language codes', () => {
  expect(langLabel('fr')).toBe('Français');
  expect(langLabel('en-US')).toBe('Anglais (en-US)');
  expect(langLabel('qme')).toBe('Médias uniquement (qme)');
  expect(langLabel('unknown')).toBe('Non renseignée');
  expect(isUnclearLang('und')).toBe(true);
  expect(isUnclearLang('nl')).toBe(false);
});

test('groups unclear codes and minor languages into Autres with details', () => {
  const slices = groupLanguages({ en: 500, 'en-US': 20, fr: 300, qme: 50, und: 10, unknown: 30, it: 2 });
  expect(slices.map((slice) => slice.name)).toEqual(['Anglais', 'Français', 'Autres']);
  expect(slices[0].value).toBe(520);
  const others = slices[2];
  expect(others.value).toBe(92);
  expect(others.details?.map((item) => item.code)).toEqual(['qme', 'unknown', 'und', 'it']);
});
