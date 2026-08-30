#!/usr/bin/env bash

# Safely migrates ZweiBlog's standard databases from an existing Compose MongoDB
# service into a separate, authenticated MongoDB 8.0 data directory.
#
# The source data directory and source Compose file are never modified. The
# script stops ZweiBlog only while taking a consistent logical backup, restores
# that backup into an isolated container, and compares every collection count.

set -Eeuo pipefail
umask 077

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly COMPOSE_FILE_INPUT="${ZWEIBLOG_COMPOSE_FILE:-./docker-compose.yaml}"
readonly MONGO_SERVICE="${ZWEIBLOG_MONGO_SERVICE:-mongo}"
readonly APP_SERVICE="${ZWEIBLOG_APP_SERVICE:-zweiblog}"
readonly TARGET_IMAGE="${ZWEIBLOG_MONGO_TARGET_IMAGE:-mongo:8.0}"
readonly SOURCE_URI_FILE="${ZWEIBLOG_MONGO_SOURCE_URI_FILE:-}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[mongo-migration] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_command docker
require_command gzip
require_command sha256sum
require_command sort
require_command diff
require_command awk
require_command grep
require_command install
require_command sed
require_command wc

[[ "$(id -u)" -eq 0 ]] || die 'run as root to create correctly owned MongoDB secret files'
[[ -f "$COMPOSE_FILE_INPUT" && ! -L "$COMPOSE_FILE_INPUT" ]] ||
  die "Compose file is missing or is a symbolic link: $COMPOSE_FILE_INPUT"

readonly COMPOSE_FILE="$(CDPATH= cd -- "$(dirname -- "$COMPOSE_FILE_INPUT")" && pwd -P)/$(basename -- "$COMPOSE_FILE_INPUT")"
readonly DEPLOY_DIR="$(dirname -- "$COMPOSE_FILE")"

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f "$COMPOSE_FILE")
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f "$COMPOSE_FILE")
else
  die 'Docker Compose v2 or docker-compose is required'
fi

source_container="$("${compose[@]}" ps -q "$MONGO_SERVICE")"
[[ -n "$source_container" ]] || die "Compose service is not created: $MONGO_SERVICE"
[[ "$(docker inspect -f '{{.State.Running}}' "$source_container")" == 'true' ]] ||
  die "Compose service is not running: $MONGO_SERVICE"

source_image="$(docker inspect -f '{{.Config.Image}}' "$source_container")"
source_version="$("${compose[@]}" exec -T "$MONGO_SERVICE" mongod --version | awk '/db version/{print $3; exit}' | sed 's/^v//')"
source_major="${source_version%%.*}"
[[ "$source_major" =~ ^[0-9]+$ ]] || die 'could not determine the source MongoDB version'
((source_major >= 4 && source_major < 8)) ||
  die "expected a MongoDB 4.x-7.x source, found ${source_version:-unknown}"

case "$(uname -m)" in
  x86_64 | amd64)
    grep -Eq '^flags.* avx( |$)' /proc/cpuinfo ||
      die 'MongoDB 8.0 requires AVX on x86_64; migrate on a compatible host'
    ;;
  aarch64 | arm64)
    grep -Eq '^Features.* (fphp|dcpop|sha3|sm3|sm4|asimddp|sha512|sve)( |$)' /proc/cpuinfo ||
      die 'MongoDB 8.0 requires ARMv8.2-A or newer; migrate on a compatible host'
    ;;
  *)
    die "unsupported MongoDB 8.0 host architecture: $(uname -m)"
    ;;
esac

source_uri='mongodb://127.0.0.1:27017/admin?directConnection=true'
if [[ -n "$SOURCE_URI_FILE" ]]; then
  [[ -f "$SOURCE_URI_FILE" && ! -L "$SOURCE_URI_FILE" ]] ||
    die 'ZWEIBLOG_MONGO_SOURCE_URI_FILE must be a regular, non-symbolic-link file'
  [[ "$(wc -c <"$SOURCE_URI_FILE")" -le 8192 ]] || die 'source URI file is too large'
  source_uri="$(<"$SOURCE_URI_FILE")"
  source_uri="${source_uri%$'\n'}"
