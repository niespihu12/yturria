#!/usr/bin/env bash
# Backup diario de MySQL → archivo comprimido y cifrado.
# Uso: ./backup_db.sh
# Cron: 0 2 * * * /path/to/backup_db.sh >> /var/log/backup_db.log 2>&1
#
# Variables de entorno requeridas:
#   DATABASE_URL   mysql://user:pass@host:port/dbname
#   BACKUP_ENCRYPT_PASSPHRASE  contraseña para cifrar el backup
#
# Variables opcionales (cloud upload):
#   AWS_S3_BUCKET   ej: s3://mi-bucket/backups/
#   GCS_BUCKET      ej: gs://mi-bucket/backups/
#   BACKUP_DIR      directorio local de backups (default: /var/backups/db)
#   RETAIN_DAYS     días de retención (default: 7)

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${LOG_FILE:-/var/log/backup_db.log}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/db}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# ── Parse DATABASE_URL ─────────────────────────────────────────────────────────
# Formato: mysql://user:pass@host:port/dbname
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[ERROR] $(date -Iseconds) DATABASE_URL no está definida" >&2
  exit 1
fi

_url="${DATABASE_URL#mysql://}"
_url="${_url#mysql+pymysql://}"
DB_USER="$(echo "$_url" | cut -d: -f1)"
_rest="${_url#*:}"
DB_PASS="$(echo "$_rest" | cut -d@ -f1)"
_host_part="${_rest#*@}"
DB_HOST="$(echo "$_host_part" | cut -d: -f1)"
_port_db="${_host_part#*:}"
DB_PORT="$(echo "$_port_db" | cut -d/ -f1)"
DB_NAME="$(echo "$_port_db" | cut -d/ -f2)"

if [[ -z "$DB_NAME" || -z "$DB_HOST" || -z "$DB_USER" ]]; then
  echo "[ERROR] $(date -Iseconds) No se pudo parsear DATABASE_URL: $DATABASE_URL" >&2
  exit 1
fi

# ── Cifrado ────────────────────────────────────────────────────────────────────
if [[ -z "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]]; then
  echo "[ERROR] $(date -Iseconds) BACKUP_ENCRYPT_PASSPHRASE no está definida" >&2
  exit 1
fi

# ── Preparar directorio ────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz.enc"
TEMP_DUMP="$(mktemp /tmp/db_backup_XXXXXX.sql.gz)"

cleanup() { rm -f "$TEMP_DUMP"; }
trap cleanup EXIT

log() { echo "[$(date -Iseconds)] $*"; }

log "Iniciando backup de $DB_NAME@$DB_HOST:$DB_PORT"

# ── Dump + compresión ──────────────────────────────────────────────────────────
if ! MYSQL_PWD="$DB_PASS" mysqldump \
    --host="$DB_HOST" \
    --port="${DB_PORT:-3306}" \
    --user="$DB_USER" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --set-gtid-purged=OFF \
    "$DB_NAME" | gzip -9 > "$TEMP_DUMP"; then
  log "ERROR: mysqldump falló para $DB_NAME"
  exit 1
fi

DUMP_SIZE="$(du -sh "$TEMP_DUMP" | cut -f1)"
log "Dump comprimido: $DUMP_SIZE"

# ── Cifrado con openssl ────────────────────────────────────────────────────────
if ! openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
    -pass "pass:${BACKUP_ENCRYPT_PASSPHRASE}" \
    -in "$TEMP_DUMP" \
    -out "$BACKUP_FILE"; then
  log "ERROR: cifrado falló"
  exit 1
fi

FINAL_SIZE="$(du -sh "$BACKUP_FILE" | cut -f1)"
log "Backup cifrado: $BACKUP_FILE ($FINAL_SIZE)"

# ── Upload a cloud ─────────────────────────────────────────────────────────────
CLOUD_OK=true

if [[ -n "${AWS_S3_BUCKET:-}" ]]; then
  if command -v aws &>/dev/null; then
    if aws s3 cp "$BACKUP_FILE" "${AWS_S3_BUCKET%/}/$(basename "$BACKUP_FILE")"; then
      log "Upload S3 OK: ${AWS_S3_BUCKET%/}/$(basename "$BACKUP_FILE")"
    else
      log "ERROR: Upload a S3 falló"
      CLOUD_OK=false
    fi
  else
    log "WARN: AWS_S3_BUCKET definido pero 'aws' CLI no está instalado"
    CLOUD_OK=false
  fi
fi

if [[ -n "${GCS_BUCKET:-}" ]]; then
  if command -v gsutil &>/dev/null; then
    if gsutil cp "$BACKUP_FILE" "${GCS_BUCKET%/}/$(basename "$BACKUP_FILE")"; then
      log "Upload GCS OK: ${GCS_BUCKET%/}/$(basename "$BACKUP_FILE")"
    else
      log "ERROR: Upload a GCS falló"
      CLOUD_OK=false
    fi
  else
    log "WARN: GCS_BUCKET definido pero 'gsutil' no está instalado"
    CLOUD_OK=false
  fi
fi

# ── Rotación: eliminar backups con más de RETAIN_DAYS días ────────────────────
DELETED=0
while IFS= read -r -d '' old_file; do
  rm -f "$old_file"
  log "Eliminado backup antiguo: $old_file"
  ((DELETED++)) || true
done < <(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}_*.sql.gz.enc" \
          -mtime "+${RETAIN_DAYS}" -print0)

log "Rotación: $DELETED archivos eliminados (retención $RETAIN_DAYS días)"

# ── Resultado final ────────────────────────────────────────────────────────────
if [[ "$CLOUD_OK" == "false" ]]; then
  log "BACKUP COMPLETADO CON ADVERTENCIAS — backup local OK pero cloud falló"
  exit 2
fi

log "BACKUP COMPLETADO OK — $BACKUP_FILE"
