// Noms et avatars des comptes Bluesky : la base ne contient que leur DID (did:plc:…).
// Ils sont demandés à l'API publique de Bluesky (sans compte, 25 comptes par appel) puis gardés
// en cache : en mémoire et, si MongoDB est disponible, dans la collection bluesky_profiles.

const PROFILES_URL = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles';
const BATCH_SIZE = 25;
const PARALLEL_BATCHES = 4;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Au-delà, la réponse part sans les profils manquants ; ils seront prêts à l'appel suivant.
const DEFAULT_WAIT_MS = 2500;

const isDid = (value) => typeof value === 'string' && value.startsWith('did:');

function createProfileResolver({ getDb = () => null, fetchImpl = (...args) => fetch(...args), now = Date.now, waitMs = DEFAULT_WAIT_MS } = {}) {
  const memory = new Map();
  const pending = new Map();

  const fresh = (entry) => entry && now() - entry.at < CACHE_TTL_MS;

  async function fetchBatch(dids) {
    const query = dids.map((did) => `actors=${encodeURIComponent(did)}`).join('&');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetchImpl(`${PROFILES_URL}?${query}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Bluesky API ${res.status}`);
      const body = await res.json();
      const found = new Map((body.profiles || []).map((profile) => [profile.did, {
        handle: profile.handle && profile.handle !== 'handle.invalid' ? profile.handle : null,
        display_name: profile.displayName || null,
        avatar: profile.avatar || null,
      }]));
      // Un compte supprimé n'est pas renvoyé : on le mémorise comme inconnu pour ne pas le redemander.
      const at = now();
      const entries = dids.map((did) => [did, { profile: found.get(did) || null, at }]);
      entries.forEach(([did, entry]) => memory.set(did, entry));
      const db = getDb();
      if (db) {
        await db.collection('bluesky_profiles').bulkWrite(entries.map(([did, entry]) => ({
          replaceOne: { filter: { _id: did }, replacement: { _id: did, ...entry.profile, missing: !entry.profile, fetched_at: entry.at }, upsert: true },
        })), { ordered: false }).catch(() => {});
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadFromDb(dids) {
    const db = getDb();
    if (!db || !dids.length) return;
    const docs = await db.collection('bluesky_profiles').find({ _id: { $in: dids } }).toArray().catch(() => []);
    docs.forEach((doc) => {
      memory.set(doc._id, { profile: doc.missing ? null : { handle: doc.handle || null, display_name: doc.display_name || null, avatar: doc.avatar || null }, at: doc.fetched_at || 0 });
    });
  }

  async function fetchMissing(dids) {
    const batches = [];
    for (let index = 0; index < dids.length; index += BATCH_SIZE) batches.push(dids.slice(index, index + BATCH_SIZE));
    for (let index = 0; index < batches.length; index += PARALLEL_BATCHES) {
      await Promise.all(batches.slice(index, index + PARALLEL_BATCHES).map((batch) => fetchBatch(batch).catch((error) => {
        console.warn('Profils Bluesky indisponibles :', error?.message || error);
      })));
    }
  }

  // Profils connus pour ces DID ; ceux qui manquent sont demandés à Bluesky dans la limite de waitMs.
  async function resolve(values) {
    const dids = [...new Set(values.filter(isDid))];
    if (!dids.length) return new Map();
    await loadFromDb(dids.filter((did) => !fresh(memory.get(did))));
    const missing = dids.filter((did) => !fresh(memory.get(did)) && !pending.has(did));
    if (missing.length) {
      const job = fetchMissing(missing).finally(() => missing.forEach((did) => pending.delete(did)));
      missing.forEach((did) => pending.set(did, job));
    }
    const waiting = [...new Set(dids.map((did) => pending.get(did)).filter(Boolean))];
    if (waiting.length) await Promise.race([Promise.all(waiting), new Promise((resolveWait) => setTimeout(resolveWait, waitMs))]);
    return new Map(dids.map((did) => [did, memory.get(did)?.profile || null]));
  }

  const authorDid = (post) => (post?.platform === 'bluesky' ? [post.author_id, post.author_handle].find(isDid) || null : null);

  // Ajoute author_profile aux posts Bluesky.
  async function enrichPosts(posts) {
    const list = posts.filter(Boolean);
    const profiles = await resolve(list.map(authorDid).filter(Boolean));
    list.forEach((post) => {
      const did = authorDid(post);
      if (did) post.author_profile = profiles.get(did) || null;
    });
    return posts;
  }

  // Libellés lisibles pour les nœuds « @did:… » du graphe des mentions.
  async function labelGraphNodes(nodes) {
    const profiles = await resolve(nodes.map((node) => node.id.replace(/^@/, '')));
    nodes.forEach((node) => {
      const profile = profiles.get(node.id.replace(/^@/, ''));
      if (profile?.handle) node.label = `@${profile.handle}`;
    });
    return nodes;
  }

  return { resolve, enrichPosts, labelGraphNodes };
}

module.exports = { createProfileResolver, isDid };
