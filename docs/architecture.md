# Architecture et maintenance

## Flux des données

Le client React appelle l’API Express via `/api`. En développement, Create React App proxy ces requêtes vers `localhost:5000`. Le backend utilise `server/db/data-source.js` pour sélectionner MongoDB, une base restaurée depuis une archive, ou le fallback archive chargé en mémoire.

Les routes lisent et valident les paramètres, les services normalisent les documents et calculent les agrégats. Les types frontend décrivent le contrat consommé par les composants.

## Backend

| Fichier | Responsabilité |
| --- | --- |
| `server/index.js` | Création Express, middleware, gestion d’erreurs et enregistrement des modules de routes. |
| `server/db/data-source.js` | Configuration MongoDB, connexion, choix de source et restauration/lecture d’archive. |
| `server/routes/posts.js` | Routes `/api/posts` (pagination `limit`/`skip`, tri `sort`, recherche `q`, type `kind`) et `/api/collection-runs`. |
| `server/routes/analytics.js` | Routes `/api/stats`, `/api/graph`, `/api/stats/timeline` (pas adaptatif) et `POST /api/graph/subgraph` (posts d’un sous-graphe). |
| `server/routes/conversations.js` | Routes `/api/conversations` (liste paginée, mise en cache par filtres) et `/api/conversation` (arbre complet depuis une racine ou un post). |
| `server/routes/accounts.js` | Connexion, compte courant, gestion des utilisateurs (admin) et annotations (`/api/annotations`, import, export). |
| `server/services/conversations.js` | Rattachement des réponses à leur racine (collectée ou manquante) et résumés de conversations. |
| `server/services/blueskyProfiles.js` | Noms, pseudos et avatars des comptes Bluesky (API publique de Bluesky, cache mémoire et collection `bluesky_profiles`, 7 jours). |
| `server/services/accounts.js` | Hachage scrypt, jetons signés HMAC, validation, stockage MongoDB ou mémoire, création du premier admin. |
| `server/middleware/auth.js` | Vérification du jeton de session, rôle admin et limitation des échecs de connexion. |
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
| `src/App.tsx` | Navigation, filtres, statistiques de la vue globale et thème ; chaque autre onglet charge ses propres données à l’ouverture. |
| `src/config.tsx` | Titre, onglets et limites des graphes. |
| `src/components/ErrorBoundary.tsx` | Message d’erreur à la place d’une page blanche si un onglet plante. |
| `src/App.css` et `src/index.css` | Mise en page et styles globaux. |
| `src/components/OverviewTab.tsx` | Indicateurs et graphiques de synthèse. |
| `src/components/ExplorerTab.tsx` | Lecteur-annotateur : liste filtrable, lecture, détails, annotation locale, import JSONL et exports. |
| `src/components/GraphsTab.tsx` | Rendu Sigma, spatialisation, voisinage, sélection et export de sous-graphe. |
| `src/components/DashboardFilters.tsx` | Contrôles partagés de collecte, plateforme, langue et période. |
| `src/components/ThreadsTab.tsx` | Liste des conversations et lecture en arbre, export d’une conversation. |
| `src/components/AuthGate.tsx` | Écran de connexion et contexte de l’utilisateur connecté (`useAuth`). |
| `src/components/UsersTab.tsx` | Gestion des comptes (administrateurs). |
| `src/components/ChangePasswordDialog.tsx` | Changement de son mot de passe. |
| `src/components/GuidedTour.tsx` | Tour guidé relançable et navigation entre les vues. |
| `src/components/KpiCard.tsx` | Carte réutilisable d’indicateur. |
| `src/services/api.ts` | Appels HTTP : toutes les fonctions sont dans l’objet `api` (jeton de session ajouté, 401 renvoyant à la connexion). |
| `src/types/index.ts` | Modèles métier partagés (`Post`, `DashboardData`…). |
| `src/types/api.ts` | Formats des requêtes et réponses de l’API. |
| `src/data/dashboardData.ts` | Données vides, construction des données de la vue globale depuis `/api/stats`, libellés de langues et couleurs. |
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
## Index MongoDB

Au démarrage, l’API crée si besoin les index `posts.post_id`, `posts.reply_to_id`, `users.username` (unique) et `annotations.{user_id, platform, post_id}` (unique). `createIndex` est sans effet quand l’index existe : un déploiement les crée donc sur Atlas sans manipulation. Si l’utilisateur Atlas n’a pas les droits d’écriture, un avertissement est journalisé et l’API continue (conversations plus lentes).

## Graphes

`GET /api/graph` parcourt les posts filtrés, compte nœuds et arêtes, puis ne renvoie que les `maxNodes` nœuds les plus fréquents (5 000 au plus) et les arêtes d’un poids au moins `minEdgeWeight`, avec `total_nodes` / `total_links` pour le volume complet. Les réponses de l’API sont compressées (gzip). Le rendu utilise Sigma.js (WebGL) sur un graphe graphology ; ForceAtlas2 et Noverlap tournent dans un web worker, la force simple image par image, les autres dispositions sont calculées puis animées. Dans le graphe des mentions, les comptes Bluesky sont identifiés par leur DID (auteurs et facets de mention) et étiquetés avec leur pseudo.
