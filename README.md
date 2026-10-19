# Heimdall · Dashboard World Cup 2026

Dashboard React et API Express pour explorer les publications MongoDB par collecte, plateforme, langue et période. Le backend expose les posts, statistiques, threads, séries temporelles et graphes hashtags/mentions.

## Prérequis

- Node.js 18 ou plus récent et npm.
- MongoDB 7 local ou Docker Desktop si la base n’est pas déjà disponible.
- MongoDB Database Tools (`mongorestore`) pour importer le dump fourni.

## Installation

```powershell
npm install
Copy-Item server/.env.example server/.env
```

Modifiez `server/.env` selon votre instance MongoDB. Exemple local :

```dotenv
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017
MONGO_DB_NAME=worldcup2026
ARCHIVE_DB_NAME=wc2026_archive
```

`MONGO_URI` peut contenir des identifiants. Ne commitez jamais `server/.env` et ne copiez pas sa valeur dans un ticket ou une capture d’écran. Le fichier d’exemple ne contient aucun secret.

## Démarrer MongoDB

Avec Docker Compose :

```powershell
docker compose -f docker-compose.yml up -d mongo
```

Adaptez l’URI et le nom de base si votre configuration diffère. L’import sans `--drop` conserve les documents qui ne sont pas dans le dump. Pour les réimports, vérifiez d’abord les conséquences d’une suppression ou d’un remplacement.

**À propos du dump inclus :** l’échantillon `posts.bson` vérifié dans ce dépôt contient 9 815 posts sans champ `collection_context`, et `collection_runs.bson` est vide. Ces posts seront donc regroupés sous « Collecte inconnue ». Pour voir les noms de collecte attendus, connectez le dashboard à la base qui contient `collection_context.collection_name` sur les documents. Le nombre de collectes est calculé depuis ces données et n’est pas codé en dur.

## Lancer l’application

Frontend et backend ensemble :

```powershell
npm run dev
```

Le frontend est disponible sur [http://localhost:3000](http://localhost:3000), l’API sur [http://localhost:5000](http://localhost:5000). Le proxy de développement React transmet `/api` au backend.

Pour lancer les processus séparément, utilisez deux terminaux : `npm run server` puis `npm start`.

Vérifiez le backend sur [http://localhost:5000/api/health](http://localhost:5000/api/health). La réponse confirme le nom de la base sans exposer l’URI de connexion.

L’accès au dashboard passe par des comptes utilisateurs. Au premier démarrage, définissez `ADMIN_USERNAME` et `ADMIN_PASSWORD` dans `server/.env` : l’API crée ce compte administrateur, avec lequel vous vous connectez puis créez les autres comptes dans l’onglet « Utilisateurs ». Comptes et annotations sont stockés dans MongoDB (collections `users` et `annotations`) ; sans MongoDB (archive seule), ils restent en mémoire et disparaissent au redémarrage.

### Variables d’environnement

| Variable | Emplacement | Rôle |
| --- | --- | --- |
| `PORT` | `server/.env` | Port Express, `5000` par défaut. |
| `MONGO_URI` | `server/.env` | URI de connexion MongoDB. `DATABASE_URL` reste accepté en alias. |
| `MONGO_DB_NAME` | `server/.env` | Base principale, `worldcup2026` par défaut. |
| `ARCHIVE_DB_NAME` | `server/.env` | Base temporaire pour une archive `wc2026_extract.gz` à la racine. |
| `AUTH_SECRET` | `server/.env` | Clé secrète de signature des sessions ; sans elle, les sessions sont perdues à chaque redémarrage. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `server/.env` | Premier administrateur, créé au démarrage si aucun compte n’existe. Ensuite, les comptes se gèrent dans l’onglet « Utilisateurs ». |
| `ALLOWED_ORIGINS` | `server/.env` | Origines autorisées par CORS, séparées par des virgules ; vide, toutes sont acceptées. |
| `REACT_APP_API_BASE_URL` | `.env.local` à la racine | Préfixe d’API hors proxy CRA ; laissez vide pour le développement local. |

Le backend lit son fichier `server/.env`; Create React App lit les variables frontend depuis la racine. Les variables `REACT_APP_*` sont publiques une fois compilées : n’y placez jamais de secret.

## Tests et production

```powershell
npm run test:server
npm test -- --watchAll=false
npm run build
```

`npm run build` produit le frontend dans `build/`. Le backend Express n’est pas inclus dans ce dossier : il doit être démarré séparément dans l’environnement de déploiement.

## Documentation

- [Guide utilisateur](docs/guide-utilisateur.md) : filtres, exploration des posts, threads et graphes.
- [Architecture et maintenance](docs/architecture.md) : rôle des modules, routes, agrégations et formats de données.
- [Déploiement](docs/deploiement.md) : Vercel, Render et MongoDB Atlas, variables, sécurité et dépannage.

To learn React, check out the [React documentation](https://reactjs.org/).
