# Guide utilisateur

## Navigation et filtres

La barre latérale donne accès aux vues globale, explorateur, threads et graphes (et « Utilisateurs » pour les administrateurs). Le bouton « Prise en main » relance à tout moment le tour guidé.

## Compte et connexion

Chacun se connecte avec son identifiant et son mot de passe, fournis par un administrateur. « Mon mot de passe » permet de le changer ; « Se déconnecter » ferme la session (sinon valable 7 jours). Les administrateurs créent les comptes, changent les rôles, réinitialisent les mots de passe et désactivent un accès dans l’onglet « Utilisateurs ».

Les filtres en haut de page sont partagés par toutes les vues : collecte, plateforme, langue et période. Les sélections sont cumulatives. Le nombre affiché à côté d’une collecte correspond aux posts dont `collection_context.collection_name` correspond à cette collecte. Les noms sont normalisés pour ignorer les différences de casse et les espaces superflus.

## Vue globale

Les indicateurs résument les posts filtrés ; seules les plateformes présentes dans la sélection sont affichées (cartes, courbe, totaux). La courbe « Nombre de posts dans le temps » choisit automatiquement son pas (de 1 minute à 1 semaine) selon la période couverte ; les quelques posts dont la date est aberrante (ex. horodatages Bluesky de 2009) sont exclus et comptés à part.

Le camembert des langues regroupe dans « Autres » les codes non identifiés (`qme` = médias seuls, `und`, `zxx`…), les langues sous le seuil choisi (1 % par défaut) et celles au-delà du nombre maximal de parts (9 par défaut) ; les deux réglages sont en haut de la carte, et le survol de « Autres » donne le détail. Le second camembert propose trois comparaisons, nommées au-dessus du graphique (Replies, Retweets, Citations) : cliquez sur l’une d’elles ou utilisez les flèches. Le tableau par collecte n’apparaît que lorsque toutes les collectes sont affichées.

« Top keywords détectés » compare deux sources distinctes : les hashtags extraits du texte (top 20 par occurrences) et les mots-clés de paramètres (`matched_keywords`, ceux qui ont servi à la collecte). Un mot-clé de paramètre peut être du texte libre ou une mention, donc absent des hashtags ; un point vert signale ceux qui figurent aussi dans le top des hashtags.

## Explorateur

Lecteur-annotateur repris de l’ancien fichier `lecteur_X_Bluesky_annotation_responsive_v2.html`. Les onglets Tweets X / Posts Bluesky n’affichent que les plateformes présentes dans les filtres. À gauche : recherche dans la base (texte, auteur, mot-clé), tri (récents, likes, vues, reposts, réponses), type de publication, filtres d’annotation, de langue et de média, puis la liste (« Charger plus » ajoute 200 publications). Au centre : la publication complète (médias, lien externe, citation, métriques, entités), navigation par flèches ← →, « Voir les détails » (métadonnées et JSON brut), « Voir le thread » et lien vers l’original. À droite : le formulaire d’annotation (statut, pertinence, thème, tonalité, interaction, mots-clés, commentaire) et vos annotations du post.

Un post peut recevoir plusieurs annotations, comme des commentaires. « Ajouter l’annotation » enregistre le formulaire sur le serveur sous votre compte, place l’annotation en tête de « Mes annotations sur ce tweet » et vide le formulaire. Chaque annotation est datée et propose « Modifier » (le formulaire se remplit ; « Enregistrer les modifications » ou « Annuler »), « Partager » et « Supprimer ». Rien n’est enregistré sans cliquer : un formulaire commencé est gardé si vous passez à un autre post et le retrouve en revenant. Dans la liste, le statut affiché est celui de votre annotation la plus récente, avec le nombre d’annotations quand il y en a plusieurs. « Exporter » propose le CSV de la liste (une ligne par annotation), le JSON enrichi, toutes vos annotations et, pour les administrateurs, celles de l’équipe (colonne « annotateur »). Les annotations faites dans un navigateur avant l’arrivée des comptes s’importent avec le bouton proposé dans le panneau d’annotation.

**Partager ses annotations** se fait de deux façons, en lecture seule (les destinataires ne peuvent pas modifier) :
- **annotation par annotation** : le bouton « Partager » d’une de vos annotations permet de cocher les personnes qui pourront la lire. La carte indique avec qui elle est partagée, et la liste affiche un repère « partagée » ;
- **tout partager** : le bouton « Tout partager » de la barre d’outils donne accès à toutes vos annotations, présentes et futures, aux personnes cochées.

