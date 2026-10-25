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
| `server/routes/conversations.js` | Routes `/api/conversations` (liste paginée, résumés en cache), `/api/conversation` (arbre d’une conversation depuis `rootId` ou `postId` : 5 000 posts affichés au plus, `pending` pour les réponses non chargées, `branch=<post_id>` pour charger une branche, `stats` sur toute la conversation) et `/api/conversation/export` (conversation entière en CSV ou JSON, envoyée par lots). |
| `server/services/conversationTree.js` | Arbre léger d’une conversation (sur `post_facts`), sélection affichée et branches en attente, résumé, `raw_json` allégé pour l’affichage, lignes CSV. |
| `server/routes/accounts.js` | Connexion, compte courant, gestion des utilisateurs (admin), annuaire, annotations (`/api/annotations`, import, export), partage (`/api/annotations/shares`) et détail par post (`/api/annotations/post` : mes annotations et celles qui me sont partagées). |
| `server/services/conversations.js` | Rattachement des réponses à leur racine (collectée ou manquante) et résumés de conversations. |
| `server/services/blueskyProfiles.js` | Noms, pseudos et avatars des comptes Bluesky (API publique de Bluesky, cache mémoire et collection `bluesky_profiles`, 7 jours). |
| `server/services/accounts.js` | Hachage scrypt, jetons signés HMAC, validation, stockage MongoDB ou mémoire, création du premier admin. |
| `server/middleware/auth.js` | Vérification du jeton de session, rôle admin et limitation des échecs de connexion. |
| `server/routes/collections.js` | Route `/api/collections` : collectes avec leur volume, leur événement (`collection_context.event`) et leur date de début (`started_at`), agrégées côté Mongo ou regroupées depuis l’archive. |
| `server/services/normalization.js` | Forme canonique des posts, du contexte de collecte, des dates et des médias. |
| `server/services/collections.js` | Identité, regroupement et expressions Mongo des collectes. |
| `server/services/query.js` | Filtres de l’API sur `post_facts` (`buildFactsMatch`, dont recherche `q` et type `kind`), clé de cache stable (`pickFilters`) et équivalent pour les posts chargés en mémoire (`matchesPostQuery`). |
| `server/services/facts.js` | Collection allégée `post_facts` : une entrée par post (`factOf`), nœuds du graphe (`factEntities`), index, état et reconstruction. |
| `server/services/factsManager.js` | Tient `post_facts` à jour (démarrage, puis toutes les 5 minutes) et précharge les vues principales après chaque reconstruction. |
| `server/services/factsGraph.js` | Graphes (statiques et dynamiques) calculés en deux temps sur `post_facts`. |
| `server/services/responseCache.js` | Cache des réponses coûteuses, vidé à chaque reconstruction de `post_facts`. |
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
| `src/utils/events.ts` | Événements de collecte : libellés lisibles, regroupement des collectes par événement, libellé d’une sélection. |
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

Placez le traitement HTTP dans le module `server/routes` concerné. Gardez les conversions de schéma dans `normalization.js` et les calculs purs réutilisables dans `services/analytics.js`; adaptez en parallèle les chemins Mongo (sur `post_facts`) et archive, puis ajoutez un test `node:test` couvrant les deux modes quand ils divergent. Un champ nouveau nécessaire à un calcul s’ajoute dans `factOf` ; augmentez alors `FACTS_VERSION` pour que `post_facts` soit reconstruit au prochain démarrage.

Ajoutez toute nouvelle variable backend à `server/.env.example` et au tableau du README. N’ajoutez aucun identifiant réel au dépôt. Après une modification : `npm run test:server`, les tests React et `npm run build`.
## Gros volumes : `post_facts` et cache

Les posts (`posts`) gardent leurs données brutes (`raw_json`) : avec 3,8 millions de posts, la collection pèse 13 Go, bien plus que le cache de MongoDB. Les statistiques, la courbe, la liste des collectes, les graphes, le tri de l’Explorer et les conversations lisent donc une collection allégée, `post_facts` : une entrée par post (même `_id`), sans `raw_json`, avec les champs déjà normalisés (`collection_key`, `event`, `date`, `platform`, `lang`, `author_handle`, `text`, `keywords`, `hashtags`, `mentions`, `author_node`, `emojis`, `has_link`, `is_reply`, `is_retweet`, `is_quote`, `reply_to_id`, compteurs d’engagement). Pour 3,8 millions de posts : 0,9 Go sur disque, 1,1 Go d’index, construite en 7 minutes environ.

