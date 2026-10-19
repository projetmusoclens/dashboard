# Déploiement

Le dashboard en ligne repose sur trois services distincts : le frontend React sur Vercel, l’API Express sur Render et la base MongoDB sur Atlas. Les données ne sont stockées ni dans le dépôt ni sur Vercel : elles vivent uniquement dans Atlas et sont servies par l’API, accessible uniquement avec un compte utilisateur.

## Vue d’ensemble

```mermaid
flowchart LR
    U[Navigateur] -- "1. page et JS (statique)" --> V[Vercel<br/>frontend React]
    U -- "2. /api/* + Authorization: Bearer &lt;jeton de session&gt;" --> R[Render<br/>API Express]
    R -- "3. MONGO_URI" --> A[(MongoDB Atlas<br/>worldcup2026)]
```

1. Vercel ne sert que des fichiers statiques (HTML, JS, CSS) produits par `npm run build`. Il ne contient ni données ni secret.
2. Le navigateur appelle directement l’API Render, à l’adresse compilée dans `REACT_APP_API_BASE_URL`. Chaque appel porte le jeton de session obtenu à la connexion.
3. L’API vérifie le jeton, interroge Atlas et renvoie du JSON.

| Service | Rôle | Adresse | Offre |
| --- | --- | --- | --- |
| Vercel | Frontend React (Create React App) | `https://dashboard-git-main-musoc-lens.vercel.app` | Hobby |
| Render | API Express (`server/`), Web Service Node | `https://dashboard-g3eg.onrender.com` | Free |
| MongoDB Atlas | Base `worldcup2026` : `posts`, `users`, `annotations` | `cluster0.0jkgmb4.mongodb.net` | M0 (gratuit) |
| GitHub | Code source uniquement, sans données | `projetmusoclens/dashboard` | — |

Vercel et Render sont reliés au dépôt GitHub : un `git push` sur `main` redéploie automatiquement les deux.

## Configuration

### Vercel (frontend)

| Réglage | Valeur |
| --- | --- |
| Framework preset | Create React App |
| Build command | `npm run build` |
| Output directory | `build` |

| Variable | Valeur | Remarque |
| --- | --- | --- |
| `REACT_APP_API_BASE_URL` | `https://dashboard-g3eg.onrender.com` | Sans `/` final. Publique par nature (type « Config ») : elle est intégrée au JavaScript au moment du build, toute modification exige un **Redeploy**. |

Aucune autre variable ne doit être déclarée sur Vercel. En particulier, `MONGO_URI`, `AUTH_SECRET` et `ADMIN_PASSWORD` n’y ont pas leur place : toute variable `REACT_APP_*` est lisible par n’importe quel visiteur.

Le fichier `.vercelignore` exclut par sécurité les dumps (`*.bson`, `*.gz`, `data_final/`), `server/` et les fichiers `.env` de tout envoi vers Vercel.

### Render (API)

| Réglage | Valeur |
| --- | --- |
| Type de service | **Web Service** (un Static Site ne peut pas exécuter Express) |
| Language | Node |
| Branch | `main` |
| Build command | `npm install` |
| Start command | `npm run server` |

| Variable | Rôle |
| --- | --- |
| `MONGO_URI` | URI Atlas `mongodb+srv://utilisateur:motdepasse@cluster0…/`. Secret. |
| `MONGO_DB_NAME` | `worldcup2026` |
| `AUTH_SECRET` | Clé de signature des sessions : longue chaîne aléatoire (par ex. `openssl rand -hex 32`). Secret. La changer déconnecte tout le monde ; sans elle, chaque redémarrage (y compris après la mise en veille) déconnecte les utilisateurs. |
| `ADMIN_USERNAME` | Identifiant du premier administrateur (minuscules, chiffres, `.`, `_`, `-`). |
| `ADMIN_PASSWORD` | Mot de passe du premier administrateur (8 caractères minimum). Secret. Utilisé seulement si la collection `users` est vide ; peut être retiré ensuite. |
| `ADMIN_NAME` | Nom affiché du premier administrateur (facultatif). |
| `ALLOWED_ORIGINS` | Domaines du frontend autorisés par CORS, séparés par des virgules, sans `/` final. |
| `NODE_VERSION` | `22` |