fi
[[ "$source_uri" == mongodb://* || "$source_uri" == mongodb+srv://* ]] ||
  die 'source URI must use mongodb:// or mongodb+srv://'
[[ ! "$source_uri" =~ [[:space:]] ]] || die 'source URI must not contain whitespace'

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
work_root="${ZWEIBLOG_MONGO_MIGRATION_DIR:-$DEPLOY_DIR/mongo-migration-$timestamp}"
case "$work_root" in
  '' | / | "$DEPLOY_DIR") die "refusing unsafe migration directory: $work_root" ;;
esac
[[ ! -e "$work_root" ]] || die "migration directory already exists: $work_root"
mkdir -p -- "$work_root/backups" "$work_root/target/data/mongo"
readonly WORK_ROOT="$(CDPATH= cd -- "$work_root" && pwd -P)"
readonly BACKUP_DIR="$WORK_ROOT/backups"
readonly TARGET_ROOT="$WORK_ROOT/target"
readonly TARGET_DATA="$TARGET_ROOT/data/mongo"
readonly TARGET_CONTAINER="zweiblog-mongo8-migration-${timestamp,,}-$$"

init_script="${ZWEIBLOG_MONGO_INIT_SCRIPT:-$SCRIPT_DIR/../docker-compose/mongo-init.js}"
health_script="${ZWEIBLOG_MONGO_HEALTH_SCRIPT:-$SCRIPT_DIR/../docker-compose/mongo-healthcheck.js}"
setup_script="${ZWEIBLOG_MONGO_SECRET_SETUP_SCRIPT:-$SCRIPT_DIR/../docker-compose/setup-mongo-secrets.sh}"
for required_file in "$init_script" "$health_script" "$setup_script"; do
  [[ -f "$required_file" && ! -L "$required_file" ]] ||
    die "required migration asset is missing or unsafe: $required_file"
done

target_started=0
app_stopped=0
cleanup() {
  status="${1:-$?}"
  trap - EXIT INT TERM
  if [[ "$target_started" -eq 1 ]]; then
    docker rm -f "$TARGET_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ "$app_stopped" -eq 1 ]]; then
    "${compose[@]}" start "$APP_SERVICE" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'cleanup 130' INT TERM

app_container="$("${compose[@]}" ps -q "$APP_SERVICE" 2>/dev/null || true)"
if [[ -n "$app_container" ]] &&
  [[ "$(docker inspect -f '{{.State.Running}}' "$app_container")" == 'true' ]]; then
  log 'stopping ZweiBlog briefly to create a consistent backup'
  "${compose[@]}" stop "$APP_SERVICE"
  app_stopped=1
fi

count_javascript='["zweiBlog","waline"].forEach(function(databaseName){var database=db.getSiblingDB(databaseName);database.getCollectionNames().sort().forEach(function(collectionName){var count=database.getCollection(collectionName).countDocuments({});print("ZWEIBLOG_COUNT\t"+databaseName+"\t"+collectionName+"\t"+count);});});'

source_counts() {
  "${compose[@]}" exec -T \
    -e ZWEIBLOG_SOURCE_URI="$source_uri" \
    -e ZWEIBLOG_COUNT_JS="$count_javascript" \
    "$MONGO_SERVICE" sh -eu -c '
      if command -v mongosh >/dev/null 2>&1; then shell=mongosh; else shell=mongo; fi
      "$shell" "$ZWEIBLOG_SOURCE_URI" --quiet --eval "$ZWEIBLOG_COUNT_JS"
    ' | awk -F '\t' '$1 == "ZWEIBLOG_COUNT" { print $2 "\t" $3 "\t" $4 }' | LC_ALL=C sort
}

dump_database() {
  database="$1"
  archive="$BACKUP_DIR/$database.archive.gz"
  log "backing up database: $database"
  "${compose[@]}" exec -T \
    -e ZWEIBLOG_SOURCE_URI="$source_uri" \
    -e ZWEIBLOG_DATABASE="$database" \
    "$MONGO_SERVICE" sh -eu -c \
    'mongodump --quiet --uri="$ZWEIBLOG_SOURCE_URI" --db="$ZWEIBLOG_DATABASE" --archive --gzip' \
    >"$archive"
  [[ -s "$archive" ]] || die "empty backup archive: $archive"
  gzip -t "$archive" || die "corrupt gzip backup archive: $archive"
  sha256sum "$archive" >"$archive.sha256"
}

log "source image: $source_image (MongoDB $source_version)"
source_counts >"$BACKUP_DIR/source-counts.tsv"
dump_database zweiBlog
if grep -q $'^waline\t' "$BACKUP_DIR/source-counts.tsv"; then
  dump_database waline
else
  log 'legacy waline database is absent or empty; skipping its archive'
fi

if [[ "$app_stopped" -eq 1 ]]; then
  "${compose[@]}" start "$APP_SERVICE"
  app_stopped=0
  log 'source ZweiBlog restarted; all remaining work uses the isolated copy'
fi

install -m 0444 "$init_script" "$TARGET_ROOT/mongo-init.js"
install -m 0444 "$health_script" "$TARGET_ROOT/mongo-healthcheck.js"
sh "$setup_script" "$TARGET_ROOT"

log "pulling target image: $TARGET_IMAGE"
docker pull "$TARGET_IMAGE"
log 'starting an isolated MongoDB 8.0 target (no published port and no network)'
docker run --detach \
  --name "$TARGET_CONTAINER" \
  --network none \
  --add-host mongo:127.0.0.1 \
  --security-opt no-new-privileges:true \
  --stop-timeout 60 \
  -e MONGO_INITDB_ROOT_USERNAME=zweiblog-root \
  -e MONGO_INITDB_ROOT_PASSWORD_FILE=/run/secrets/mongo_root_password \
  -v "$TARGET_DATA:/data/db" \
  -v "$TARGET_ROOT/secrets/mongo-root-password:/run/secrets/mongo_root_password:ro" \
  -v "$TARGET_ROOT/secrets/mongo-app-password:/run/secrets/mongo_app_password:ro" \
  -v "$TARGET_ROOT/secrets/mongo-app-uri:/run/secrets/mongo_app_uri:ro" \
  -v "$TARGET_ROOT/mongo-init.js:/docker-entrypoint-initdb.d/10-zweiblog-user.js:ro" \
  -v "$TARGET_ROOT/mongo-healthcheck.js:/opt/zweiblog/mongo-healthcheck.js:ro" \
  "$TARGET_IMAGE" >/dev/null
target_started=1

ready=0
for ((attempt = 1; attempt <= 60; attempt++)); do
  if docker exec "$TARGET_CONTAINER" \
    mongosh --nodb --quiet --file /opt/zweiblog/mongo-healthcheck.js >/dev/null 2>&1; then
    ready=1
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$TARGET_CONTAINER")" != 'true' ]]; then
    docker logs "$TARGET_CONTAINER" >&2 || true
    die 'isolated MongoDB target exited during initialization'
  fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || {
  docker logs "$TARGET_CONTAINER" >&2 || true
  die 'isolated MongoDB target did not become ready within 120 seconds'
}

