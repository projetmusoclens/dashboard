const { requireAdmin } = require('../middleware/auth');
const { EVENT_ID, cleanSheet, createSheetStore, listSheets } = require('../services/eventSheets');

// Fiches des événements de collecte : lecture pour tous, modification par les administrateurs.
function registerEventSheetRoutes(app, { getDb, safeHandler }) {
  const store = createSheetStore(getDb);

  app.get('/api/event-sheets', safeHandler(async (req, res) => res.json({ sheets: await listSheets(store) })));

  app.put('/api/event-sheets/:event', requireAdmin, safeHandler(async (req, res) => {
    const event = String(req.params.event);
    if (!EVENT_ID.test(event)) return res.status(400).json({ error: 'Identifiant d’événement invalide.' });
    await store.save(event, { ...cleanSheet(req.body), updated_at: new Date().toISOString(), updated_by: req.user.username });
    const sheet = (await listSheets(store)).find((item) => item.event === event);
    return res.json({ sheet });
  }));

  // Revenir à la fiche pré-remplie (ou supprimer une fiche sans valeurs par défaut).
  app.delete('/api/event-sheets/:event', requireAdmin, safeHandler(async (req, res) => {
    const event = String(req.params.event);
    if (!EVENT_ID.test(event)) return res.status(400).json({ error: 'Identifiant d’événement invalide.' });
    await store.remove(event);
    return res.json({ sheet: (await listSheets(store)).find((item) => item.event === event) || null });
  }));
}

module.exports = { registerEventSheetRoutes };
