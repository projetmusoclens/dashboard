#!/bin/bash
# Exécuté une seule fois par l'image mongo, à la création de la base :
# crée l'utilisateur de l'API, limité à la lecture/écriture de worldcup2026.
set -euo pipefail
mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin <<JS
db.getSiblingDB('worldcup2026').createUser({
  user: '$MONGO_APP_USER',
  pwd: '$MONGO_APP_PASSWORD',
  roles: [{ role: 'readWrite', db: 'worldcup2026' }],
});
JS
