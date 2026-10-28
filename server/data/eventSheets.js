// Fiches des événements de collecte, pré-remplies à partir du document de contexte des collectes
// (CONTEXTE_fusion_collectes_coupe_du_monde.md, 24/10/2026) pour la méthodologie, et de comptes rendus
// en ligne (consultés le 28/10/2026) pour le lieu, le score et le déroulé (MATCH_REPORTS, plus bas).
// Les heures sont en UTC. Une fiche enregistrée depuis le dashboard remplace ces valeurs.

const GENERIC = 'Les mots-clés génériques (worldcup2026, wc2026, fifaworldcup) varient d’un match à l’autre : un même tweet a pu être collecté sous plusieurs événements proches, et n’est gardé qu’une fois, sous le premier.';

const EVENT_SHEET_SEEDS = {
  mexico_opening: {
    title: 'Cérémonie d’ouverture · Mexique – Afrique du Sud',
    teams: ['Mexique', 'Afrique du Sud'],
    stage: 'Match d’ouverture',
    venue: 'Estadio Azteca, Mexico',
    kickoff_at: null,
    summary: 'Fenêtre de collecte du 11/06, 15:30-23:30 UTC.',
    keywords: 'worldcup2026, fifaworldcup, opening ceremony, ceremonie ouverture, ceremonia apertura, azteca, mexico2026, mexrsa, mexico south africa, afrique du sud (backfill Bluesky : coupe du monde, copa del mundo à la place de mexrsa et des suivants)',
    collections: 'Live : twitter_live (polling 10 s), bluesky_live (avant le 06/07). Backfills : twitter_backfill, bluesky_backfill.',
    notes: 'Collecte dans une autre base de quartz, pas encore exportée vers le dashboard.',
  },
  france_paraguay: {
    title: 'France – Paraguay',
    teams: ['France', 'Paraguay'],
    stage: 'Huitième de finale',
    kickoff_at: null,
    summary: 'Match du 04/07 (heure du coup d’envoi non renseignée).',
    keywords: 'FRAPAR, france paraguay, francia paraguay, allezlesbleus, vamosparaguay, albirroja, lesbleus, worldcup2026, fifaworldcup',
    collections: 'Live : twitter_frapar_live. Pas de backfill.',
    notes: GENERIC,
  },
  fra_mar_qf: {
    title: 'France – Maroc',
    teams: ['France', 'Maroc'],
    stage: 'Quart de finale 1',
    kickoff_at: '2026-07-09T20:00:00Z',
    keywords: 'framar, marfra, « francemaroc » (bug), dimamaghrib, allezlesbleus, lesbleus, lions de l’atlas, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_framar_qf. Backfills : twitter_framar_bf_w1, w2, w3.',
    notes: `Virgule manquante dans la requête : "france" "maroc" a donné « francemaroc ». La collecte ne contient ni « france » ni « maroc » seuls, ce qui la biaise par rapport aux autres matchs. ${GENERIC}`,
  },
  esp_bel_qf: {
    title: 'Espagne – Belgique',
    teams: ['Espagne', 'Belgique'],
    stage: 'Quart de finale 2',
    kickoff_at: '2026-07-10T19:00:00Z',
    keywords: 'espbel, belesp, spain, belgium, españa, bélgica, espagne, belgique, vamosespaña, laroja, diables rouges, diablesrouges, rode duivels, rodeduivels',
    collections: 'Live : twitter_espbel_qf. Backfills : twitter_espbel_bf_w1, w2, w3.',
    notes: 'Seul match sans les mots-clés génériques worldcup2026, wc2026 et fifaworldcup.',
  },
  nor_eng_qf: {
    title: 'Norvège – Angleterre',
    teams: ['Norvège', 'Angleterre'],
    stage: 'Quart de finale 3',
    kickoff_at: '2026-07-11T21:00:00Z',
    keywords: 'noreng, engnor, « norwayengland » (bug), norge england, three lions, threelions, itscominghome, heia norge, heianorge, landslaget, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_noreng_qf. Backfills : twitter_noreng_bf_w1, w2.',
    notes: `Virgule manquante dans la requête : "norway" "england" a donné « norwayengland » ; « norway » n’a jamais été cherché seul. ${GENERIC}`,
  },
  arg_sui_qf: {
    title: 'Argentine – Suisse',
    teams: ['Argentine', 'Suisse'],
    stage: 'Quart de finale 4',
    kickoff_at: '2026-07-12T01:00:00Z',
    keywords: 'argsui, suiarg, argentina (en double), suiza, switzerland, vamosargentina, albiceleste, laalbiceleste, hoppschwiiz, hopp schwiiz, la nati, allez la suisse, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_argsui_qf. Backfills : twitter_argsui_bf_p1 … p9.',
    notes: GENERIC,
  },
  fra_esp_df: {
    title: 'France – Espagne',
    teams: ['France', 'Espagne'],
    stage: 'Demi-finale 1',
    kickoff_at: '2026-07-14T19:00:00Z',
    keywords: 'fraesp, espfra, france espagne, francia españa, france spain, franceespagne, franciaespaña, allezlesbleus, lesbleus, equipe de france, vamosespaña, la roja, laroja, france, spain, españa, espagne, francia, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_fraesp_df. Backfills : twitter_fraesp_bf_w1 … w7.',
    notes: GENERIC,
  },
  eng_arg_df: {
    title: 'Angleterre – Argentine',
    teams: ['Angleterre', 'Argentine'],
    stage: 'Demi-finale 2',
    kickoff_at: '2026-07-15T19:00:00Z',
    keywords: 'engarg, argeng, england argentina, inglaterra argentina, three lions, threelions, itscominghome, vamosargentina, albiceleste, laalbiceleste, la scaloneta, scaloneta, england, argentina, inglaterra, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_engarg_df. Backfills phase 1 : twitter_engarg_bf_w5, w6, w7 ; phase 2 : twitter_engarg_bf_p1 … p8 (peut-être incomplète faute de crédits).',
    notes: 'Heure du coup d’envoi (~19:00 UTC) à vérifier. Des backfills de ce match ont pu être enregistrés sous l’événement fra_eng_pf (erreur corrigée ensuite dans le compose). Le commentaire du compose indique par erreur « DF1 France-Espagne 14/07 ».',
  },
  fra_eng_pf: {
    title: 'France – Angleterre',
    teams: ['France', 'Angleterre'],
    stage: 'Match pour la 3e place',
    kickoff_at: '2026-07-18T21:00:00Z',
    keywords: 'fraeng, engfra, france england, france angleterre, franceengland, franceangleterre, allezlesbleus, lesbleus, equipe de france, three lions, threelions, france, england, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_fraeng_pf. Backfills : twitter_fraeng_bf_w1, w2, w3.',
    notes: 'Peut contenir des backfills d’Angleterre – Argentine mal étiquetés (collectes twitter_engarg_bf_* ou tweets du 15/07).',
  },
  esp_arg_finale: {
    title: 'Espagne – Argentine',
    teams: ['Espagne', 'Argentine'],
    stage: 'Finale',
    kickoff_at: '2026-07-19T19:00:00Z',
    keywords: 'esparg, argesp, españa argentina, spain argentina, espagne argentine, españaargentina, vamosespaña, la roja, laroja, vamosargentina, albiceleste, laalbiceleste, la scaloneta, scaloneta, worldcupfinal, wcfinal, spain, españa, argentina, worldcup2026, wc2026, fifaworldcup',
    collections: 'Live : twitter_esparg_finale. Backfills : twitter_esparg_bf_w01 … w14, twitter_esparg_it_01, it_02.',
    notes: GENERIC,
  },
  twitter_test_cron_live: {
    title: 'Test de collecte automatique',
    teams: [],
    stage: 'Test',
    kickoff_at: null,
    keywords: 'Mêmes mots-clés que France – Maroc (dont le bug « francemaroc »).',
    collections: 'twitter_test_cron_live',
    notes: 'Test du déclenchement automatique de la collecte : probablement pas un corpus d’analyse.',
  },
  firehose: {
    title: 'Flux Bluesky complet',
    teams: [],
    stage: 'Flux continu',
    kickoff_at: null,
    summary: 'Flux complet de Bluesky (firehose) à partir du 06/07 à 11:56.',
    collections: 'bluesky_live',
    notes: 'Les dates des posts Bluesky sont déclarées par les applications et non vérifiées : bornez les analyses dans le temps.',
  },
};