`PORT` est fourni par Render ; ne pas le définir. Modifier une variable redémarre le service.

### MongoDB Atlas (base)

- **Database Access** : un utilisateur dédié à l’API, avec lecture/écriture sur `worldcup2026`. L’écriture est nécessaire pour les comptes, les annotations et la création automatique des index.
- **Network Access** : `0.0.0.0/0`, car l’IP sortante de Render n’est pas fixe en offre gratuite. L’accès reste conditionné à l’utilisateur et au mot de passe.

Import ou réimport des données, depuis un poste qui possède le dump (jamais depuis le dépôt) :

```bash
mongorestore --uri="mongodb+srv://UTILISATEUR:MOTDEPASSE@cluster0.0jkgmb4.mongodb.net/" \
  --db=worldcup2026 /chemin/vers/heimdall_dump/worldcup2026
```

Vérifiez ensuite dans **Browse Collections** que `worldcup2026.posts` contient le nombre de documents attendu.

**Index** : au démarrage, l’API crée elle-même les index `posts.post_id`, `posts.reply_to_id`, `users.username` et `annotations.{user_id, platform, post_id}`. Si un index existe déjà, rien ne se passe ; il n’y a donc rien à faire au déploiement. Vérification : **Browse Collections → posts → Indexes**. Si les logs Render affichent « Index … non créé », l’utilisateur Atlas n’a pas les droits d’écriture : corrigez ses droits, ou créez les index à la main dans ce même écran (**Create Index**, `{ "post_id": 1 }` puis `{ "reply_to_id": 1 }`).

**Sauvegarde des annotations** : elles vivent dans la collection `annotations`. Un `mongorestore --drop` sur la base entière les supprimerait ; restreignez les réimports à la collection `posts` (`--nsInclude=worldcup2026.posts`).

## Sécurité

| Mesure | Où | Effet |
| --- | --- | --- |
| Comptes utilisateurs | `server/routes/accounts.js`, `server/middleware/auth.js`, `src/components/AuthGate.tsx` | Mots de passe hachés (scrypt), jetons de session signés (HMAC, 7 jours). Sans jeton valide, l’API répond `401`. Un compte désactivé ou dont le mot de passe est réinitialisé perd ses sessions. |
| Rôles | `server/middleware/auth.js` | Gestion des comptes et lecture des annotations de toute l’équipe réservées aux administrateurs (`403` sinon). |
| Limitation des essais | `server/middleware/auth.js` | 10 échecs de connexion depuis une même adresse bloquent celle-ci 15 minutes (`429`). |
| CORS restreint | `ALLOWED_ORIGINS` dans `server/index.js` | Seuls les domaines listés peuvent lire les réponses depuis un navigateur. |
| URI masquée dans les logs | `server/db/data-source.js` | Le log de connexion affiche `mongodb+srv://***@…`. |
| Aucune donnée dans git | `.gitignore`, `.vercelignore` | Dumps et `.env` exclus du dépôt et de Vercel. |

Le jeton de session est conservé dans le navigateur (`localStorage`) pendant 7 jours. Chacun a son compte : on peut retirer l’accès à une seule personne et savoir qui a annoté quoi.

**Premier déploiement avec les comptes** : sur Render, ajoutez `AUTH_SECRET`, `ADMIN_USERNAME` et `ADMIN_PASSWORD`, puis supprimez `DASHBOARD_PASSWORD` (il n’est plus lu). Au démarrage, les logs affichent `Administrateur initial « … » créé.` Connectez-vous avec ce compte et créez les autres dans l’onglet **Utilisateurs**. Les annotations faites auparavant dans un navigateur se récupèrent depuis l’Explorer (bouton « Les importer dans mon compte »).

