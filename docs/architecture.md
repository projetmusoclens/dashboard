# Architecture et maintenance

## Flux des données

Le client React appelle l’API Express via `/api`. En développement, Create React App proxy ces requêtes vers `localhost:5000`. Le backend utilise `server/db/data-source.js` pour sélectionner MongoDB, une base restaurée depuis une archive, ou le fallback archive chargé en mémoire.

Les routes lisent et valident les paramètres, les services normalisent les documents et calculent les agrégats. Les types frontend décrivent le contrat consommé par les composants.

## Backend

| Fichier | Responsabilité |
| --- | --- |
| `server/index.js` | Création Express, middleware, gestion d’erreurs et enregistrement des modules de routes. |
| `server/db/data-source.js` | Configuration MongoDB, connexion, choix de source et restauration/lecture d’archive. |
| `server/routes/posts.js` | Routes `/api/dashboard`, `/api/posts` (pagination `limit`/`skip`, tri `sort`), `/api/threads` et `/api/collection-runs`. |
| `server/routes/analytics.js` | Routes `/api/stats`, `/api/graph`, `/api/stats/timeline` (pas adaptatif) et `POST /api/graph/subgraph` (posts d’un sous-graphe). |
| `server/routes/collections.js` | Route `/api/collections`, avec agrégation côté Mongo ou regroupement du fallback archive. |
| `server/services/normalization.js` | Forme canonique des posts, du contexte de collecte, des dates et des médias. |
| `server/services/collections.js` | Identité, regroupement et expressions Mongo des collectes. |
| `server/services/query.js` | Construction des filtres Mongo (dont recherche `q` et type `kind`) et équivalent pour les posts chargés en mémoire. |
| `server/services/analytics.js` | Calcul des threads, statistiques locales, graphes, sous-graphes et série temporelle depuis une liste de posts. |
| `server/services/analytics.test.js` | Tests Node : types de posts, hashtags Unicode, sous-graphes, série temporelle, pagination. |
| `server/services/collections.test.js` | Tests Node intégrés pour collectes, filtres, médias et poids de graphe. |

### Identité des collectes

Une collecte est identifiée par le nom nettoyé de `collection_context.collection_name`. Les espaces répétitifs et la casse ne créent pas de catégories supplémentaires. `event`, `platform` et `started_at` restent des métadonnées de contexte, pas des clés de duplication ; les mots-clés et champs batch ne servent jamais à inventer une collecte. Un contexte absent est présenté comme « Collecte inconnue ».

La clé est dérivée des données : il n’existe pas de liste codée en dur ni de limite arbitraire sur le nombre de collectes. Les routes de liste, statistiques, posts, threads, graphes et timeline doivent garder la même identité et le même filtre.

## Frontend

| Fichier | Responsabilité |
| --- | --- |
| `src/index.tsx` | Point de montage React et styles globaux. |
| `src/App.tsx` | Navigation, état global, chargement API, filtres et thème. |
| `src/App.css` et `src/index.css` | Mise en page et styles globaux. |
| `src/components/OverviewTab.tsx` | Indicateurs et graphiques de synthèse. |
| `src/components/ExplorerTab.tsx` | Lecteur-annotateur : liste filtrable, lecture, détails, annotation locale, import JSONL et exports. |
| `src/components/ThreadsTab.tsx` | Affichage des conversations. |
| `src/components/GraphsTab.tsx` | Rendu Sigma, spatialisation, voisinage, sélection et export de sous-graphe. |
| `src/components/DashboardFilters.tsx` | Contrôles partagés de collecte, plateforme, langue et période. |
| `src/components/GuidedTour.tsx` | Tour guidé relançable et navigation entre les vues. |
| `src/components/KpiCard.tsx` | Carte réutilisable d’indicateur. |
| `src/services/api.ts` | Fonctions HTTP et types de réponse API. |
| `src/types/index.ts` | Modèles TypeScript partagés du dashboard. |
| `src/data/dashboardData.ts` | Valeurs initiales, libellés de langues et couleurs de graphiques. |
| `src/utils/format.ts` | Formatage partagé des nombres et valeurs. |
| `src/utils/languages.ts` | Libellés de langues et regroupement « Autres ». |
| `src/utils/postRecord.ts` | Vue lecteur d’un post (raw_json X / Bluesky) et import de fichiers. |
| `src/utils/annotations.ts` | Stockage local des annotations de l’Explorer. |
| `src/utils/graphLayouts.ts` | Spatialisations (graphology : ForceAtlas2, force, Noverlap, Louvain/circlepack) et dispositions géométriques. |
| `src/utils/subgraphExport.ts` | Sous-graphe induit et exports JSON / CSV / GEXF. |
| `src/utils/download.ts` | Téléchargements et CSV côté navigateur. |
| `src/App.test.tsx` et `src/setupTests.ts` | Test de rendu et configuration Testing Library. |

## Données et fichiers de projet

- `docker-compose.yml` : configuration du service MongoDB local.
- `public/` : document HTML de montage et ressources publiques servies telles quelles.
- `build/` : sortie générée par `npm run build`; ne pas modifier directement.
- `package.json` : scripts npm, dépendances frontend/backend et proxy CRA.
- `tsconfig.json` : options de compilation TypeScript du frontend.
- `mongorestore_help.txt` : aide historique fournie pour les outils de restauration.

## Ajouter une route ou une métrique

Placez le traitement HTTP dans le module `server/routes` concerné. Gardez les conversions de schéma dans `normalization.js` et les calculs purs réutilisables dans `services/analytics.js`; adaptez en parallèle les chemins Mongo et archive, puis ajoutez un test `node:test` couvrant les deux modes quand ils divergent.

Ajoutez toute nouvelle variable backend à `server/.env.example` et au tableau du README. N’ajoutez aucun identifiant réel au dépôt. Après une modification : `npm run test:server`, les tests React et `npm run build`.