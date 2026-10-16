# Guide utilisateur

## Navigation et filtres

La barre latérale donne accès aux vues globale, explorateur, threads et graphes. Le bouton « Prise en main » relance à tout moment le tour guidé.

Les filtres en haut de page sont partagés par toutes les vues : collecte, plateforme, langue et période. Les sélections sont cumulatives. Le nombre affiché à côté d’une collecte correspond aux posts dont `collection_context.collection_name` correspond à cette collecte. Les noms sont normalisés pour ignorer les différences de casse et les espaces superflus.

## Vue globale

Les indicateurs résument les posts filtrés. Les graphiques et tableaux décrivent l’activité, les langues, les plateformes et les collectes correspondant aux filtres.

## Explorateur

Recherchez dans le texte, le nom d’auteur ou les mots-clés, puis choisissez le tri par likes, vues ou reposts. Une carte peut afficher plusieurs images et vidéos directes disponibles dans les champs média du post. Cliquez une image pour l’agrandir ; utilisez les contrôles intégrés pour lire une vidéo. Sélectionner un post ouvre la vue de son thread.

Les médias distants dépendent des URL enregistrées dans MongoDB et de leur accessibilité depuis le navigateur. Les plateformes peuvent limiter ou faire expirer certaines URL.

## Threads

La vue présente un post parent et les réponses reliées par `reply_to_id`. Depuis l’explorateur, choisir un post permet de charger la conversation correspondante.

## Graphes

Choisissez Hashtags ou Mentions. La fréquence augmente la taille d’un nœud ; le poids d’une arête correspond au nombre de relations observées et est rendu sur une échelle logarithmique. Cliquez un nœud pour mettre en évidence ses voisins. Les contrôles permettent de limiter le nombre de nœuds, de filtrer les valeurs minimales, de masquer les arêtes et d’ajuster l’espacement.

La liste peut être chargée : réduire le nombre de nœuds ou augmenter la valeur minimale aide à isoler les relations principales. « Reset view » recentre le graphe et réinitialise la sélection.