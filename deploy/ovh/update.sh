#!/bin/bash
# Mise à jour de l'API après un push : récupère le code et reconstruit le conteneur api.
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --build api
docker image prune -f > /dev/null
docker compose ps
