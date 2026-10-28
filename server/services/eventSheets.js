const { EVENT_SHEET_SEEDS } = require('../data/eventSheets');

// Fiches des événements de collecte (matchs) : informations, méthodologie et déroulé (moments datés).
// Les fiches pré-remplies (data/eventSheets.js) servent de valeurs par défaut ; une fiche enregistrée
// depuis le dashboard les remplace entièrement.

const MOMENT_KINDS = ['kickoff', 'goal', 'penalty', 'yellow_card', 'red_card', 'substitution', 'var', 'halftime', 'second_half', 'extra_time', 'shootout', 'end', 'other'];
const TEXT_LIMITS = { title: 200, stage: 120, venue: 200, score: 60, summary: 5000, keywords: 3000, collections: 3000, notes: 5000 };
const MAX_MOMENTS = 300;
const EVENT_ID = /^[a-z0-9_.-]{1,80}$/i;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isoOrNull = (value) => {
  const time = typeof value === 'string' && value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

// Ne garde que les champs connus, avec des valeurs valides ; les moments sont triés par heure.
function cleanSheet(input = {}) {
  const sheet = {};
  Object.entries(TEXT_LIMITS).forEach(([field, max]) => { sheet[field] = text(input[field], max); });
  sheet.teams = (Array.isArray(input.teams) ? input.teams : []).map((team) => text(team, 80)).filter(Boolean).slice(0, 2);
  sheet.kickoff_at = isoOrNull(input.kickoff_at);
  sheet.moments = (Array.isArray(input.moments) ? input.moments : [])
    .map((moment) => ({
      time: isoOrNull(moment?.time),
      kind: MOMENT_KINDS.includes(moment?.kind) ? moment.kind : 'other',
      minute: text(moment?.minute, 12),
      team: text(moment?.team, 80),
      label: text(moment?.label, 300),
    }))
    .filter((moment) => moment.time)
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(0, MAX_MOMENTS);
  return sheet;
}

const withDefaults = (event, sheet) => ({ ...cleanSheet(sheet), event, source: sheet.source || '' });

// Stockage : collection event_sheets (MongoDB) ou mémoire (mode archive, tests).
function createSheetStore(getDb) {
  const memory = new Map();
  const collection = () => getDb()?.collection('event_sheets') || null;
  return {
    async list() {
      const sheets = collection();
      return sheets ? sheets.find({}).toArray() : Array.from(memory.values());
    },
    async save(event, sheet) {
      const sheets = collection();
      const doc = { _id: event, ...sheet };
      if (sheets) await sheets.replaceOne({ _id: event }, doc, { upsert: true });
      else memory.set(event, doc);
      return doc;
    },
    async remove(event) {
      const sheets = collection();
      if (sheets) await sheets.deleteOne({ _id: event });
      else memory.delete(event);
    },
  };
}

// Toutes les fiches : celles enregistrées, et les fiches pré-remplies pour les autres événements.
async function listSheets(store) {
  const saved = new Map((await store.list()).map((doc) => [String(doc._id), doc]));
  const events = new Set([...Object.keys(EVENT_SHEET_SEEDS), ...saved.keys()]);
  return Array.from(events).sort().map((event) => {
    const doc = saved.get(event);
    if (doc) return { ...withDefaults(event, doc), source: 'Modifiée dans le dashboard', updated_at: doc.updated_at || null, updated_by: doc.updated_by || null, customized: true };
    return { ...withDefaults(event, EVENT_SHEET_SEEDS[event]), customized: false };
  });
}

module.exports = { EVENT_ID, MOMENT_KINDS, cleanSheet, createSheetStore, listSheets };
