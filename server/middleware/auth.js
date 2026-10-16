const crypto = require('crypto');

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function readBearer(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Protège les routes avec un mot de passe partagé. Sans mot de passe configuré,
// l'accès reste ouvert (développement local).
function createPasswordAuth(password, { now = Date.now } = {}) {
  if (!password) {
    return (req, res, next) => next();
  }

  const expected = digest(password);
  const failures = new Map();

  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const key = req.ip || 'unknown';
    const entry = failures.get(key);
    if (entry && now() - entry.since > FAILURE_WINDOW_MS) failures.delete(key);
    const current = failures.get(key);
    if (current && current.count >= MAX_FAILURES) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez plus tard.' });
    }

    if (crypto.timingSafeEqual(digest(readBearer(req)), expected)) {
      failures.delete(key);
      return next();
    }

    failures.set(key, { count: (current?.count || 0) + 1, since: current?.since || now() });
    return res.status(401).json({ error: 'Mot de passe requis.' });
  };
}

module.exports = { createPasswordAuth };
