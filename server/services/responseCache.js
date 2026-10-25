// Cache des réponses coûteuses (statistiques, courbe, collectes, graphes, conversations).
// Les données ne changent qu'à l'import : une entrée reste valable jusqu'à la reconstruction de
// post_facts, qui vide tout le cache (clear). Les calculs identiques simultanés sont partagés.

function createResponseCache({ maxEntries = 80 } = {}) {
  const entries = new Map();
  let generation = 0;
  const clearListeners = [];

  // Clé stable : nom de la route et paramètres triés.
  const keyOf = (name, params = {}) => `${name}|${JSON.stringify(Object.keys(params).sort().map((key) => [key, params[key]]))}`;

  function get(name, params, compute) {
    const key = keyOf(name, params);
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    const startedAt = generation;
    const value = Promise.resolve().then(compute);
    entries.set(key, value);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    // Échec, ou données reconstruites pendant le calcul : le résultat n'est pas gardé.
    value.then(() => { if (generation !== startedAt) entries.delete(key); }, () => entries.delete(key));
    return value;
  }

  function clear() {
    generation += 1;
    entries.clear();
    clearListeners.forEach((listener) => listener());
  }

  // Caches secondaires (arbres de conversation) vidés en même temps que celui-ci.
  const onClear = (listener) => { clearListeners.push(listener); };

  return { get, clear, onClear, size: () => entries.size };
}

module.exports = { createResponseCache };
