const { readToken } = require('../services/accounts');

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const USER_CACHE_MS = 30 * 1000;

function readBearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Limite les échecs de connexion : 10 échecs depuis une adresse la bloquent 15 minutes.
function createFailureLimiter({ now = Date.now } = {}) {
  const failures = new Map();
  const current = (key) => {
    const entry = failures.get(key);
    if (entry && now() - entry.since > FAILURE_WINDOW_MS) failures.delete(key);
    return failures.get(key);
  };
  return {
    isBlocked: (key) => (current(key)?.count || 0) >= MAX_FAILURES,
    fail(key) {
      const entry = current(key);
      failures.set(key, { count: (entry?.count || 0) + 1, since: entry?.since || now() });
    },
    reset: (key) => failures.delete(key),
  };
}

// Exige un jeton de session valide ; req.user reçoit le compte (actif, jeton non révoqué).
function createUserAuth({ getStore, secret, now = Date.now }) {
  const cache = new Map();
  const loadUser = async (id) => {
    const hit = cache.get(id);
    if (hit && now() - hit.at < USER_CACHE_MS) return hit.user;
    const user = await getStore().findUserById(id);
    cache.set(id, { at: now(), user });
    return user;
  };

  const middleware = async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    try {
      const token = readToken(readBearer(req), secret, now());
      const user = token ? await loadUser(token.sub) : null;
      if (!user || user.active === false || (user.token_version || 0) !== token.tv) {
        return res.status(401).json({ error: 'Connexion requise.' });
      }
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
  // Après une modification de compte, la prochaine requête relit l'utilisateur.
  middleware.forget = (id) => cache.delete(String(id));
  middleware.secret = secret;
  return middleware;
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  return next();
}

module.exports = { createFailureLimiter, createUserAuth, readBearer, requireAdmin };