- **Mise à jour** : au démarrage puis toutes les 5 minutes, `factsManager` compare `post_facts` aux posts (nombre de documents, `FACTS_VERSION` dans `facts_meta`). S’ils diffèrent, par exemple après un import, et que le nombre de posts n’a pas bougé depuis la vérification précédente (pour ne pas reconstruire au milieu d’un import ; au démarrage, c’est immédiat), la collection est reconstruite dans `post_facts_build` puis remplace l’ancienne d’un coup : l’ancienne version reste servie pendant le calcul. Les index de `post_facts` (`FACT_INDEXES`) sont synchronisés au démarrage, sans reconstruction.
- **Première construction** : tant que `post_facts` n’existe pas, les routes répondent `503` avec `preparing: true` ; le frontend réessaie toutes les 10 secondes.
- **Filtres** : `buildFactsMatch` ne produit que des conditions indexables (pas de `$expr`). Les index de tri de l’Explorer (`sort_likes`, `sort_date`…) contiennent plateforme, champ trié, `_id` et collecte : la page de 200 posts se lit dans l’index, puis seuls ces posts sont chargés depuis `posts`. Une recherche de texte essaie l’index 1,5 s puis lit le corpus dans l’ordre (environ 8 s au pire sur 3,8 millions de posts).
- **Cache** : statistiques, courbe, collectes, graphes et résumés de conversations sont gardés en mémoire (`responseCache`, 80 entrées) jusqu’à la prochaine reconstruction. Les clés ne dépendent pas de l’ordre des collectes cochées. Après chaque reconstruction sont préchargés : la liste des collectes, la Vue globale et la courbe (sans filtre, par plateforme et pour chaque événement), le graphe des hashtags par défaut et la première page de Threads.
- **Hashtags** : les statistiques comptent les posts qui contiennent un hashtag (comme la taille des nœuds du graphe), et non plus ses occurrences.

Temps mesurés sur 3,8 millions de posts (machine locale) : vues préchargées < 0,01 s ; Vue globale d’une sélection non préchargée 2 à 10 s la première fois ; Explorer 0,01 à 0,4 s ; Threads 0,1 s par page (20 s pour le premier calcul sans filtre) ; graphe 10 à 20 s la première fois, puis instantané.

## Index MongoDB

Au démarrage, l’API crée si besoin les index `posts.post_id`, `posts.reply_to_id`, `users.username` (unique), `annotations.{user_id, platform, post_id}` et `annotations.{platform, post_id}` (l’ancien index unique `user_post_unique` est supprimé : une personne peut annoter plusieurs fois un même post). Un index déjà présent sur les mêmes champs est réutilisé. `createIndex` est sans effet quand l’index existe : un déploiement les crée donc sur Atlas sans manipulation. Si l’utilisateur Atlas n’a pas les droits d’écriture, un avertissement est journalisé et l’API continue (conversations plus lentes).

## Graphes

`GET /api/graph` renvoie les `maxNodes` nœuds les plus fréquents (20 000 au plus ; l’onglet Graphes prévient au-delà de 5 000) et les arêtes d’un poids au moins `minEdgeWeight` entre eux. Sur MongoDB, le calcul se fait en deux temps sur `post_facts` (`factsGraph.js`) : une agrégation compte les nœuds et garde les plus fréquents, puis seules les entrées contenant l’un d’eux sont lues pour compter les arêtes entre eux. `total_nodes` donne le nombre total de nœuds ; `total_links` vaut `null` (compter toutes les paires d’un gros corpus coûterait trop cher). En mode archive, `createGraphBuilder` fait le même calcul en mémoire. Les réponses de l’API sont compressées (gzip). Le rendu utilise Sigma.js (WebGL) sur un graphe graphology ; ForceAtlas2 et Noverlap tournent dans un web worker, la force simple image par image, les autres dispositions sont calculées puis animées. Dans le graphe des mentions, les comptes Bluesky sont identifiés par leur DID (auteurs et facets de mention) et étiquetés avec leur pseudo.

Avec `temporal=1`, chaque nœud et arête reçoit (`buildFactsTemporalGraph`, ou `createTemporalGraphBuilder` en mode archive) une série creuse `series: [[tranche, posts], …]`, et la réponse un objet `time` (`start`, `bucket_minutes`, `buckets`, `volume` par tranche, `excluded`). La date est celle de la courbe (timestamp, puis createdAt, puis collected_at) et les dates aberrantes sont écartées avec la même règle (`coreTimeBounds`). La tranche vient de `bucketMinutes` ou est choisie pour donner au plus 300 tranches ; `peaks=k` ajoute les k nœuds les plus fréquents de chaque tranche. Le navigateur parcourt ensuite le temps sans nouvelle requête : l’activité de la fenêtre est calculée dans un effet et appliquée par les reducers Sigma, la disposition restant celle de toute la période. Pour 2 000 hashtags (29 000 arêtes) sur un mois, la réponse pèse environ 2,5 Mo, 250 Ko compressés. `startTime` / `endTime` (ISO) filtrent les posts à la seconde près, notamment pour l’export des posts d’un sous-graphe limité à la fenêtre.

## Annotations : plusieurs par post, partage

Chaque annotation est un document de `annotations` avec son identifiant, `created_at` et `updated_at` : `POST /api/annotations` en ajoute une, `PUT` et `DELETE /api/annotations/:id` la modifient ou la suppriment (seulement par son auteur). Le statut affiché dans la liste de l’Explorer est celui de l’annotation la plus récente.

Le partage complet est stocké sur le compte du propriétaire (`users.shared_with`, `users.share_notes`) ; le partage annotation par annotation sur l’annotation elle-même (`annotations.shared_with`, `annotations.share_notes`, route `PUT /api/annotations/:id/share`). Quand `share_notes` vaut `false`, le commentaire libre est retiré de la réponse (`note_hidden: true`). Dans les deux cas, les destinataires lisent sans modifier, et la liste des destinataires n’est renvoyée qu’à l’auteur. `GET /api/annotations/shared-with-me` liste les posts dont une annotation est visible par l’utilisateur ; `/api/posts?ids=…` charge ces posts.
