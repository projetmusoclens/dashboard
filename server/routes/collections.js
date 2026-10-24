const {
  eventName,
  groupCollections,
  mongoCollectionKeyExpression,
  mongoCollectionNameExpression,
} = require('../services/collections');

function registerCollectionRoutes(app, { getDataSource, safeHandler }) {
  app.get('/api/collections', safeHandler(async (req, res) => {
    const dataSource = getDataSource();
    if (dataSource.mode === 'none') return res.json({ field: null, collections: [] });
    if (dataSource.mode === 'archive') {
      return res.json({ field: 'collection_context.collection_name', collections: groupCollections(dataSource.posts) });
    }

    const results = await dataSource.db.collection('posts').aggregate([
      { $project: { name: mongoCollectionNameExpression(), key: mongoCollectionKeyExpression(), event: '$collection_context.event', started: { $ifNull: ['$collection_context.started_at', '$timestamp'] } } },
      // event : événement de la collecte (collection_context.event) ; first_at : début de la collecte
      // (collection_context.started_at, sinon premier post), pour ordonner les événements.
      { $group: { _id: '$key', name: { $min: '$name' }, count: { $sum: 1 }, event: { $max: '$event' }, first_at: { $min: '$started' } } },
      { $sort: { count: -1, name: 1 } },
    ]).toArray();
    const collections = results.map((item) => ({ id: String(item._id), name: String(item.name), count: item.count, event: eventName(item.event), first_at: item.first_at ? String(item.first_at) : null }));
    return res.json({ field: 'collection_context.collection_name', collections });
  }));
}

module.exports = { registerCollectionRoutes };