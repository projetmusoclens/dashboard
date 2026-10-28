#!/bin/bash
# Surveillance du serveur, toutes les 5 minutes par cron :
#   */5 * * * * /home/ubuntu/dashboard/deploy/ovh/monitor.sh >> /home/ubuntu/monitor.log 2>&1
# Envoie le résultat à Healthchecks.io (HC_MONITOR_URL dans .env) : un signal « ok », ou « fail » avec
# la liste des problèmes. Healthchecks.io prévient par e-mail en cas d'échec, ou si plus aucun signal
# n'arrive (serveur arrêté, cron bloqué). Sans HC_MONITOR_URL, le résultat est seulement affiché.
set -uo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

# Seuils (modifiables dans .env).
DISK_MAX_PERCENT=${MONITOR_DISK_MAX_PERCENT:-85}
MEMORY_MIN_MB=${MONITOR_MEMORY_MIN_MB:-300}
CERT_MIN_DAYS=${MONITOR_CERT_MIN_DAYS:-14}
BACKUP_MAX_HOURS=${MONITOR_BACKUP_MAX_HOURS:-26}

problems=()
details=()
problem() { problems+=("$1"); }
join() { local out=""; for item in "$@"; do out+="${out:+ · }$item"; done; echo "$out"; }

# Une seule exécution à la fois (une vérification lente ne se superpose pas à la suivante).
exec 9>/tmp/heimdall-monitor.lock
flock -n 9 || { echo "$(date -Is) vérification précédente encore en cours"; exit 0; }

# 1. Disque.
disk=$(df --output=pcent / | tail -1 | tr -dc '0-9')
details+=("disque ${disk} %")
[ "$disk" -ge "$DISK_MAX_PERCENT" ] && problem "Disque rempli à ${disk} % (seuil ${DISK_MAX_PERCENT} %)"

# 2. Mémoire disponible.
memory=$(awk '/MemAvailable/ { print int($2 / 1024) }' /proc/meminfo)
details+=("mémoire libre ${memory} Mo")
[ "$memory" -lt "$MEMORY_MIN_MB" ] && problem "Mémoire disponible faible : ${memory} Mo (seuil ${MEMORY_MIN_MB} Mo)"

# 3. Conteneurs : en marche, en bonne santé (mongo et api ont un healthcheck), sans redémarrages récents.
for service in mongo api caddy; do
  id=$(docker compose ps -q "$service" 2>/dev/null)
  if [ -z "$id" ]; then problem "Conteneur $service absent"; continue; fi
  state=$(docker inspect -f '{{.State.Status}}' "$id")
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$id")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$id")
  details+=("$service ${state}/${health}")
  [ "$state" != "running" ] && problem "Conteneur $service : $state"
  [ "$health" = "unhealthy" ] && problem "Conteneur $service : unhealthy"
  # Redémarrages depuis la vérification précédente (plantage suivi d'un redémarrage automatique).
  previous_file="/tmp/heimdall-monitor-restarts-$service"
  previous=$(cat "$previous_file" 2>/dev/null || echo "$restarts")
  [ "$restarts" -gt "$previous" ] && problem "Conteneur $service redémarré $((restarts - previous)) fois depuis 5 min"
  echo "$restarts" > "$previous_file"
done

# 4. L'API vue de l'extérieur du conteneur, à travers Caddy et HTTPS (même chemin que les utilisateurs).
health=$(curl -fsS --max-time 15 "https://${API_DOMAIN}/api/health" 2>&1)
if [ $? -ne 0 ]; then problem "API injoignable en HTTPS : ${health:0:200}"
elif ! grep -q '"mongo":"ok"' <<<"$health"; then problem "API : MongoDB ne répond pas (${health:0:200})"
else details+=("API ok"); fi

# 5. Certificat HTTPS : Caddy le renouvelle 30 jours avant l'échéance ; moins de CERT_MIN_DAYS jours = renouvellement en échec.
expiry=$(echo | openssl s_client -servername "$API_DOMAIN" -connect "${API_DOMAIN}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$expiry" ]; then problem "Certificat HTTPS illisible"
else
  days=$(( ($(date -d "$expiry" +%s) - $(date +%s)) / 86400 ))
  details+=("certificat ${days} j")
  [ "$days" -lt "$CERT_MIN_DAYS" ] && problem "Certificat HTTPS expirant dans ${days} jours"
fi

# 6. Sauvegarde de la nuit.
latest=$(ls -t backups/worldcup2026_*.archive.gz 2>/dev/null | head -1)
if [ -z "$latest" ]; then problem "Aucune sauvegarde dans backups/"
else
  age=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 3600 ))
  details+=("sauvegarde il y a ${age} h")
  [ "$age" -gt "$BACKUP_MAX_HOURS" ] && problem "Dernière sauvegarde il y a ${age} h ($latest)"
fi

# Résultat.
if [ ${#problems[@]} -eq 0 ]; then
  report="OK · $(join "${details[@]}")"
  endpoint=""
else
  report="$(printf '%s\n' "PROBLÈMES (${#problems[@]}) :" "${problems[@]/#/- }" "" "État : $(join "${details[@]}")")"
  endpoint="/fail"
fi
echo "$(date -Is) ${report//$'\n'/ | }"
if [ -n "${HC_MONITOR_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 --data-raw "$report" "${HC_MONITOR_URL}${endpoint}" > /dev/null || echo "$(date -Is) signal Healthchecks.io non envoyé"
fi
[ ${#problems[@]} -eq 0 ]
