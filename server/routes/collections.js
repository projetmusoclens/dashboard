const {
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
      { $project: { name: mongoCollectionNameExpression(), key: mongoCollectionKeyExpression() } },
      { $group: { _id: '$key', name: { $min: '$name' }, count: { $sum: 1 } } },
      { $sort: { count: -1, name: 1 } },
    ]).toArray();
    const collections = results.map((item) => ({ id: String(item._id), name: String(item.name), count: item.count }));
    return res.json({ field: 'collection_context.collection_name', collections });
  }));
}

module.exports = { registerCollectionRoutes };