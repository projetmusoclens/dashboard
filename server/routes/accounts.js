const {
  cleanAnnotation, createToken, hashPassword, publicUser, validateUserInput, verifyPassword,
} = require('../services/accounts');
const { requireAdmin } = require('../middleware/auth');

const PLATFORMS = ['twitter', 'bluesky'];
const MAX_IMPORT = 5000;
const publicProfile = (user) => ({ id: String(user.id), username: user.username, name: user.name || user.username });

// Routes publiques (avant le middleware d'authentification).
function registerPublicAuthRoutes(app, { getStore, secret, limiter, safeHandler }) {
  app.post('/api/auth/login', safeHandler(async (req, res) => {
    const key = req.ip || 'unknown';
    if (limiter.isBlocked(key)) return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const store = getStore();
    const user = username ? await store.findUserByUsername(username) : null;
    if (!user || user.active === false || !verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
    }
    limiter.reset(key);
    const updated = await store.updateUser(user.id, { last_login_at: new Date().toISOString() });
    return res.json({ token: createToken(updated || user, secret), user: publicUser(updated || user) });
  }));
}

// Annotations d'autres personnes que le lecteur peut voir : tout pour un administrateur, sinon celles des
// personnes qui lui partagent toutes leurs annotations et celles partagées avec lui tweet par tweet.
// Le commentaire libre n'est montré que si le partage qui donne accès l'autorise (share_notes, vrai par défaut) ;
// sinon il est vidé et note_hidden l'indique.
async function visibleSharedAnnotations(store, viewer, query) {
  const viewerId = String(viewer.id);
  const others = (await store.listAnnotations(query)).filter((item) => item.user_id !== viewerId);
  if (viewer.role === 'admin') return others;
  const owners = await store.listUsersSharingWith(viewerId);
  const notesViaAll = new Map(owners.map((owner) => [String(owner.id), owner.share_notes !== false]));
  return others
    .filter((item) => notesViaAll.has(item.user_id) || (item.shared_with || []).includes(viewerId))
    .map((item) => {
      const viaPost = (item.shared_with || []).includes(viewerId) && item.share_notes !== false;
      const viaAll = notesViaAll.get(item.user_id) === true;
      return viaPost || viaAll || !item.note ? item : { ...item, note: '', note_hidden: true };
    });
}

// La liste des destinataires et les réglages de partage d'une annotation ne regardent que son auteur.
const withoutRecipients = ({ shared_with: _recipients, share_notes: _shareNotes, ...item }) => item;
const includeNotes = (value) => value !== false;

