const { ensureFactIndexes, factsStatus, rebuildFacts } = require('./facts');

// Tient post_facts à jour : au démarrage puis toutes les `intervalMs`, compare la collection aux posts
// (version du format, nombre de posts) et la reconstruit en tâche de fond si besoin, par exemple après
// un import. Pendant une reconstruction, l'ancienne version reste servie ; à la fin, le cache est vidé
// et les vues principales sont recalculées (warm).
function createFactsManager({ getDb, cache, warm = async () => {}, intervalMs = 5 * 60 * 1000, log = console.log }) {
  let ready = false;
  let building = null;
  let checking = null;
  let warmed = false;
  let timer = null;
  // Nombre de posts vu à la vérification précédente : null au démarrage.
  let lastPosts = null;

  // Une seule vérification à la fois : deux appels simultanés ne lancent pas deux reconstructions.
  function check() {
    if (!checking) checking = runCheck().finally(() => { checking = null; });
    return checking;
  }

  async function runCheck() {
    const db = getDb();
    if (!db || building) return building;
    let status;
    try {
      status = await factsStatus(db);
    } catch (error) {
      log(`post_facts : état illisible (${error?.message || error}).`);
      return null;
    }
    ready = status.exists || status.fresh;
    const previous = lastPosts;
    lastPosts = status.posts;
    if (status.fresh) {
      if (!warmed) await ensureFactIndexes(db, { log }).catch((error) => log(`post_facts : index non mis à jour (${error?.message || error}).`));
      // Premier démarrage avec des données déjà prêtes : préchargement des vues principales.
      if (!warmed) {
        warmed = true;
        warm().catch((error) => log(`Préchargement incomplet : ${error?.message || error}`));
      }
      return null;
    }
    // Import en cours (le nombre de posts change encore) : on attend qu'il soit stable pour ne pas
    // reconstruire sur des données partielles. Au démarrage, la reconstruction est immédiate.
    if (status.exists && previous !== null && previous !== status.posts) {
      log(`post_facts : ${status.posts.toLocaleString('fr-FR')} posts (import en cours ?), reconstruction à la prochaine vérification si le nombre est stable.`);
      return null;
    }
    log(status.exists
      ? `post_facts à reconstruire (${status.facts.toLocaleString('fr-FR')} entrées pour ${status.posts.toLocaleString('fr-FR')} posts, ou nouveau format) ; l’ancienne version reste servie.`
      : `post_facts absent : construction pour ${status.posts.toLocaleString('fr-FR')} posts. Les statistiques seront disponibles à la fin.`);
    building = rebuildFacts(db, { log })
      .then(async () => {
        ready = true;
        warmed = true;
        cache.clear();
        await warm().catch((error) => log(`Préchargement incomplet : ${error?.message || error}`));
      })
      .catch((error) => log(`post_facts non reconstruit : ${error?.message || error}`))
      .finally(() => { building = null; });
    return building;
  }

  function start() {
    check();
    timer = setInterval(check, intervalMs);
    timer.unref?.();
  }

  return {
    start,
    check,
    stop: () => clearInterval(timer),
    ready: () => ready,
    building: () => Boolean(building),
  };
}

module.exports = { createFactsManager };
