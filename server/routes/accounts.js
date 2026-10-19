const {
  cleanAnnotation, createToken, hashPassword, publicUser, validateUserInput, verifyPassword,
} = require('../services/accounts');
const { requireAdmin } = require('../middleware/auth');

const PLATFORMS = ['twitter', 'bluesky'];
const MAX_IMPORT = 5000;

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

  // Annotations : chacun lit et écrit les siennes ; l'administrateur peut lire celles de tous (scope=all).
  app.get('/api/annotations', safeHandler(async (req, res) => {
    const all = req.query.scope === 'all';
    if (all && req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
    const query = all ? {} : { user_id: String(req.user.id) };
    if (PLATFORMS.includes(req.query.platform)) query.platform = req.query.platform;
    return res.json({ annotations: await getStore().listAnnotations(query) });
  }));

  app.put('/api/annotations', safeHandler(async (req, res) => {
    const { platform, post_id: postId } = req.body || {};
    if (!PLATFORMS.includes(platform) || typeof postId !== 'string' || !postId) return res.status(400).json({ error: 'platform et post_id requis.' });
    const annotation = await getStore().upsertAnnotation(
      { user_id: String(req.user.id), platform, post_id: postId },
      { ...cleanAnnotation(req.body), username: req.user.username },
    );
    return res.json({ annotation });
  }));

  app.delete('/api/annotations', safeHandler(async (req, res) => {
    const { platform, post_id: postId } = req.body || {};
    if (!PLATFORMS.includes(platform) || typeof postId !== 'string') return res.status(400).json({ error: 'platform et post_id requis.' });
    await getStore().deleteAnnotation({ user_id: String(req.user.id), platform, post_id: postId });
    return res.json({ ok: true });
  }));

  // Reprise des annotations enregistrées dans le navigateur avant l'arrivée des comptes.
  app.post('/api/annotations/import', safeHandler(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_IMPORT) : [];
    const store = getStore();
    const existing = new Set((await store.listAnnotations({ user_id: String(req.user.id) })).map((item) => `${item.platform}:${item.post_id}`));
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
      if (!PLATFORMS.includes(item?.platform) || typeof item?.post_id !== 'string' || !item.post_id) { skipped += 1; continue; }
      // Une annotation déjà présente sur le serveur n'est pas écrasée par la copie locale.
      if (existing.has(`${item.platform}:${item.post_id}`)) { skipped += 1; continue; }
      await store.upsertAnnotation(
        { user_id: String(req.user.id), platform: item.platform, post_id: item.post_id },
        { ...cleanAnnotation(item), username: req.user.username, ...(typeof item.updatedAt === 'string' && item.updatedAt ? { updated_at: item.updatedAt } : {}) },
      );
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