// Heure approchée d'un moment d'après la minute de jeu (« 45+1 », « 93 », « 120+1 ») : coup d'envoi
// + minute, avec 15 min de mi-temps, ~5 min d'arrêts de jeu et 5 min de pause avant la prolongation,
// 2 min de pause entre ses deux périodes. Ces heures sont indicatives : à recaler sur la courbe.
function minuteTime(kickoffAt, minute) {
  const [base, extra = 0] = String(minute).split('+').map(Number);
  let offset;
  if (base <= 45) offset = base + extra;
  else if (base <= 90) offset = 15 + base + extra;
  else if (base <= 105) offset = 115 + (base - 90) + extra;
  else offset = 132 + (base - 105) + extra;
  return new Date(Date.parse(kickoffAt) + offset * 60000).toISOString();
}

const UNVERIFIED = 'Déroulé pré-rempli à partir de comptes rendus en ligne (consultés le 28/10/2026) : scores, buteurs et minutes à vérifier ; les heures des moments sont calculées depuis la minute de jeu et donc approximatives.';

// Lieu, score et déroulé de chaque match : [minute, type, équipe, description].
// start : heure réelle du coup d'envoi quand elle diffère de l'heure prévue (kickoff_at).
const MATCH_REPORTS = {
  mexico_opening: {
    venue: 'Estadio Azteca, Mexico',
    score: 'Mexique 2-0 Afrique du Sud',
    summary: 'Buts de Julián Quiñones (9e) et Raúl Jiménez (67e, de la tête sur un centre de Roberto Alvarado). Trois expulsions : Sphephelo Sithole et Themba Zwane (Afrique du Sud), César Montes (Mexique, dans le temps additionnel). Heure du coup d’envoi non confirmée : déroulé non placé sur la courbe.',
    events: [],
    sources: 'Gulf News, ESPN (rapport de match 760415), Onmanorama.',
  },
  france_paraguay: {
    kickoff_at: '2026-07-04T21:00:00Z',
    venue: 'Lincoln Financial Field, Philadelphie',
    score: 'Paraguay 0-1 France',
    events: [['45', 'halftime', '', 'Mi-temps (0-0)'], ['70', 'goal', 'France', 'Kylian Mbappé (penalty)'], ['90+5', 'end', '', 'Fin du match (0-1)']],
    sources: 'Wikipédia (en), « 2026 FIFA World Cup knockout stage » : coup d’envoi 17:00 UTC−4.',
  },
  fra_mar_qf: {
    venue: 'Gillette Stadium, Foxborough',
    score: 'France 2-0 Maroc',
    events: [['45', 'halftime', '', 'Mi-temps (0-0)'], ['60', 'goal', 'France', 'Kylian Mbappé'], ['66', 'goal', 'France', 'Ousmane Dembélé (passe de Mbappé)'], ['77', 'substitution', 'France', 'Mbappé sort sur blessure (précaution)'], ['90+4', 'end', '', 'Fin du match (2-0)']],
    sources: 'NBC (France vs Morocco), blog Wego.',
  },
  esp_bel_qf: {
    venue: 'SoFi Stadium, Inglewood',
    score: 'Espagne 2-1 Belgique',
    events: [['30', 'goal', 'Espagne', 'Fabián Ruiz'], ['41', 'goal', 'Belgique', 'Charles De Ketelaere'], ['45', 'halftime', '', 'Mi-temps (1-1)'], ['71', 'substitution', 'Belgique', 'Courtois blessé, remplacé par Senne Lammens'], ['86', 'substitution', 'Espagne', 'Entrée de Mikel Merino'], ['88', 'goal', 'Espagne', 'Mikel Merino (sur un rebond)'], ['90+5', 'end', '', 'Fin du match (2-1)']],
    sources: 'ESPN, NPR, theScore, IOL.',
  },
  nor_eng_qf: {
    venue: 'Hard Rock Stadium, Miami Gardens',
    score: 'Norvège 1-2 Angleterre',
    summary: 'Les sources divergent sur le but de la victoire de Jude Bellingham : 93e minute en prolongation selon certaines, 90+3 (temps additionnel) selon d’autres. À vérifier.',
    events: [['36', 'goal', 'Norvège', 'Andreas Schjelderup'], ['45+2', 'goal', 'Angleterre', 'Jude Bellingham'], ['45+3', 'halftime', '', 'Mi-temps (1-1)'], ['93', 'goal', 'Angleterre', 'Jude Bellingham (sur un ballon relâché par Nyland après une frappe de Morgan Rogers) — minute à vérifier']],
    sources: 'worldcupranking.com, blog Wego, FBC News, Vavel.',
  },
  arg_sui_qf: {
    venue: 'Arrowhead Stadium, Kansas City',
    score: 'Argentine 3-1 Suisse (a.p.)',
    summary: 'Victoire après prolongation. Les sources divergent sur l’expulsion suisse (Dan Ndoye à la 67e, ou Breel Embolo) : à vérifier.',
    events: [['10', 'goal', 'Argentine', 'Alexis Mac Allister'], ['45', 'halftime', '', 'Mi-temps (1-0)'], ['67', 'red_card', 'Suisse', 'Dan Ndoye — à vérifier'], ['72', 'goal', 'Suisse', 'Breel Embolo'], ['90+4', 'extra_time', '', 'Prolongation (1-1)'], ['112', 'goal', 'Argentine', 'Julián Álvarez'], ['120+1', 'goal', 'Argentine', 'Lautaro Martínez'], ['120+3', 'end', '', 'Fin du match (3-1 a.p.)']],
    sources: 'Daily Mirror (Sri Lanka), Fox Sports, Thairath, Atlanta News First.',
  },
  fra_esp_df: {
    venue: 'AT&T Stadium, Arlington',
    score: 'France 0-2 Espagne',
    events: [['22', 'goal', 'Espagne', 'Mikel Oyarzabal (penalty, faute de Lucas Digne sur Lamine Yamal)'], ['45', 'halftime', '', 'Mi-temps (0-1)'], ['58', 'goal', 'Espagne', 'Pedro Porro (une-deux avec Dani Olmo)'], ['90+5', 'end', '', 'Fin du match (0-2)']],
    sources: 'The Star (Reuters), NBC, FBC News, Eastern Mirror.',
  },
  eng_arg_df: {
    venue: 'Mercedes-Benz Stadium, Atlanta',
    score: 'Angleterre 1-2 Argentine',
    summary: 'Coup d’envoi à 15:00 heure de l’Est (19:00 UTC) d’après les horaires publiés.',
    events: [['37', 'yellow_card', 'Angleterre', 'Elliot Anderson (faute sur Messi)'], ['41', 'yellow_card', 'Argentine', 'Lisandro Martínez'], ['45', 'halftime', '', 'Mi-temps (0-0)'], ['51', 'yellow_card', 'Argentine', 'Cristian Romero'], ['55', 'goal', 'Angleterre', 'Anthony Gordon (passe de Morgan Rogers)'], ['85', 'goal', 'Argentine', 'Enzo Fernández'], ['90+2', 'goal', 'Argentine', 'Lautaro Martínez (de la tête)'], ['90+4', 'yellow_card', 'Argentine', 'Rodrigo De Paul'], ['90+6', 'end', '', 'Fin du match (1-2)']],
    sources: 'foot-africa, AJC, Atlanta News First, NAN.',
  },
  fra_eng_pf: {
    venue: 'Hard Rock Stadium, Miami Gardens',
    score: 'France 4-6 Angleterre',
    summary: 'Match le plus prolifique d’une Coupe du monde depuis 1982. Certaines sources donnent un coup d’envoi à 15:00 heure de l’Est (19:00 UTC) ; les pics de la collecte correspondent à 21:00 UTC (heure du document de contexte). Le but français du temps additionnel est attribué à Dembélé ou à Upamecano selon les sources : à vérifier.',
    events: [['3', 'goal', 'Angleterre', 'Declan Rice'], ['18', 'goal', 'Angleterre', 'Ezri Konsa'], ['37', 'goal', 'Angleterre', 'Bukayo Saka'], ['45+1', 'goal', 'Angleterre', 'Bukayo Saka'], ['45+2', 'halftime', '', 'Mi-temps (0-4)'], ['48', 'goal', 'France', 'Kylian Mbappé'], ['54', 'goal', 'France', 'Bradley Barcola'], ['66', 'goal', 'France', 'Kylian Mbappé (22e but en Coupe du monde, record)'], ['87', 'goal', 'Angleterre', 'Bukayo Saka (penalty, triplé)'], ['90+6', 'goal', 'France', 'Ousmane Dembélé ou Dayot Upamecano — à vérifier'], ['90+8', 'goal', 'Angleterre', 'Jude Bellingham'], ['90+9', 'end', '', 'Fin du match (4-6)']],
    sources: 'theScore, ITV, IOL, Le360, blog Wego.',
  },
  esp_arg_finale: {
    start: '2026-07-19T19:06:00Z',
    venue: 'MetLife Stadium, East Rutherford',
    score: 'Espagne 1-0 Argentine (a.p.)',
    summary: 'L’Espagne remporte sa deuxième Coupe du monde. Coup d’envoi réel à 19:06 UTC (prévu à 19:00).',
    events: [['41', 'yellow_card', 'Argentine', 'Lisandro Martínez'], ['45', 'halftime', '', 'Mi-temps (0-0)'], ['52', 'yellow_card', 'Argentine', 'Leandro Paredes'], ['82', 'yellow_card', 'Argentine', 'Enzo Fernández'], ['90+2', 'yellow_card', 'Argentine', 'Cristian Romero'], ['90+3', 'red_card', 'Argentine', 'Enzo Fernández (second avertissement)'], ['90+5', 'extra_time', '', 'Prolongation (0-0)'], ['105', 'yellow_card', 'Argentine', 'Lionel Scaloni (sélectionneur)'], ['106', 'goal', 'Espagne', 'Ferran Torres (sur une remise de la tête de Nico Williams)'], ['111', 'yellow_card', 'Argentine', 'Alexis Mac Allister'], ['120+3', 'end', '', 'Fin du match (1-0 a.p.)']],
    sources: 'Wikipédia (en), « 2026 FIFA World Cup final » ; FIFA.',
  },
};

