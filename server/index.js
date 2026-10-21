const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const { MONGO_DB_NAME, connectMongo, getDataSource, getDb } = require('./db/data-source');
const { normalizePost } = require('./services/normalization');
const { buildGraphFromPosts, buildStatsFromPosts } = require('./services/analytics');
const { buildMatchFromQuery } = require('./services/query');
const { bootstrapAdmin, createMemoryStore, createMongoStore } = require('./services/accounts');
const { registerAnalyticsRoutes } = require('./routes/analytics');
const { registerCollectionRoutes } = require('./routes/collections');
const { registerPostRoutes } = require('./routes/posts');
const { registerConversationRoutes } = require('./routes/conversations');
const { registerAccountRoutes, registerPublicAuthRoutes } = require('./routes/accounts');
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: MONGO_DB_NAME });
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

const routeDependencies = {
  getDataSource,
  getDb,
  normalizePost,
  buildStatsFromPosts,
  buildGraphFromPosts,
  buildMatchFromQuery,
  safeHandler,
  databaseName: MONGO_DB_NAME,
  getStore,
  userAuth,
  findPostsByIds,
  profiles: createProfileResolver({ getDb }),
};

registerAccountRoutes(app, routeDependencies);
registerAnalyticsRoutes(app, routeDependencies);
registerCollectionRoutes(app, routeDependencies);
registerPostRoutes(app, routeDependencies);
registerConversationRoutes(app, routeDependencies);

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
