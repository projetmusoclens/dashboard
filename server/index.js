const express = require('express');
const cors = require('cors');
const { MONGO_DB_NAME, connectMongo, getDataSource, getDb } = require('./db/data-source');
const { normalizePost } = require('./services/normalization');
const { buildGraphFromPosts, buildStatsFromPosts, buildThreads } = require('./services/analytics');
const { buildMatchFromQuery } = require('./services/query');
const { registerAnalyticsRoutes } = require('./routes/analytics');
const { registerCollectionRoutes } = require('./routes/collections');
const { registerPostRoutes } = require('./routes/posts');
const { createPasswordAuth } = require('./middleware/auth');

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

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (!process.env.DASHBOARD_PASSWORD) console.warn('DASHBOARD_PASSWORD not set; the API is open to everyone.');

// Render place un proxy devant l'application : req.ip doit venir de son en-tête.
app.set('trust proxy', 1);
app.use(cors(ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS } : undefined));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: MONGO_DB_NAME });
});

app.use('/api', createPasswordAuth(process.env.DASHBOARD_PASSWORD));

app.get('/api/auth/check', (req, res) => {
  res.json({ ok: true });
});

const routeDependencies = {
  getDataSource,
  getDb,
  normalizePost,
  buildStatsFromPosts,
  buildThreads,
  buildGraphFromPosts,
  buildMatchFromQuery,
  safeHandler,
  databaseName: MONGO_DB_NAME,
};

registerAnalyticsRoutes(app, routeDependencies);
registerCollectionRoutes(app, routeDependencies);
registerPostRoutes(app, routeDependencies);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

connectMongo().then(() => {
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