Object.entries(EVENT_SHEET_SEEDS).forEach(([event, seed]) => {
  const report = MATCH_REPORTS[event];
  if (report) {
    if (report.kickoff_at) seed.kickoff_at = report.kickoff_at;
    seed.venue = report.venue || seed.venue;
    seed.score = report.score;
    seed.summary = [seed.summary, report.summary].filter(Boolean).join(' ');
    seed.notes = [seed.notes, `${UNVERIFIED} Sources : ${report.sources}`].filter(Boolean).join('\n\n');
  }
  const start = report?.start || seed.kickoff_at;
  seed.moments = start ? [
    { time: start, kind: 'kickoff', minute: '', team: '', label: report?.start ? `Coup d’envoi réel (prévu à ${new Date(seed.kickoff_at).toISOString().slice(11, 16)} UTC)` : '' },
    ...(report?.events || []).map(([minute, kind, team, label]) => ({ time: minuteTime(start, minute), kind, minute, team, label })),
  ] : [];
  seed.source = report
    ? 'Pré-remplie depuis le document de contexte des collectes (24/10/2026) et des comptes rendus en ligne (28/10/2026) : à vérifier'
    : 'Pré-remplie depuis le document de contexte des collectes (24/10/2026)';
});

module.exports = { EVENT_SHEET_SEEDS };
