# Guide utilisateur

## Navigation et filtres

La barre latérale donne accès aux vues globale, explorateur, threads et graphes. Le bouton « Prise en main » relance à tout moment le tour guidé.

Les filtres en haut de page sont partagés par toutes les vues : collecte, plateforme, langue et période. Les sélections sont cumulatives. Le nombre affiché à côté d’une collecte correspond aux posts dont `collection_context.collection_name` correspond à cette collecte. Les noms sont normalisés pour ignorer les différences de casse et les espaces superflus.

## Vue globale

Les indicateurs résument les posts filtrés ; seules les plateformes présentes dans la sélection sont affichées (cartes, courbe, totaux). La courbe « Nombre de posts dans le temps » choisit automatiquement son pas (de 1 minute à 1 semaine) selon la période couverte ; les quelques posts dont la date est aberrante (ex. horodatages Bluesky de 2009) sont exclus et comptés à part.

Le camembert des langues regroupe dans « Autres » les codes non identifiés (`qme` = médias seuls, `und`, `zxx`…) et les langues sous 1 % ; survolez cette part pour le détail. Le second camembert propose trois vues (flèches) : posts vs replies, vs retweets, vs citations. Le tableau par collecte n’apparaît que lorsque toutes les collectes sont affichées.

« Top keywords détectés » compare deux sources distinctes : les hashtags extraits du texte (top 20 par occurrences) et les mots-clés de paramètres (`matched_keywords`, ceux qui ont servi à la collecte). Un mot-clé de paramètre peut être du texte libre ou une mention, donc absent des hashtags ; un point vert signale ceux qui figurent aussi dans le top des hashtags.

## Explorateur

Lecteur-annotateur repris de l’ancien fichier `lecteur_X_Bluesky_annotation_responsive_v2.html`. Les onglets Tweets X / Posts Bluesky n’affichent que les plateformes présentes dans les filtres. À gauche : recherche dans la base (texte, auteur, mot-clé), tri (récents, likes, vues, reposts, réponses), type de publication, filtres d’annotation, de langue et de média, puis la liste (« Charger plus » ajoute 200 publications). Au centre : la publication complète (médias, lien externe, citation, métriques, entités), navigation par flèches ← →, « Voir les détails » (métadonnées et JSON brut), « Voir le thread » et lien vers l’original. À droite : l’annotation (statut, pertinence, thème, tonalité, interaction, mots-clés, commentaire), enregistrée automatiquement dans le navigateur.

Les annotations restent locales au navigateur : exportez-les via « Exporter » (CSV de la liste, JSON enrichi, ou toutes les annotations enregistrées). « Ouvrir un JSONL » charge un fichier de tweets bruts ou de posts collectés pour l’annoter hors base ; « Revenir à la base » le referme.

Les médias distants dépendent des URL enregistrées et de leur accessibilité depuis le navigateur. Les plateformes peuvent limiter ou faire expirer certaines URL.

## Threads

La vue présente un post parent et les réponses reliées par `reply_to_id`. Depuis l’explorateur, « Voir le thread » charge la conversation correspondante.

## Graphes

Choisissez Hashtags ou Mentions. La fréquence augmente la taille d’un nœud ; le poids d’une arête correspond au nombre de relations observées et est rendu sur une échelle logarithmique. Les contrôles permettent de limiter le nombre de nœuds (jusqu’à 2 000), de filtrer les valeurs minimales et de masquer les arêtes.

« Spatialisation du graphe » change la disposition sans recharger la page : ForceAtlas2 (défaut, petits graphes), ForceAtlas2 + anti-chevauchement, force-directed simple, Communautés (Louvain, le plus lisible pour les grands graphes), circulaire, concentrique, radial et hiérarchique (centrés sur le nœud sélectionné). « Couleurs par communauté » colore les nœuds selon Louvain.

Cliquer un nœud ouvre son voisinage (niveaux 1 à 3) dans le panneau de droite, sans sélectionner tout le sous-graphe : cochez les nœuds à conserver, ou utilisez « Tout sélectionner », « Tout désélectionner », « Voisins directs uniquement » et la recherche. ↗ explore depuis un voisin en gardant la sélection ; Maj + clic sur le graphe ajoute ou retire un nœud. « Isoler la sélection » masque le reste.

L’export porte uniquement sur les nœuds sélectionnés et les arêtes qui les relient : JSON complet (métadonnées, nœuds, arêtes, posts), CSV (trois fichiers) ou GEXF pour Gephi. JSON et CSV incluent les posts contenant au moins un nœud sélectionné, avec les filtres actifs ; `subgraph_nodes` et `subgraph_edges` (identifiants `source::target`) relient chaque post aux nœuds et arêtes du sous-graphe. « Reset view » recentre le graphe et ferme le voisinage.
