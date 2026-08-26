#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"
: "${BACKUP_S3_URL:?BACKUP_S3_URL is required}"
: "${MINIO_ALIAS_URL:?MINIO_ALIAS_URL is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"
if [[ "${NODE_ENV:-development}" == production && "$BACKUP_S3_URL" =~ (localhost|127\.0\.0\.1|minio:9000|example\.invalid) ]]; then
  echo 'Production backup endpoint must be off-host' >&2; exit 2
fi
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
pg_dump --format=custom --serializable-deferrable --file="$work_dir/postgres.dump"
printf 'object_key\tchecksum\n' > "$work_dir/minio-manifest.tsv"
# Stage 3 adds permanent object references. Until then the manifest is deliberately empty.
if psql -Atqc "select to_regclass('public.\"PermanentObjectReference\"') is not null" | grep -qx t; then
  psql -AtF $'\t' -c 'select "objectKey", "checksum" from "PermanentObjectReference" where "deletedAt" is null and "expiresAt" > now()' >> "$work_dir/minio-manifest.tsv"
fi
mc alias set source "$MINIO_ALIAS_URL" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mkdir -p "$work_dir/minio"
tail -n +2 "$work_dir/minio-manifest.tsv" | while IFS=$'\t' read -r object_key checksum; do
  [[ -z "$object_key" ]] && continue
  mc cp "source/${MINIO_BUCKET}/${object_key}" "$work_dir/minio/${object_key}"
  printf '%s  %s\n' "$checksum" "$work_dir/minio/${object_key}" | sha256sum -c -
done
restic snapshots >/dev/null 2>&1 || restic init
restic backup "$work_dir"
restic forget --keep-within "${BACKUP_RETENTION_DAYS:-30}d" --prune
