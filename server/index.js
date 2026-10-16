const express = require('express');
const cors = require('cors');
const { MONGO_DB_NAME, connectMongo, getDataSource, getDb } = require('./db/data-source');
const { normalizePost } = require('./services/normalization');
const { buildGraphFromPosts, buildStatsFromPosts, buildThreads } = require('./services/analytics');
const { buildMatchFromQuery } = require('./services/query');
const { registerAnalyticsRoutes } = require('./routes/analytics');
const { registerCollectionRoutes } = require('./routes/collections');
const { registerPostRoutes } = require('./routes/posts');

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

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: MONGO_DB_NAME });
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
