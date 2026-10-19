const crypto = require('crypto');

// Comptes utilisateurs et annotations : mots de passe hachés (scrypt), jetons de session signés (HMAC).
// Aucun module externe : tout repose sur le module crypto de Node.

const ROLES = ['admin', 'annotateur'];
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const ANNOTATION_STATUSES = ['a_analyser', 'analyse', 'a_discuter'];
const ANNOTATION_RELEVANCE = ['', 'oui', 'non', 'incertain'];
const ANNOTATION_TEXT_FIELDS = { theme: 200, tone: 50, interaction: 50, keywords: 1000, note: 10000 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const base64url = (value) => Buffer.from(value).toString('base64url');

function createToken(user, secret, now = Date.now()) {
  const payload = base64url(JSON.stringify({ sub: String(user.id), tv: user.token_version || 0, exp: now + TOKEN_TTL_MS }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(token, secret, now = Date.now()) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > now ? data : null;
  } catch {
    return null;
  }
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user.id),
    username: user.username,
    name: user.name || user.username,
    role: user.role,
    active: user.active !== false,
    created_at: user.created_at || null,
    last_login_at: user.last_login_at || null,
  };
}

function validateUserInput({ username, name, password, role }, { creating }) {
  const errors = [];
  if (creating || username !== undefined) {
    if (!USERNAME_PATTERN.test(String(username || ''))) errors.push('Identifiant : 3 à 32 caractères parmi a-z, 0-9, « . », « _ », « - ».');
  }
  if (creating || password !== undefined) {
    if (String(password || '').length < MIN_PASSWORD_LENGTH) errors.push(`Mot de passe : ${MIN_PASSWORD_LENGTH} caractères minimum.`);
  }
  if (role !== undefined && !ROLES.includes(role)) errors.push('Rôle inconnu.');
  if (name !== undefined && String(name).length > 80) errors.push('Nom : 80 caractères maximum.');
  return errors;
}

// Ne garde que les champs d'annotation connus, avec des valeurs valides.
function cleanAnnotation(input = {}) {
  const annotation = {
    status: ANNOTATION_STATUSES.includes(input.status) ? input.status : 'a_analyser',
    relevance: ANNOTATION_RELEVANCE.includes(input.relevance) ? input.relevance : '',
  };
  Object.entries(ANNOTATION_TEXT_FIELDS).forEach(([field, max]) => {
    annotation[field] = typeof input[field] === 'string' ? input[field].trim().slice(0, max) : '';
  });
  return annotation;
}

// Stockage MongoDB (collections users et annotations).
function createMongoStore(db) {
  const { ObjectId } = require('mongodb');
  const users = db.collection('users');
  const annotations = db.collection('annotations');
  const toUser = (doc) => (doc ? { ...doc, id: String(doc._id) } : null);
  const objectId = (id) => { try { return new ObjectId(String(id)); } catch { return null; } };
  return {
    kind: 'mongo',
    async init() {
      await users.createIndex({ username: 1 }, { unique: true, name: 'username_unique' });
      await annotations.createIndex({ user_id: 1, platform: 1, post_id: 1 }, { unique: true, name: 'user_post_unique' });
    },
    countUsers: () => users.countDocuments({}),
    countAdmins: () => users.countDocuments({ role: 'admin', active: { $ne: false } }),
    findUserByUsername: async (username) => toUser(await users.findOne({ username })),
    findUserById: async (id) => { const _id = objectId(id); return _id ? toUser(await users.findOne({ _id })) : null; },
    listUsers: async () => (await users.find({}).sort({ username: 1 }).toArray()).map(toUser),
    async insertUser(user) { const { insertedId } = await users.insertOne(user); return toUser({ ...user, _id: insertedId }); },
    async updateUser(id, patch) { const _id = objectId(id); if (!_id) return null; await users.updateOne({ _id }, { $set: patch }); return toUser(await users.findOne({ _id })); },
    listAnnotations: (query) => annotations.find(query, { projection: { _id: 0 } }).toArray(),
    countAnnotationsByUser: async () => Object.fromEntries((await annotations.aggregate([{ $group: { _id: '$user_id', n: { $sum: 1 } } }]).toArray()).map((row) => [row._id, row.n])),
    async upsertAnnotation(key, values) {
      const now = new Date().toISOString();
      await annotations.updateOne(key, { $set: { ...values, updated_at: values.updated_at || now }, $setOnInsert: { created_at: now } }, { upsert: true });
      return annotations.findOne(key, { projection: { _id: 0 } });
    },
    deleteAnnotation: (key) => annotations.deleteOne(key),
  };
}

// Stockage en mémoire : mode archive sans MongoDB et tests. Les données sont perdues au redémarrage.
function createMemoryStore() {
  const users = [];
  const annotations = [];
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => doc[key] === value);
  return {
    kind: 'memory',
    async init() {},
    countUsers: async () => users.length,
    countAdmins: async () => users.filter((user) => user.role === 'admin' && user.active !== false).length,
    findUserByUsername: async (username) => users.find((user) => user.username === username) || null,
    findUserById: async (id) => users.find((user) => user.id === String(id)) || null,
    listUsers: async () => [...users].sort((left, right) => left.username.localeCompare(right.username)),
    async insertUser(user) {
      if (users.some((item) => item.username === user.username)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const stored = { ...user, id: crypto.randomUUID() };
      users.push(stored);
      return stored;
    },
    async updateUser(id, patch) { const user = users.find((item) => item.id === String(id)); if (!user) return null; Object.assign(user, patch); return user; },
    listAnnotations: async (query) => annotations.filter((item) => matches(item, query)).map((item) => ({ ...item })),
    countAnnotationsByUser: async () => annotations.reduce((counts, item) => ({ ...counts, [item.user_id]: (counts[item.user_id] || 0) + 1 }), {}),
    async upsertAnnotation(key, values) {
      const now = new Date().toISOString();
      let item = annotations.find((annotation) => matches(annotation, key));
      if (!item) { item = { ...key, created_at: now }; annotations.push(item); }
      Object.assign(item, values, { updated_at: values.updated_at || now });
      return { ...item };
    },
    async deleteAnnotation(key) { const index = annotations.findIndex((item) => matches(item, key)); if (index >= 0) annotations.splice(index, 1); },
  };
}

// Crée le premier administrateur à partir de ADMIN_USERNAME / ADMIN_PASSWORD si aucun compte n'existe.
async function bootstrapAdmin(store, { username, password, name } = {}) {
  if (await store.countUsers() > 0) return null;
  if (!username || !password) {
    console.warn('Aucun compte utilisateur : définissez ADMIN_USERNAME et ADMIN_PASSWORD pour créer le premier administrateur.');
    return null;
  }
  const errors = validateUserInput({ username, password, role: 'admin' }, { creating: true });
  if (errors.length) {
    console.warn(`Administrateur initial non créé : ${errors.join(' ')}`);
    return null;
  }
  const admin = await store.insertUser({ username, name: name || username, role: 'admin', active: true, token_version: 0, password_hash: hashPassword(password), created_at: new Date().toISOString() });
  console.log(`Administrateur initial « ${username} » créé.`);
  return admin;
}

module.exports = {
  ANNOTATION_RELEVANCE,
  ANNOTATION_STATUSES,
  MIN_PASSWORD_LENGTH,
  ROLES,
  TOKEN_TTL_MS,
  bootstrapAdmin,
  cleanAnnotation,
  createMemoryStore,
  createMongoStore,
  createToken,
  hashPassword,
  publicUser,
  readToken,
  validateUserInput,
  verifyPassword,
};
