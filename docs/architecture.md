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
| `server/routes/accounts.js` | Connexion, compte courant, gestion des utilisateurs (admin), annuaire, annotations (`/api/annotations`, import, export), partage (`/api/annotations/shares`) et détail par post (`/api/annotations/post` : mes annotations et celles qui me sont partagées). |
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
| `src/components/ExplorerTab.tsx` | Lecteur-annotateur : liste filtrable, lecture, détails, annotations multiples par post, partage et exports. |
| `src/components/GraphsTab.tsx` | Rendu Sigma, spatialisation, voisinage, sélection, graphe dynamique et export de sous-graphe. |
| `src/components/GraphTimeBar.tsx` | Frise du graphe dynamique (volume par tranche, fenêtre, lecture) et courbe d’activité d’un nœud. |
| `src/components/DashboardFilters.tsx` | Contrôles partagés de collectes (choix multiple, `collectionId=a,b`), plateforme, langue et période. |
| `src/components/AnnotationPanel.tsx` | Panneau d’annotation commun à l’Explorer et à Threads (formulaire, mes annotations du post, annotations partagées) et hooks `useMyAnnotations`, `useDirectory`. |
| `src/components/ThreadsTab.tsx` | Liste des conversations, lecture en arbre, annotation des posts et export d’une conversation. |
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
| `src/utils/postRecord.ts` | Vue lecteur d’un post (raw_json X / Bluesky). |
| `src/utils/annotations.ts` | Stockage local des annotations de l’Explorer. |
| `src/utils/graphLayouts.ts` | Spatialisations (graphology : ForceAtlas2, force, Noverlap, Louvain/circlepack) et dispositions géométriques. |
| `src/utils/subgraphExport.ts` | Sous-graphe induit et exports JSON / CSV / GEXF (statique ou dynamique). |
| `src/utils/graphTime.ts` | Fenêtres de temps du graphe dynamique : sommes sur une fenêtre, bornes, tailles proposées. |
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

Au démarrage, l’API crée si besoin les index `posts.post_id`, `posts.reply_to_id`, `users.username` (unique), `annotations.{user_id, platform, post_id}` et `annotations.{platform, post_id}` (l’ancien index unique `user_post_unique` est supprimé : une personne peut annoter plusieurs fois un même post). Un index déjà présent sur les mêmes champs est réutilisé. `createIndex` est sans effet quand l’index existe : un déploiement les crée donc sur Atlas sans manipulation. Si l’utilisateur Atlas n’a pas les droits d’écriture, un avertissement est journalisé et l’API continue (conversations plus lentes).

## Graphes

`GET /api/graph` parcourt les posts filtrés, compte nœuds et arêtes, puis ne renvoie que les `maxNodes` nœuds les plus fréquents (5 000 au plus) et les arêtes d’un poids au moins `minEdgeWeight`, avec `total_nodes` / `total_links` pour le volume complet. Les réponses de l’API sont compressées (gzip). Le rendu utilise Sigma.js (WebGL) sur un graphe graphology ; ForceAtlas2 et Noverlap tournent dans un web worker, la force simple image par image, les autres dispositions sont calculées puis animées. Dans le graphe des mentions, les comptes Bluesky sont identifiés par leur DID (auteurs et facets de mention) et étiquetés avec leur pseudo.

Avec `temporal=1`, `createTemporalGraphBuilder` ajoute à chaque nœud et arête une série creuse `series: [[tranche, posts], …]`, et la réponse un objet `time` (`start`, `bucket_minutes`, `buckets`, `volume` par tranche, `excluded`). La date est celle de la courbe (timestamp, puis createdAt, puis collected_at) et les dates aberrantes sont écartées avec la même règle (`coreTimeBounds`). La tranche vient de `bucketMinutes` ou est choisie pour donner au plus 300 tranches ; `peaks=k` ajoute les k nœuds les plus fréquents de chaque tranche. Le navigateur parcourt ensuite le temps sans nouvelle requête : l’activité de la fenêtre est calculée dans un effet et appliquée par les reducers Sigma, la disposition restant celle de toute la période. Pour 2 000 hashtags (29 000 arêtes) sur un mois, la réponse pèse environ 2,5 Mo, 250 Ko compressés. `startTime` / `endTime` (ISO) filtrent les posts à la seconde près, notamment pour l’export des posts d’un sous-graphe limité à la fenêtre.

## Annotations : plusieurs par post, partage

Chaque annotation est un document de `annotations` avec son identifiant, `created_at` et `updated_at` : `POST /api/annotations` en ajoute une, `PUT` et `DELETE /api/annotations/:id` la modifient ou la suppriment (seulement par son auteur). Le statut affiché dans la liste de l’Explorer est celui de l’annotation la plus récente.

Le partage complet est stocké sur le compte du propriétaire (`users.shared_with`, `users.share_notes`) ; le partage annotation par annotation sur l’annotation elle-même (`annotations.shared_with`, `annotations.share_notes`, route `PUT /api/annotations/:id/share`). Quand `share_notes` vaut `false`, le commentaire libre est retiré de la réponse (`note_hidden: true`). Dans les deux cas, les destinataires lisent sans modifier, et la liste des destinataires n’est renvoyée qu’à l’auteur. `GET /api/annotations/shared-with-me` liste les posts dont une annotation est visible par l’utilisateur ; `/api/posts?ids=…` charge ces posts.