Dans les deux cas, la case « Inclure mon commentaire libre » (ou « mes commentaires libres ») permet de ne pas partager le commentaire : les destinataires voient alors le statut, la pertinence, le thème, la tonalité, l’interaction et les mots-clés, et la mention « Commentaire libre non partagé ». Si une même annotation est partagée des deux façons, le commentaire est visible dès qu’un des partages l’autorise. Décochez une personne pour retirer le partage. Sous le formulaire, « Partagées avec moi » affiche les annotations du post en cours qui vous sont partagées (les administrateurs voient celles de toute l’équipe). La vue « Partagés avec moi », en haut de la liste, rassemble tous les posts dont une annotation vous est partagée, avec le nom de leur auteur.


Les médias distants dépendent des URL enregistrées et de leur accessibilité depuis le navigateur. Les plateformes peuvent limiter ou faire expirer certaines URL.

## Threads

Les conversations sont reconstruites à partir des réponses collectées (`reply_to_id`). Quand le post d’origine n’a pas été collecté (un tweet officiel auquel des supporters répondent, par exemple), il apparaît comme « Post d’origine non collecté », avec un lien vers l’original : les réponses ne sont plus présentées comme leur propre parent.

À gauche, la liste se filtre avec les filtres globaux, une recherche dans les réponses, une taille minimale et l’origine (collectée ou non), et se trie par nombre de réponses, de participants, profondeur, likes ou date. À droite, la conversation s’affiche en arbre : chaque réponse sous celle à laquelle elle répond, avec un résumé (réponses, participants, profondeur, durée). Les grandes conversations s’ouvrent repliées au-delà du premier niveau ; « Tout déplier », l’ordre chronologique ou par likes et l’export CSV/JSON sont dans l’en-tête. Depuis l’Explorer, « Voir le thread » ouvre la conversation du post, surligné avec le chemin qui le relie à la racine.

## Graphes

Le graphe se charge à l’ouverture de l’onglet. **Hashtags** : un nœud est un hashtag (taille = nombre de posts qui le contiennent) ; une arête relie deux hashtags présents dans un même post (épaisseur = nombre de ces posts). **Mentions** : un nœud est un compte, auteur ou mentionné ; une arête relie un auteur à un compte qu’il a mentionné (le sens n’est pas conservé). Les comptes Bluesky sont affichés avec leur pseudo.

« Nœuds » fixe combien de nœuds charger : ce sont toujours **les plus fréquents** (jusqu’à 5 000). « Fréq. min. » masque les nœuds moins fréquents ; « Poids min. des arêtes » écarte les liens trop rares, ce qui allège beaucoup les grands graphes. Le résumé indique le volume affiché et le volume total pour les filtres choisis.

« Spatialisation du graphe » change la disposition sans recharger la page : ForceAtlas2 (défaut), ForceAtlas2 + anti-chevauchement, force-directed simple, Communautés (Louvain, le plus lisible pour les grands graphes), circulaire, concentrique, radial et hiérarchique (centrés sur le nœud sélectionné). Les dispositions de force se calculent en tâche de fond : le graphe se met en place sous vos yeux sans figer la page. « Paramètres avancés » donne les réglages de la disposition choisie (espacement, gravité, LinLog, influence des poids, Barnes-Hut, durée du calcul, marge, résolution de Louvain) ; « Valeurs par défaut » les rétablit. « Couleurs par communauté » colore les nœuds selon Louvain. « Plein écran » (barre d’outils, ou bouton en haut à droite du graphe) affiche le graphe seul sur tout l’écran ; Échap ou « Quitter le plein écran » pour revenir.

Cliquer un nœud ouvre son voisinage (niveaux 1 à 3) dans le panneau de droite, sans sélectionner tout le sous-graphe : cochez les nœuds à conserver, ou utilisez « Tout sélectionner », « Tout désélectionner », « Voisins directs uniquement » et la recherche. ↗ explore depuis un voisin en gardant la sélection ; Maj + clic sur le graphe ajoute ou retire un nœud. « Isoler la sélection » masque le reste.

L’export porte sur les nœuds sélectionnés et les arêtes qui les relient : JSON complet (métadonnées, nœuds, arêtes, posts), CSV (trois fichiers) ou GEXF pour Gephi. JSON et CSV incluent les posts contenant au moins un nœud sélectionné, avec les filtres actifs ; `subgraph_nodes` et `subgraph_edges` relient chaque post aux nœuds et arêtes. « Exporter le graphe affiché (GEXF) » enregistre tout le graphe visible pour l’analyser dans Gephi.
