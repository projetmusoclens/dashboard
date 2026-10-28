const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const { MONGO_DB_NAME, connectMongo, getDataSource, getDb } = require('./db/data-source');
const { normalizePost } = require('./services/normalization');
const { buildStatsFromPosts } = require('./services/analytics');
const { buildFactsMatch } = require('./services/query');
const { createResponseCache } = require('./services/responseCache');
const { createFactsManager } = require('./services/factsManager');
const { bootstrapAdmin, createMemoryStore, createMongoStore } = require('./services/accounts');
const { registerAnalyticsRoutes } = require('./routes/analytics');
const { registerCollectionRoutes } = require('./routes/collections');
const { registerPostRoutes } = require('./routes/posts');
const { registerConversationRoutes } = require('./routes/conversations');
const { registerAccountRoutes, registerPublicAuthRoutes } = require('./routes/accounts');
const { registerEventSheetRoutes } = require('./routes/eventSheets');
const { createFailureLimiter, createUserAuth } = require('./middleware/auth');
const { createProfileResolver } = require('./services/blueskyProfiles');

const app = express();
const PORT = process.env.PORT || 5000;

function safeHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

// Sans AUTH_SECRET fixe, les sessions sont perdues à chaque redémarrage de l'API.
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET) console.warn('AUTH_SECRET not set; sessions will not survive a restart.');
if (process.env.DASHBOARD_PASSWORD) console.warn('DASHBOARD_PASSWORD is no longer used: access now relies on user accounts.');

// Comptes et annotations : MongoDB si disponible, sinon mémoire (choisi après la connexion).
let accountStore = createMemoryStore();
const getStore = () => accountStore;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);

// Render place un proxy devant l'application : req.ip doit venir de son en-tête.
app.set('trust proxy', 1);
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : undefined));
// Réponses JSON compressées (gzip) : les graphes et listes pèsent environ dix fois moins à transférer.
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// État de l'API pour la surveillance (UptimeRobot, monitor.sh) : publique, rapide, sans données.
// 503 si MongoDB ne répond pas ou n'a pas pu être joint au démarrage ; « facts » indique si les statistiques sont prêtes ou en reconstruction.
const HEALTH_TIMEOUT_MS = 3000;
app.get('/api/health', async (req, res) => {
  const database = getDb();
  let mongo = 'absent';
  if (database) {
    const timeout = new Promise((resolve) => { setTimeout(() => resolve('timeout'), HEALTH_TIMEOUT_MS).unref(); });
    mongo = await Promise.race([database.command({ ping: 1 }).then(() => 'ok', () => 'error'), timeout]);
  }
  // « absent » : MongoDB injoignable au démarrage, comptes et annotations en mémoire seulement.
  const ok = mongo === 'ok';
  res.status(ok ? 200 : 503).json({
    ok,
    database: MONGO_DB_NAME,
    mongo,
    facts: facts.building() ? 'building' : facts.ready() ? 'ready' : 'pending',
    uptime_s: Math.round(process.uptime()),
  });
});

registerPublicAuthRoutes(app, { getStore, secret: AUTH_SECRET, limiter: createFailureLimiter(), safeHandler });

const userAuth = createUserAuth({ getStore, secret: AUTH_SECRET });
app.use('/api', userAuth);

app.get('/api/auth/check', (req, res) => {
  res.json({ ok: true });
});

async function findPostsByIds(ids) {
  if (!ids.length) return [];
  const dataSource = getDataSource();
  if (dataSource.mode === 'archive') {
    const wanted = new Set(ids);
    return dataSource.posts.filter((post) => wanted.has(String(post.post_id)));
  }
  if (dataSource.mode !== 'db') return [];
  const posts = await dataSource.db.collection('posts').find({ post_id: { $in: ids } }, { projection: { raw_json: 0 } }).toArray();
  return posts.map(normalizePost);
}

// Base des posts (MongoDB) pour post_facts ; null en mode archive ou sans base.
const getPostsDb = () => { const dataSource = getDataSource(); return dataSource.mode === 'db' ? dataSource.db : null; };
const cache = createResponseCache();
let warmRoutes = async () => {};
const facts = createFactsManager({ getDb: getPostsDb, cache, warm: () => warmRoutes() });

const routeDependencies = {
  getDataSource,
  getDb,
  normalizePost,
  buildStatsFromPosts,
  buildFactsMatch,
  cache,
  facts,
  safeHandler,
  databaseName: MONGO_DB_NAME,
  getStore,
  userAuth,
  findPostsByIds,
  profiles: createProfileResolver({ getDb }),
};

registerAccountRoutes(app, routeDependencies);
const analyticsRoutes = registerAnalyticsRoutes(app, routeDependencies);
const collectionRoutes = registerCollectionRoutes(app, routeDependencies);
// Préchargement après chaque reconstruction de post_facts : liste des collectes, statistiques et courbe sans filtre.
warmRoutes = async () => {
  const db = getPostsDb();
  if (!db) return;
  const started = Date.now();
  const collections = await collectionRoutes.warm(db);
  // Une sélection par événement, comme quand on coche un match dans le filtre.
  const events = new Map();
  collections.forEach((collection) => { if (collection.event) events.set(collection.event, [...(events.get(collection.event) || []), collection.id]); });
  await analyticsRoutes.warm(db, Array.from(events.values()).map((ids) => ({ collectionId: [...ids].sort().join(',') })));
  await conversationRoutes.warm(db);
  console.log(`Vues principales préchargées en ${Math.round((Date.now() - started) / 1000)} s.`);
};
registerPostRoutes(app, routeDependencies);
const conversationRoutes = registerConversationRoutes(app, routeDependencies);
registerEventSheetRoutes(app, routeDependencies);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

connectMongo().then(async () => {
  const db = getDb();
  if (db) {
    accountStore = createMongoStore(db);
    try {
      await accountStore.init();
    } catch (error) {
      console.warn('Index des comptes non créés (droits en écriture ?) :', error?.message || error);
    }
  } else {
    console.warn('No MongoDB: user accounts and annotations are kept in memory and lost on restart.');
  }
  // Un échec ici (droits Atlas en lecture seule, par exemple) ne doit pas empêcher l'API de démarrer.
  try {
    await bootstrapAdmin(accountStore, { username: (process.env.ADMIN_USERNAME || '').trim().toLowerCase(), password: process.env.ADMIN_PASSWORD, name: process.env.ADMIN_NAME });
  } catch (error) {
    console.error(`Administrateur initial non créé : ${error?.message || error}. `
      + 'Vérifiez que l’utilisateur MongoDB de l’API a le rôle readWrite sur la base ; sans écriture, personne ne peut se connecter ni annoter.');
  }

  const server = app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
  });
  // post_facts : construit ou reconstruit en tâche de fond si les posts ont changé, puis vérifié régulièrement.
  if (getPostsDb()) facts.start();

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} already in use; server may already be running. Exiting.`);
      process.exit(0);
    }
    console.error('Server error:', error);
    process.exit(1);
  });
}).catch((error) => {
  console.error('Failed to connect MongoDB:', error);
  process.exit(1);
});
