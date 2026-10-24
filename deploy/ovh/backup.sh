#!/bin/bash
# Sauvegarde de la base worldcup2026 dans deploy/ovh/backups/ (14 jours conservés).
# À lancer chaque nuit par cron :  0 3 * * * /home/ubuntu/dashboard/deploy/ovh/backup.sh >> /home/ubuntu/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
mkdir -p backups
file="backups/worldcup2026_$(date +%Y-%m-%d_%H%M).archive.gz"
docker compose exec -T mongo mongodump --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db worldcup2026 --archive --gzip > "$file"
find backups -name 'worldcup2026_*.archive.gz' -mtime +14 -delete
echo "$(date -Is) sauvegarde : $file ($(du -h "$file" | cut -f1))"
