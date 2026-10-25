const { groupCollections } = require('../services/collections');
const { FACTS } = require('../services/facts');

const PREPARING = 'Les données sont en cours de préparation sur le serveur. Réessayez dans quelques minutes.';

// Collectes avec leur volume, leur événement (collection_context.event) et leur début
// (collection_context.started_at, sinon premier post), pour ordonner les événements.
async function factsCollections(db) {
  const results = await db.collection(FACTS).aggregate([
    { $group: {
      _id: '$collection_key',
      name: { $min: '$collection_name' },
      count: { $sum: 1 },
      event: { $max: '$event' },
      first_at: { $min: { $ifNull: ['$started_at', '$timestamp'] } },
    } },
    { $sort: { count: -1, name: 1 } },
  ], { allowDiskUse: true }).toArray();
  return results.map((item) => ({ id: String(item._id), name: String(item.name), count: item.count, event: item.event || '', first_at: item.first_at ? String(item.first_at) : null }));
}

function registerCollectionRoutes(app, { getDataSource, safeHandler, cache, facts }) {
  const collectionsFor = (db) => cache.get('collections', {}, () => factsCollections(db));

  app.get('/api/collections', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ field: null, collections: [] });
    if (dataSource.mode === 'archive') {
      return res.json({ field: 'collection_context.collection_name', collections: groupCollections(dataSource.posts) });
    }
    if (!facts.ready()) return res.status(503).json({ error: PREPARING, preparing: true });
    return res.json({ field: 'collection_context.collection_name', collections: await collectionsFor(dataSource.db) });
  }));

  return { warm: (db) => collectionsFor(db) };
}

module.exports = { registerCollectionRoutes };