restore_database() {
  database="$1"
  archive="$BACKUP_DIR/$database.archive.gz"
  log "restoring database into isolated target: $database"
  docker exec -i -e ZWEIBLOG_DATABASE="$database" "$TARGET_CONTAINER" sh -eu -c '
    root_password=$(cat /run/secrets/mongo_root_password)
    uri="mongodb://zweiblog-root:${root_password}@mongo:27017/admin?authSource=admin"
    mongorestore --quiet --stopOnError --uri="$uri" \
      --nsInclude="${ZWEIBLOG_DATABASE}.*" --archive --gzip
  ' <"$archive"
}

restore_database zweiBlog
if [[ -f "$BACKUP_DIR/waline.archive.gz" ]]; then
  restore_database waline
fi

docker exec -e ZWEIBLOG_COUNT_JS="$count_javascript" "$TARGET_CONTAINER" sh -eu -c '
  uri=$(cat /run/secrets/mongo_app_uri)
  mongosh "$uri" --quiet --eval "$ZWEIBLOG_COUNT_JS"
' | awk -F '\t' '$1 == "ZWEIBLOG_COUNT" { print $2 "\t" $3 "\t" $4 }' | LC_ALL=C sort \
  >"$BACKUP_DIR/target-counts.tsv"

if ! diff -u "$BACKUP_DIR/source-counts.tsv" "$BACKUP_DIR/target-counts.tsv" \
  >"$BACKUP_DIR/count-verification.diff"; then
  die "collection counts differ; inspect $BACKUP_DIR/count-verification.diff"
fi

docker stop --time 60 "$TARGET_CONTAINER" >/dev/null
docker rm "$TARGET_CONTAINER" >/dev/null
target_started=0

source_data_path="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/db"}}{{.Source}}{{end}}{{end}}' "$source_container")"
cat >"$WORK_ROOT/MIGRATION_REPORT.txt" <<EOF
ZweiBlog MongoDB migration staging completed successfully.

Source image: $source_image
Source version: $source_version
Source data mount (unchanged): ${source_data_path:-unknown}
Target image: $TARGET_IMAGE
Target data directory: $TARGET_DATA
Target secret directory: $TARGET_ROOT/secrets
Logical backup directory: $BACKUP_DIR

The source Compose file and source data have NOT been modified. Collection
counts match. Review the archives, SHA-256 files, and count-verification.diff.

Activation is intentionally manual:
1. Keep the old Compose file and source data as rollback material.
2. Install the new authenticated MongoDB 8.0 Compose template.
3. Stop the old stack before changing any data-directory mapping.
4. Point the new template's /data/db bind mount at the target data directory,
   and its three secret file entries at the target secret directory.
5. Start only mongo; wait for it to be healthy; then start ZweiBlog.
6. Keep the old data and logical archives until production validation passes.

Never start MongoDB 4.4 against the target directory or MongoDB 8.0 against
the old 4.4 data directory.
EOF

log "migration staging completed: $WORK_ROOT"
log 'the original database is unchanged and running; read MIGRATION_REPORT.txt before activation'
