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

## Serveur OVH (API et base sur le même serveur)

Alternative à Render + Atlas : l’API et MongoDB tournent sur un serveur Ubuntu (VPS OVH, 4 vCPU, 7,6 Go de mémoire), dans Docker. Le frontend reste sur Vercel. Les fichiers sont dans `deploy/ovh/` :

| Fichier | Rôle |
| --- | --- |
| `docker-compose.yml` | Trois conteneurs : `mongo` (MongoDB 7, aucun port publié), `api` (Express), `caddy` (HTTPS automatique, seuls ports ouverts : 80 et 443). |
| `Dockerfile` | Image de l’API : `server/` et ses cinq dépendances (express, mongodb, cors, compression, dotenv) aux versions du `package-lock.json`. |
| `Caddyfile` | Certificat Let’s Encrypt pour `API_DOMAIN` et relais vers l’API. |
| `mongo-init.sh` | À la création de la base, crée l’utilisateur de l’API (`readWrite` sur `worldcup2026` seulement). |
| `.env.example` | Variables à copier dans `deploy/ovh/.env` (secrets, jamais committé). |
| `backup.sh` / `update.sh` | Sauvegarde quotidienne de la base (signalée à Healthchecks.io) ; mise à jour de l’API après un push. |
| `monitor.sh` | Surveillance toutes les 5 minutes (disque, mémoire, conteneurs, API, certificat, sauvegarde), résultat envoyé à Healthchecks.io. |

```mermaid
flowchart LR
    U[Navigateur] -- "page et JS" --> V[Vercel]
    U -- "HTTPS /api/*" --> C[Caddy :443]
    subgraph OVH [Serveur OVH · Docker]
      C --> A[API Express :5055]
      A --> M[(MongoDB :27017<br/>réseau interne)]
    end
```

Sans nom de domaine, l’adresse `145-239-80-211.sslip.io` pointe d’elle-même vers l’IP du serveur et reçoit un vrai certificat. Avec un domaine (par ex. `api.mondomaine.fr`), créez un enregistrement DNS `A` vers `145.239.80.211` et mettez ce nom dans `API_DOMAIN`.

### 1. Préparer le serveur (une fois)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER        # puis se déconnecter / reconnecter
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw --force enable
```

Le pare-feu n’est qu’une précaution : MongoDB et l’API ne publient aucun port, Docker n’expose que 80 et 443.

### 2. Récupérer le code et remplir `.env`

```bash
git clone https://github.com/projetmusoclens/dashboard.git ~/dashboard
cd ~/dashboard/deploy/ovh
cp .env.example .env
openssl rand -hex 24   # à lancer deux fois : MONGO_ROOT_PASSWORD et MONGO_APP_PASSWORD
nano .env
chmod 600 .env
```

Le dépôt étant privé, `git clone` demande un identifiant GitHub et un *personal access token* (lecture seule sur ce dépôt), ou utilisez une clé de déploiement SSH. Dans `.env`, reprenez `AUTH_SECRET` de Render pour que personne ne soit déconnecté. Les mots de passe ne doivent contenir que des lettres et des chiffres (ils sont placés dans une URI).

### 3. Démarrer

```bash
docker compose up -d --build
docker compose ps                 # mongo « healthy », api et caddy « running »
docker compose logs -f api        # « MongoDB connected » puis « Backend server listening »
curl https://145-239-80-211.sslip.io/api/health   # {"ok":true,"database":"worldcup2026"}
```

Au premier démarrage, la base est vide : l’API indique qu’aucun compte n’existe. C’est normal avant l’étape suivante.

### 4. Copier les données depuis Atlas

Dans Atlas → **Network Access**, autorisez l’IP `145.239.80.211` (si `0.0.0.0/0` n’y est pas déjà). Puis, sur le serveur :

```bash
cd ~/dashboard/deploy/ovh
docker run --rm mongo:7.0 mongodump --uri "mongodb+srv://UTILISATEUR:MOTDEPASSE@cluster0.0jkgmb4.mongodb.net/worldcup2026" --archive --gzip > atlas.archive.gz
set -a; source .env; set +a
docker compose exec -T mongo mongorestore -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --nsInclude 'worldcup2026.*' --drop --archive --gzip < atlas.archive.gz
docker compose restart api
rm atlas.archive.gz
```

La copie contient les posts, les comptes, les annotations et le cache des profils Bluesky : les identifiants restent les mêmes. Les index sont restaurés avec les données ; ceux qui manqueraient sont créés au démarrage de l’API.

### 5. Basculer le frontend

Sur Vercel, remplacez `REACT_APP_API_BASE_URL` par `https://145-239-80-211.sslip.io` (sans `/` final), puis **Redeploy**. Vérifiez la connexion et les onglets. Gardez Render et Atlas quelques jours le temps de valider, puis arrêtez-les : les annotations saisies entre-temps ne seraient écrites que sur OVH.