// Routes réservées aux utilisateurs connectés.
function registerAccountRoutes(app, { getStore, userAuth, findPostsByIds, safeHandler }) {
  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

  app.post('/api/auth/password', safeHandler(async (req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.password_hash)) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
    const errors = validateUserInput({ password: next }, { creating: false });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    // Changer de mot de passe révoque les autres sessions ; un nouveau jeton est renvoyé pour celle-ci.
    const updated = await getStore().updateUser(req.user.id, { password_hash: hashPassword(next), token_version: (req.user.token_version || 0) + 1 });
    userAuth.forget(req.user.id);
    return res.json({ token: createToken(updated, userAuth.secret), user: publicUser(updated) });
  }));

  app.get('/api/users', requireAdmin, safeHandler(async (req, res) => {
    const store = getStore();
    const [users, counts] = await Promise.all([store.listUsers(), store.countAnnotationsByUser()]);
    return res.json({ users: users.map((user) => ({ ...publicUser(user), annotations: counts[String(user.id)] || 0 })) });
  }));

  app.post('/api/users', requireAdmin, safeHandler(async (req, res) => {
    const input = { ...req.body, username: String(req.body?.username || '').trim().toLowerCase(), role: req.body?.role || 'annotateur' };
    const errors = validateUserInput(input, { creating: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    try {
      const user = await getStore().insertUser({
        username: input.username,
        name: String(input.name || input.username).trim(),
        role: input.role,
        active: true,
        token_version: 0,
        password_hash: hashPassword(input.password),
        created_at: new Date().toISOString(),
      });
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'Cet identifiant existe déjà.' });
      throw error;
    }
  }));

  app.patch('/api/users/:id', requireAdmin, safeHandler(async (req, res) => {
    const store = getStore();
    const target = await store.findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const { name, role, active, password } = req.body || {};
    const errors = validateUserInput({ name, role, password }, { creating: false });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const losesAdmin = target.role === 'admin' && target.active !== false && (role === 'annotateur' || active === false);
    if (losesAdmin && await store.countAdmins() <= 1) return res.status(400).json({ error: 'Il doit rester au moins un administrateur actif.' });
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim() || target.username;
    if (role !== undefined) patch.role = role;
    if (active !== undefined) patch.active = Boolean(active);
    // Un nouveau mot de passe ou une désactivation coupe les sessions ouvertes du compte.
    if (password !== undefined) patch.password_hash = hashPassword(password);
    if (password !== undefined || active === false || role !== undefined) patch.token_version = (target.token_version || 0) + 1;
    const updated = await store.updateUser(target.id, patch);
    userAuth.forget(target.id);
    return res.json({ user: publicUser(updated) });
  }));

  // Annuaire des comptes actifs (pour choisir avec qui partager ses annotations).
  app.get('/api/users/directory', safeHandler(async (req, res) => {
    const users = await getStore().listUsers();
    return res.json({ users: users.filter((user) => user.active !== false).map(publicProfile) });
  }));

  // Partage : chacun choisit qui peut lire toutes ses annotations (lecture seule).
  app.get('/api/annotations/shares', safeHandler(async (req, res) => {
    const store = getStore();
    const all = await store.listUsers();
    const byId = new Map(all.map((user) => [String(user.id), user]));
    const sharedWith = (req.user.shared_with || []).map((id) => byId.get(String(id))).filter(Boolean).map(publicProfile);
    const sharedWithMe = (await store.listUsersSharingWith(req.user.id)).map(publicProfile);
    return res.json({ shared_with: sharedWith, include_notes: req.user.share_notes !== false, shared_with_me: sharedWithMe });
  }));

  app.put('/api/annotations/shares', safeHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.user_ids) ? [...new Set(req.body.user_ids.map(String))] : null;
    if (!ids) return res.status(400).json({ error: 'user_ids requis.' });
    const store = getStore();
    const known = new Set((await store.listUsers()).filter((user) => user.active !== false).map((user) => String(user.id)));
    const sharedWith = ids.filter((id) => id !== String(req.user.id) && known.has(id));
    const shareNotes = includeNotes(req.body?.include_notes);
    await store.updateUser(req.user.id, { shared_with: sharedWith, share_notes: shareNotes });
    userAuth.forget(req.user.id);
    return res.json({ shared_with: sharedWith, include_notes: shareNotes });
  }));

  const validPost = (platform, postId) => PLATFORMS.includes(platform) && typeof postId === 'string' && postId !== '';
  // Les annotations antérieures aux annotations multiples n'ont pas de created_at : on se rabat sur updated_at.
  const newestFirst = (items) => items.sort((left, right) => String(right.created_at || right.updated_at || '').localeCompare(String(left.created_at || left.updated_at || '')));

  // Charge une annotation de l'utilisateur connecté ; null si elle n'existe pas ou appartient à quelqu'un d'autre.
  async function ownAnnotation(store, req) {
    const annotation = await store.findAnnotation(req.params.id);
    return annotation && annotation.user_id === String(req.user.id) ? annotation : null;
  }

  // Pour un post : mes annotations et celles des autres qui me sont visibles.
  app.get('/api/annotations/post', safeHandler(async (req, res) => {
    const { platform } = req.query;
    const postId = typeof req.query.post_id === 'string' ? req.query.post_id : '';
    if (!validPost(platform, postId)) return res.status(400).json({ error: 'platform et post_id requis.' });
    const store = getStore();
    const mine = await store.listAnnotations({ user_id: String(req.user.id), platform, post_id: postId });
    const shared = await visibleSharedAnnotations(store, req.user, { platform, post_id: postId });
    const names = new Map((await store.listUsers()).map((user) => [String(user.id), user.name || user.username]));
    return res.json({
      mine: newestFirst(mine),
      shared: newestFirst(shared.map((item) => ({ ...withoutRecipients(item), name: names.get(item.user_id) || item.username }))),
    });
  }));

  // Tous les posts dont je peux lire une annotation d'une autre personne (vue « Partagés avec moi »).
  app.get('/api/annotations/shared-with-me', safeHandler(async (req, res) => {
    const store = getStore();
    const shared = await visibleSharedAnnotations(store, req.user, {});
    const names = new Map((await store.listUsers()).map((user) => [String(user.id), user.name || user.username]));
    const byPost = new Map();
    shared.forEach((item) => {
      const key = `${item.platform}:${item.post_id}`;
      const entry = byPost.get(key) || { platform: item.platform, post_id: item.post_id, owners: [], updated_at: item.updated_at };
      const owner = names.get(item.user_id) || item.username;
      if (!entry.owners.includes(owner)) entry.owners.push(owner);
      if (String(item.updated_at) > String(entry.updated_at)) entry.updated_at = item.updated_at;
      byPost.set(key, entry);
    });
    return res.json({ posts: Array.from(byPost.values()).sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))) });
  }));

  // Annotations : chacun lit et écrit les siennes ; l'administrateur peut lire celles de tous (scope=all).
  app.get('/api/annotations', safeHandler(async (req, res) => {
    const all = req.query.scope === 'all';
    if (all && req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    const query = all ? {} : { user_id: String(req.user.id) };
    if (PLATFORMS.includes(req.query.platform)) query.platform = req.query.platform;
    return res.json({ annotations: newestFirst(await getStore().listAnnotations(query)) });
  }));

  // Ajoute une annotation : un même post peut en recevoir plusieurs.
  app.post('/api/annotations', safeHandler(async (req, res) => {
    const { platform, post_id: postId } = req.body || {};
    if (!validPost(platform, postId)) return res.status(400).json({ error: 'platform et post_id requis.' });
    const now = new Date().toISOString();
    const annotation = await getStore().insertAnnotation({
      user_id: String(req.user.id), username: req.user.username, platform, post_id: postId,
      ...cleanAnnotation(req.body), shared_with: [], share_notes: true, created_at: now, updated_at: now,
    });
    return res.status(201).json({ annotation });
  }));

  app.put('/api/annotations/:id', safeHandler(async (req, res) => {
    const store = getStore();
    if (!await ownAnnotation(store, req)) return res.status(404).json({ error: 'Annotation introuvable.' });
    const annotation = await store.updateAnnotation(req.params.id, { ...cleanAnnotation(req.body), updated_at: new Date().toISOString() });
    return res.json({ annotation });
  }));

  app.delete('/api/annotations/:id', safeHandler(async (req, res) => {
    const store = getStore();
    if (!await ownAnnotation(store, req)) return res.status(404).json({ error: 'Annotation introuvable.' });
    await store.deleteAnnotation(req.params.id);
    return res.json({ ok: true });
  }));

  // Partage d'une annotation précise avec des personnes choisies, avec ou sans son commentaire libre.
  app.put('/api/annotations/:id/share', safeHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.user_ids) ? [...new Set(req.body.user_ids.map(String))] : null;
    if (!ids) return res.status(400).json({ error: 'user_ids requis.' });
    const store = getStore();
    if (!await ownAnnotation(store, req)) return res.status(404).json({ error: 'Annotation introuvable.' });
    const known = new Set((await store.listUsers()).filter((user) => user.active !== false).map((user) => String(user.id)));
    const sharedWith = ids.filter((id) => id !== String(req.user.id) && known.has(id));
    const annotation = await store.updateAnnotation(req.params.id, { shared_with: sharedWith, share_notes: includeNotes(req.body?.include_notes) });
    return res.json({ annotation });
  }));

  // Reprise des annotations enregistrées dans le navigateur avant l'arrivée des comptes.
  app.post('/api/annotations/import', safeHandler(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_IMPORT) : [];
    const store = getStore();
    const existing = new Set((await store.listAnnotations({ user_id: String(req.user.id) })).map((item) => `${item.platform}:${item.post_id}`));
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      if (!validPost(item?.platform, item?.post_id)) { skipped += 1; continue; }
      // Un post déjà annoté sur le serveur n'est pas réimporté (évite les doublons en cas de second import).
      if (existing.has(`${item.platform}:${item.post_id}`)) { skipped += 1; continue; }
      const date = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : new Date().toISOString();
      await store.insertAnnotation({
        user_id: String(req.user.id), username: req.user.username, platform: item.platform, post_id: item.post_id,
        ...cleanAnnotation(item), shared_with: [], share_notes: true, created_at: date, updated_at: date,
      });
      imported += 1;
    }
    return res.json({ imported, skipped });
  }));

  // Export : annotations (les siennes, ou toutes pour l'admin) avec le texte et l'auteur des posts.
  app.get('/api/annotations/export', safeHandler(async (req, res) => {
    const all = req.query.scope === 'all';
    if (all && req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    const annotations = await getStore().listAnnotations(all ? {} : { user_id: String(req.user.id) });
    const posts = await findPostsByIds([...new Set(annotations.map((item) => item.post_id))]);
    const byId = new Map(posts.map((post) => [String(post.post_id), post]));
    return res.json({ annotations: annotations.map((item) => {
      const post = byId.get(item.post_id);
      return { ...item, post: post ? { text: post.text, author_handle: post.author_handle, timestamp: post.timestamp, collection_name: post.collection_name, lang: post.lang } : null };
    }) });
  }));
}

module.exports = { registerAccountRoutes, registerPublicAuthRoutes };
