#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yaml")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing deployment environment file: $ENV_FILE" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  else
    echo "Invalid environment entry: $line" >&2
    exit 1
  fi
done < "$ENV_FILE"

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
: "${BACKUP_RETENTION_DAYS:=7}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$BACKUP_DIR/$timestamp"

mkdir -p "$backup_path"
"${COMPOSE[@]}" config --quiet

echo "Creating PostgreSQL backup..."
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB" > "$backup_path/postgres.dump"
test -s "$backup_path/postgres.dump"

echo "Creating MinIO backup..."
mkdir -p "$backup_path/minio"
docker run --rm --network container:krunest-minio \
  -e MC_HOST_source="http://$MINIO_ACCESS_KEY:$MINIO_SECRET_KEY@127.0.0.1:9000" \
  -v "$backup_path:/backup" \
  minio/mc:RELEASE.2025-04-16T18-13-26Z mirror --overwrite source /backup/minio
test -d "$backup_path/minio"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$BACKUP_RETENTION_DAYS" -exec rm -rf {} +
echo "Backup completed: $backup_path"