**Gérer les comptes** : onglet **Utilisateurs** (administrateurs) pour créer un compte, changer un rôle, réinitialiser un mot de passe ou désactiver un accès. Chacun change son propre mot de passe via « Mon mot de passe ». Si plus aucun administrateur ne peut se connecter, videz la collection `users` dans Atlas (les annotations sont conservées) et redémarrez avec `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

**Déconnecter tout le monde** : changez `AUTH_SECRET` sur Render.

**Changer le mot de passe Atlas** : Atlas → Database Access → Edit Password, puis mettez à jour `MONGO_URI` sur Render.

## Mettre à jour le site

```bash
git add -A && git commit -m "…"
git push origin main
```

Vercel reconstruit le frontend et Render redémarre l’API, chacun en quelques minutes. Suivez l’avancement dans l’onglet **Deployments** de Vercel et **Logs** de Render. Un démarrage réussi de l’API affiche :

```
MongoDB connected to mongodb+srv://***@cluster0.0jkgmb4.mongodb.net/
Backend server listening on http://localhost:10000
```

Le message `No local archive found at …/wc2026_extract.gz` est normal en production.

Contrôles rapides après un déploiement :

- `https://dashboard-g3eg.onrender.com/api/health` → `{"ok":true,"database":"worldcup2026"}`
- `https://dashboard-g3eg.onrender.com/api/collections` → `{"error":"Connexion requise."}`
- le site Vercel affiche l’écran de connexion, puis le dashboard.

## Limites connues

- **Mise en veille** : en offre gratuite, Render arrête l’API après environ 15 minutes sans trafic. Le premier appel suivant prend 30 à 60 secondes ; l’écran de connexion l’indique.
- **Mémoire** : l’instance gratuite dispose de 512 Mo. Une route qui charge toute la collection en mémoire fait tomber le service (`502`). Les graphes sont donc calculés en flux et limités aux 300 nœuds les plus fréquents (`?maxNodes=`, 2 000 au plus). L’onglet Threads utilise `/api/conversations`, paginé (quelques dizaines de Ko) ; l’ancienne route `/api/threads` (environ 33 Mo) n’est plus appelée par le frontend.
- **URL de déploiement Vercel** : chaque déploiement reçoit aussi une adresse unique (`dashboard-<identifiant>-musoc-lens.vercel.app`). Elle n’est pas dans `ALLOWED_ORIGINS` et l’API y paraît injoignable : utilisez l’adresse de branche ou le domaine de production.

## Dépannage

| Symptôme | Cause probable | Correction |
| --- | --- | --- |
| `JSON.parse: unexpected character at line 1` | `REACT_APP_API_BASE_URL` absente : le frontend s’appelle lui-même et reçoit du HTML. | Définir la variable sur Vercel, puis Redeploy. |
| `404` sur `onrender.com//api/…` | `/` final dans `REACT_APP_API_BASE_URL`. | Le retirer (le code le tolère désormais). |
| `404` sur toutes les routes Render | Service créé en Static Site, ou mauvaise Start command, ou service pas encore démarré. | Web Service avec `npm run server`. |
| `502` et « CORS Missing Allow Origin » | L’API a planté (souvent la mémoire) ; la page d’erreur Render n’a pas d’en-tête CORS. | Lire les logs Render. |
| « Impossible de joindre le serveur » | API en redémarrage, ou domaine absent de `ALLOWED_ORIGINS`. | Réessayer ; sinon ajouter le domaine exact affiché dans la barre d’adresse. |
| « Connexion au serveur… » prolongé | API en veille. | Patienter jusqu’à une minute. |
| Dashboard à `0 posts` sans erreur | L’API ne joint pas Atlas et répond avec une liste vide. | Vérifier `MONGO_URI` et Network Access dans Atlas. |
| « Identifiant ou mot de passe incorrect » pour le premier admin | Le compte n’a pas été créé (collection `users` non vide, ou variables invalides). | Lire les logs Render au démarrage ; un administrateur existant peut réinitialiser le mot de passe. |
| Tout le monde est déconnecté après chaque mise en veille | `AUTH_SECRET` absent. | Définir `AUTH_SECRET` sur Render. |
