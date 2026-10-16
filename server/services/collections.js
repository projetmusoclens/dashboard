function normalizeCollectionName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Collecte inconnue';
  return value.trim().replace(/\s+/g, ' ');
}

function collectionKey(value) {
  return normalizeCollectionName(value).toLowerCase();
}

function mongoCollectionNameExpression() {
  const trimmed = {
    $trim: {
      input: {
        $convert: {
          input: '$collection_context.collection_name',
          to: 'string',
          onError: '',
          onNull: '',
        },
      },
    },
  };
  return { $cond: [{ $eq: [trimmed, ''] }, 'Collecte inconnue', trimmed] };
}

function mongoCollectionKeyExpression() {
  return { $toLower: mongoCollectionNameExpression() };
}

function groupCollections(posts) {
  const groups = new Map();

  posts.forEach((post) => {
    const context = post.collection_context && typeof post.collection_context === 'object'
      ? post.collection_context
      : {};
    const name = normalizeCollectionName(context.collection_name);
    const key = collectionKey(name);
    const group = groups.get(key) || { id: key, name, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });

  return Array.from(groups.values()).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

module.exports = {
  collectionKey,
  groupCollections,
  mongoCollectionKeyExpression,
  mongoCollectionNameExpression,
  normalizeCollectionName,
};