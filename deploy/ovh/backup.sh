#!/bin/bash
# Sauvegarde de la base worldcup2026 dans deploy/ovh/backups/ (14 jours conservés).
# À lancer chaque nuit par cron :  0 3 * * * /home/ubuntu/dashboard/deploy/ovh/backup.sh >> /home/ubuntu/backup.log 2>&1
# Avec HC_BACKUP_URL dans .env, signale le début, la réussite ou l'échec à Healthchecks.io : une nuit sans
# sauvegarde réussie déclenche un e-mail.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
ping() { [ -n "${HC_BACKUP_URL:-}" ] && curl -fsS -m 10 --retry 3 --data-raw "${2:-}" "${HC_BACKUP_URL}$1" > /dev/null || true; }
trap 'ping /fail "Sauvegarde en échec (ligne $LINENO), voir backup.log"' ERR
ping /start
mkdir -p backups
file="backups/worldcup2026_$(date +%Y-%m-%d_%H%M).archive.gz"
docker compose exec -T mongo mongodump --quiet -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db worldcup2026 --archive --gzip > "$file"
# Une archive presque vide signale un mongodump qui n'a rien exporté.
# Elle est supprimée : monitor.sh ne doit pas la prendre pour une sauvegarde récente.
[ "$(stat -c %s "$file")" -gt 1000000 ] || { echo "$(date -Is) sauvegarde trop petite, supprimée : $file"; rm -f "$file"; false; }
find backups -name 'worldcup2026_*.archive.gz' -mtime +14 -delete
message="$(date -Is) sauvegarde : $file ($(du -h "$file" | cut -f1)), $(df -h --output=avail / | tail -1 | tr -d ' ') libres"
echo "$message"
ping "" "$message"
