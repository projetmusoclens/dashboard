function normalizeCollectionName(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Collecte inconnue';
  return value.trim().replace(/\s+/g, ' ');
}

// Événement auquel une collecte se rattache (collection_context.event), '' s'il n'est pas renseigné.
function eventName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function collectionKey(value) {
  return normalizeCollectionName(value).toLowerCase();
}

function groupCollections(posts) {
  const groups = new Map();

  posts.forEach((post) => {
    const context = post.collection_context && typeof post.collection_context === 'object'
      ? post.collection_context
      : {};
    const name = normalizeCollectionName(context.collection_name);
    const key = collectionKey(name);
    const group = groups.get(key) || { id: key, name, count: 0, event: '', first_at: null };
    group.count += 1;
    group.event = group.event || eventName(context.event);
    // Début de la collecte : plus fiable que la date des posts (certains flux contiennent des dates aberrantes).
    const time = context.started_at || post.timestamp || post.createdAt || null;
    if (time && (!group.first_at || String(time) < group.first_at)) group.first_at = String(time);
    groups.set(key, group);
  });

  return Array.from(groups.values()).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

module.exports = {
  collectionKey,
  eventName,
  groupCollections,
  normalizeCollectionName,
};