### Importer de nouveaux posts

Exemple : l'export de quartz (`worldcup2026_twitter.archive.gz`, 3,8 millions de posts Twitter), chargé en local dans la base `quartz_import`, sans l'événement France – Paraguay (déjà en ligne) ni la collecte de test `twitter_test_cron_live`.

1. **Sur votre machine**, exporter les posts à envoyer (environ 2 Go) :
   ```bash
   mongodump --db quartz_import --collection posts \
     --query '{"collection_context.event": {"$nin": ["france_paraguay", "twitter_test_cron_live"]}}' \
     --archive=quartz_sans_frapar.archive.gz --gzip
   scp quartz_sans_frapar.archive.gz ubuntu@145.239.80.211:dashboard/deploy/ovh/backups/
   ```
2. **Sur le serveur**, après avoir déployé la version du code qui contient `post_facts` (`update.sh`), sauvegarder puis importer **sans `--drop`** (les comptes, les annotations et les posts déjà présents ne sont pas touchés) :
   ```bash
   cd ~/dashboard/deploy/ovh
   ./backup.sh
   set -a; source .env; set +a
   docker compose exec -T mongo mongorestore -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
     --nsFrom 'quartz_import.posts' --nsTo 'worldcup2026.posts' --archive --gzip < backups/quartz_sans_frapar.archive.gz
   ```
   Les posts déjà en base ont le même `_id` : `mongorestore` les refuse (`duplicate key`) et les compte en « failed ». C'est attendu, il n'y a pas de doublon.
3. **Laisser l'API reconstruire `post_facts`** : elle attend que le nombre de posts ne bouge plus entre deux vérifications (5 à 10 minutes après la fin de l'import), ou reconstruit tout de suite avec `docker compose restart api`. Le site reste utilisable avec les anciennes données pendant la reconstruction (10 à 20 minutes pour 3,8 millions de posts), puis passe d'un coup aux nouvelles. Suivre l'avancement :
   ```bash
   docker compose logs -f api | grep -E "post_facts|préchargées"
   ```
   La fin est marquée par `post_facts reconstruit : … posts` puis `Vues principales préchargées`.
4. Supprimer l'archive importée du serveur (`rm backups/quartz_sans_frapar.archive.gz`) : la sauvegarde de l'étape 2 suffit.

### Sauvegardes

`backup.sh` enregistre la base dans `deploy/ovh/backups/` et garde 14 jours. À programmer avec `crontab -e` :

```
0 3 * * * /home/ubuntu/dashboard/deploy/ovh/backup.sh >> /home/ubuntu/backup.log 2>&1
```

Les sauvegardes restent sur le serveur : copiez-les régulièrement ailleurs (`scp ubuntu@145.239.80.211:dashboard/deploy/ovh/backups/*.gz .`) ou activez les sauvegardes du VPS chez OVH. Restauration : même commande `mongorestore` que ci-dessus, avec le fichier de sauvegarde.

### Surveillance et alertes

Trois niveaux, avec alertes par e-mail :

| Niveau | Outil | Ce qui est vérifié | Délai d'alerte |
|---|---|---|---|
| De l'extérieur | **UptimeRobot** (gratuit) | `https://145-239-80-211.sslip.io/api/health` répond et contient `"mongo":"ok"` : serveur, réseau, HTTPS, API et MongoDB | ~5 min |
| Sur le serveur | **`monitor.sh`** (cron, toutes les 5 min) → **Healthchecks.io** (gratuit) | disque (≥ 85 %), mémoire disponible (< 300 Mo), conteneurs arrêtés, `unhealthy` ou qui redémarrent, API en HTTPS, MongoDB, certificat (< 14 jours), sauvegarde de moins de 26 h | ~5 à 10 min ; si le serveur s'arrête, Healthchecks.io ne reçoit plus de signal et prévient aussi |
| Sauvegarde | **`backup.sh`** → Healthchecks.io | sauvegarde de la nuit réussie (archive de plus de 1 Mo) | le matin |

`/api/health` répond `503` si MongoDB ne répond pas ou n'a pas pu être joint au démarrage, et indique l'état des statistiques (`"facts": "ready"`, `"building"` pendant une reconstruction). Docker vérifie aussi l'API toutes les 30 s (`healthcheck` du conteneur `api`) et les journaux des conteneurs sont limités à 100 Mo chacun.

**Mise en place (une fois)**

1. **Healthchecks.io** : créer un compte sur healthchecks.io (l'adresse e-mail du compte reçoit les alertes), puis deux « checks » :
   - « OVH surveillance » : *Period* 5 minutes, *Grace* 10 minutes ;
   - « OVH sauvegarde » : *Period* 1 day, *Grace* 2 hours.

   Copier l'adresse de ping de chacun (`https://hc-ping.com/…`) dans `deploy/ovh/.env` :
   ```
   HC_MONITOR_URL=https://hc-ping.com/<adresse du check surveillance>
   HC_BACKUP_URL=https://hc-ping.com/<adresse du check sauvegarde>
   ```
   Ces adresses sont des secrets légers : quiconque les connaît peut envoyer de faux signaux. Elles restent dans `.env`.
2. **UptimeRobot** : créer un compte sur uptimerobot.com, puis *New monitor* → type *Keyword*, URL `https://145-239-80-211.sslip.io/api/health`, mot-clé `"mongo":"ok"` (alerte si absent), intervalle 5 minutes, alerte par e-mail. Optionnel : un second moniteur HTTP sur l'adresse du site Vercel.
3. **Sur le serveur**, appliquer la nouvelle configuration Docker (journaux limités, santé de l'API ; quelques secondes de coupure) puis programmer les tâches :
   ```bash
   cd ~/dashboard/deploy/ovh
   git pull --ff-only && docker compose up -d --build
   ./backup.sh                  # première sauvegarde (sinon monitor.sh signale son absence)
   ./monitor.sh                 # premier essai : doit afficher « OK · disque … »
   crontab -e
   ```
   et, dans la crontab :
   ```
   */5 * * * * /home/ubuntu/dashboard/deploy/ovh/monitor.sh >> /home/ubuntu/monitor.log 2>&1
   0 3 * * * /home/ubuntu/dashboard/deploy/ovh/backup.sh >> /home/ubuntu/backup.log 2>&1
   ```
4. **Mises à jour de sécurité d'Ubuntu** : vérifier qu'elles s'installent seules (`systemctl is-enabled unattended-upgrades` → `enabled`), sinon `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

**En cas d'alerte** : le message Healthchecks.io contient la liste des problèmes et l'état du serveur. Sur le serveur : `tail -20 ~/monitor.log`, `docker compose ps`, `docker compose logs --tail 50 api`, `df -h /`. Les seuils se règlent dans `.env` (`MONITOR_DISK_MAX_PERCENT`, `MONITOR_MEMORY_MIN_MB`, `MONITOR_CERT_MIN_DAYS`, `MONITOR_BACKUP_MAX_HOURS`). Pendant une maintenance, mettre les checks en pause dans Healthchecks.io et UptimeRobot.

### Mettre à jour

Après un `git push` sur `main`, Vercel se met à jour seul. Sur le serveur :

```bash
~/dashboard/deploy/ovh/update.sh
```

Le script récupère le code, reconstruit l’API et la redémarre (quelques secondes d’interruption). MongoDB et Caddy ne sont pas touchés.

## Limites connues

- **Mise en veille** : en offre gratuite, Render arrête l’API après environ 15 minutes sans trafic. Le premier appel suivant prend 30 à 60 secondes ; l’écran de connexion l’indique.
- **Mémoire** : l’instance gratuite dispose de 512 Mo. Une route qui charge toute la collection en mémoire fait tomber le service (`502`). Les graphes sont donc calculés en flux : l’onglet Graphes ne charge que le nombre de nœuds demandé (300 par défaut, 5 000 au plus), à son ouverture, et les réponses sont compressées. L’onglet Threads utilise `/api/conversations`, paginé (quelques dizaines de Ko) ; l’ancienne route `/api/threads` (environ 33 Mo) n’est plus appelée par le frontend.
- **URL de déploiement Vercel** : chaque déploiement reçoit aussi une adresse unique (`dashboard-<identifiant>-musoc-lens.vercel.app`). Elle n’est pas dans `ALLOWED_ORIGINS` et l’API y paraît injoignable : utilisez l’adresse de branche ou le domaine de production.

- **Noms des comptes Bluesky** : l’API Render interroge `public.api.bsky.app` (sans compte) pour les noms et avatars, mis en cache 7 jours dans la collection `bluesky_profiles`. Si Bluesky ne répond pas, les comptes restent affichés avec leur identifiant (`did:plc:…`) ; rien ne bloque.

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
